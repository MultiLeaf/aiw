import { describe, expect, it } from "vitest";
import {
  parseTokenUsage,
  recordTokenUsage,
  serializeTokenUsage,
  summarizeUsageByModel,
} from "./token-usage.js";

describe("token usage", () => {
  it("serializes deterministic per-stage usage", () => {
    const content = serializeTokenUsage(
      recordTokenUsage([], { stage: "scan", budget: 100, used: 80 }),
    );
    expect(parseTokenUsage(content)).toEqual([{ stage: "scan", budget: 100, used: 80 }]);
  });

  it("rejects usage over the configured budget", () => {
    expect(() => recordTokenUsage([], { stage: "scan", budget: 10, used: 11 })).toThrow(
      "Token budget exceeded",
    );
  });
});

describe("per-model token usage", () => {
  it("round-trips optional model attribution", () => {
    const entries = [
      { stage: "scan.embedding", budget: 100, used: 100, model: "embeddinggemma-2:latest" },
      { stage: "scan.interpreter", budget: 500, used: 400 },
    ];
    const parsed = parseTokenUsage(serializeTokenUsage(entries));
    expect(parsed).toEqual(entries);
  });

  it("records separate entries per model for the same stage", () => {
    let entries = [{ stage: "scan.embedding", budget: 10, used: 10, model: "a" }];
    entries = recordTokenUsage(entries, {
      stage: "scan.embedding",
      budget: 20,
      used: 20,
      model: "b",
    });
    entries = recordTokenUsage(entries, {
      stage: "scan.embedding",
      budget: 30,
      used: 30,
      model: "a",
    });
    expect(entries).toEqual([
      { stage: "scan.embedding", budget: 20, used: 20, model: "b" },
      { stage: "scan.embedding", budget: 30, used: 30, model: "a" },
    ]);
  });

  it("summarizes totals by model ordered by consumption", () => {
    const summary = summarizeUsageByModel([
      { stage: "scan.embedding", budget: 100, used: 100, model: "embeddinggemma-2:latest" },
      { stage: "scan.interpreter", budget: 900, used: 800, model: "gpt-oss:20b" },
      { stage: "recommend.decision", budget: 50, used: 40, model: "clef-flash:latest" },
      { stage: "scan.embedding", budget: 300, used: 300, model: "gpt-oss:20b" },
    ]);
    expect(summary[0]).toEqual({
      model: "gpt-oss:20b",
      tokens: 1100,
      stages: ["scan.embedding", "scan.interpreter"],
    });
    expect(summary.map((entry) => entry.model)).toEqual([
      "gpt-oss:20b",
      "embeddinggemma-2:latest",
      "clef-flash:latest",
    ]);
  });

  it("groups unattributed entries", () => {
    const summary = summarizeUsageByModel([{ stage: "manual", budget: 5, used: 5 }]);
    expect(summary).toEqual([{ model: "unattributed", tokens: 5, stages: ["manual"] }]);
  });
});

import { describe, expect, it } from "vitest";
import { parseTokenUsage, recordTokenUsage, serializeTokenUsage } from "./token-usage.js";

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

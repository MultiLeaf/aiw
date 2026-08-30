import { describe, expect, it } from "vitest";
import { buildFacts, type EvidenceFact } from "./evidence.js";

describe("evidence model", () => {
  it("represents deterministic facts with evidence and full confidence", () => {
    const facts = buildFacts({
      runtime: { languages: ["typescript"] },
      frameworks: ["nextjs"],
      packageManager: "npm",
      quality: { linter: { name: "eslint", command: "npm run lint" } },
      ci: ["github-actions"],
      workspaces: [],
      facts: [],
    });

    expect(facts).toContainEqual({
      key: "runtime.language",
      value: "typescript",
      state: "detected",
      method: "deterministic",
      confidence: 1,
      evidence: [],
    });
    expect(
      facts.every((fact) => fact.state === "detected" && fact.method === "deterministic"),
    ).toBe(true);
  });

  it("keeps facts serializable and preserves evidence supplied by detectors", () => {
    const evidence: EvidenceFact = {
      key: "tool.linter",
      value: "eslint",
      state: "detected",
      method: "deterministic",
      confidence: 1,
      evidence: [{ source: "eslint.config.js", reason: "ESLint configuration file" }],
    };
    expect(JSON.parse(JSON.stringify(evidence))).toEqual(evidence);
  });
});

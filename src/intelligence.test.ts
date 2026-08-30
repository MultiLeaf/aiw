import { describe, expect, it } from "vitest";
import { mergeFacts } from "./intelligence.js";
import type { EvidenceFact } from "./evidence.js";

const detected: EvidenceFact = {
  key: "architecture.style",
  value: "layered",
  state: "detected",
  method: "deterministic",
  confidence: 1,
  evidence: [{ source: "src", reason: "" }],
};

describe("hybrid intelligence contract", () => {
  it("keeps deterministic facts when an AI inference has the same key", () => {
    const inferred: EvidenceFact = {
      key: "architecture.style",
      value: "feature-based",
      state: "inferred",
      method: "ai-inference",
      confidence: 0.8,
      evidence: [],
    };
    expect(mergeFacts([detected], [inferred])).toEqual([detected]);
  });

  it("adds new AI inferences without converting them into facts", () => {
    const inferred: EvidenceFact = {
      key: "architecture.naming",
      value: "camelCase",
      state: "inferred",
      method: "ai-inference",
      confidence: 0.7,
      evidence: [],
    };
    expect(mergeFacts([detected], [inferred])).toEqual([detected, inferred]);
  });

  it("allows a confirmed override to replace a detected fact", () => {
    const confirmed: EvidenceFact = {
      ...detected,
      value: "hexagonal",
      state: "confirmed",
      method: "user-confirmed",
    };
    expect(mergeFacts([detected], [confirmed])).toEqual([confirmed]);
  });
});

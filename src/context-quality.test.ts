import { describe, expect, it } from "vitest";
import { measureContextQuality, serializeContextQuality } from "./context-quality.js";
import type { ContextStore } from "./context-store.js";

describe("context quality", () => {
  it("measures size, coverage, and repeated lines deterministically", () => {
    const store: ContextStore = { layers: { global: "A", project: "A\nB", task: "", session: "" } };
    expect(measureContextQuality(store)).toEqual({
      layers: 4,
      nonEmptyLayers: 2,
      characters: 7,
      estimatedTokens: 2,
      uniqueLines: 2,
      duplicateLines: 1,
    });
    expect(serializeContextQuality(measureContextQuality(store))).toContain("duplicate_lines: 1");
  });
});

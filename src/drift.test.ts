import { describe, expect, it } from "vitest";
import { detectDrift, resolveGeneratedPath } from "./drift.js";

describe("generated resource ownership", () => {
  it("resolves generated resources under the AIW generated directory", () => {
    expect(resolveGeneratedPath("rules/project-quality.md")).toBe(
      "generated/rules/project-quality.md",
    );
  });

  it("rejects traversal outside generated resources", () => {
    expect(() => resolveGeneratedPath("../manifest.yml")).toThrow("outside generated resources");
  });

  it("detects whether an existing generated resource changed", () => {
    expect(detectDrift("expected", "expected")).toBe(false);
    expect(detectDrift("expected", "manual change")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";
import { TARGETS } from "./types.js";

describe("adapter migration contract", () => {
  it.each(TARGETS)("renders a skill for %s", (target) => {
    const path = renderResourcePath(target, "skills", "example");
    expect(path).toContain("example");
    expect(path).toMatch(/SKILL\.md$/);
  });

  it.each(TARGETS)("renders every resource category for %s", (target) => {
    for (const type of ["skills", "rules", "agents", "hooks", "templates"] as const)
      expect(renderResourcePath(target, type, "example")).toContain("example");
  });

  it("uses the neutral fallback for unsupported platform-specific behavior", () => {
    expect(renderResourcePath("universal", "rules", "quality")).toMatch(/^\.aiw\/resources\//);
  });
});

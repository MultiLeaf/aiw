import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";

describe("universal adapter", () => {
  it("renders resources in the neutral fallback structure", () => {
    expect(renderResourcePath("universal", "skills", "brainstorm")).toBe(
      ".aiw/resources/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("universal", "rules", "quality")).toBe(
      ".aiw/resources/rules/quality/quality.md",
    );
    expect(renderResourcePath("universal", "agents", "architect")).toContain(
      ".aiw/resources/agents",
    );
  });
});

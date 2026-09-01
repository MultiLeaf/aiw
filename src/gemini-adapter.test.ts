import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";

describe("Gemini CLI adapter", () => {
  it("maps resources to Gemini-owned paths", () => {
    expect(renderResourcePath("gemini", "skills", "brainstorm")).toBe(
      ".gemini/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("gemini", "rules", "quality")).toContain(".gemini/rules/quality");
  });
});

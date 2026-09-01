import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";

describe("Cursor adapter", () => {
  it("maps resources to Cursor-owned paths", () => {
    expect(renderResourcePath("cursor", "skills", "brainstorm")).toBe(
      ".cursor/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("cursor", "rules", "quality")).toBe(
      ".cursor/rules/quality/quality.md",
    );
    expect(renderResourcePath("cursor", "agents", "architect")).toContain(
      ".cursor/agents/architect",
    );
    expect(renderResourcePath("cursor", "hooks", "pre-commit")).toContain(
      ".cursor/hooks/pre-commit",
    );
  });
});

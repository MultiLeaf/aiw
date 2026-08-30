import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";

describe("Claude Code adapter", () => {
  it("maps resources to Claude-owned paths", () => {
    expect(renderResourcePath("claude", "skills", "brainstorm")).toBe(
      ".claude/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("claude", "rules", "quality")).toBe(
      ".claude/rules/quality/quality.md",
    );
    expect(renderResourcePath("claude", "agents", "architect")).toContain(
      ".claude/agents/architect",
    );
    expect(renderResourcePath("claude", "hooks", "pre-commit")).toContain(
      ".claude/hooks/pre-commit",
    );
  });
});

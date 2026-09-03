import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";
import { describeClaudeResource, renderClaudeContext } from "./claude-layout.js";
import type { FileSystem } from "./types.js";

describe("Claude Code adapter", () => {
  it("maps resources to Claude-owned paths", () => {
    expect(renderResourcePath("claude", "skills", "brainstorm")).toBe(
      ".claude/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("claude", "rules", "quality")).toBe(".claude/rules/quality.md");
    expect(renderResourcePath("claude", "agents", "architect")).toBe(".claude/agents/architect.md");
    expect(renderResourcePath("claude", "hooks", "pre-commit")).toBe(
      ".claude/aiw/hooks/pre-commit.md",
    );
  });

  it("describes native and compatibility support and renders context", () => {
    expect(describeClaudeResource("skills", "x").support).toBe("native");
    expect(describeClaudeResource("rules", "x").support).toBe("native");
    expect(describeClaudeResource("agents", "x").support).toBe("native");
    expect(describeClaudeResource("hooks", "x").support).toBe("compatibility");
    expect(describeClaudeResource("templates", "x").support).toBe("compatibility");
    const files = new Map<string, string>();
    const fs: FileSystem = {
      exists: (path) => files.has(path),
      read: (path) => files.get(path) ?? "",
      write: (path, content) => files.set(path, content),
      mkdir: () => undefined,
    };
    expect(renderClaudeContext("/project", "# Context\n", fs)).toBe("CLAUDE.md");
    expect(files.get("/project/CLAUDE.md")).toBe("# Context\n");
  });

  it("rejects invalid runtime resource types", () => {
    expect(() =>
      describeClaudeResource(
        "bogus" as unknown as Parameters<typeof describeClaudeResource>[0],
        "x",
      ),
    ).toThrow("Unsupported Claude resource type: bogus");
  });
});

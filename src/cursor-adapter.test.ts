import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";
import { describeCursorResource, renderCursorContext } from "./cursor-layout.js";
import type { FileSystem } from "./types.js";

describe("Cursor adapter", () => {
  it("maps resources to Cursor-owned paths", () => {
    expect(renderResourcePath("cursor", "skills", "brainstorm")).toBe(
      ".cursor/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("cursor", "rules", "quality")).toBe(".cursor/rules/quality.mdc");
    expect(renderResourcePath("cursor", "agents", "architect")).toBe(
      ".cursor/aiw/agents/architect.md",
    );
    expect(renderResourcePath("cursor", "hooks", "pre-commit")).toBe(
      ".cursor/aiw/hooks/pre-commit.md",
    );
  });

  it("describes support and renders native context", () => {
    expect(describeCursorResource("rules", "x").support).toBe("native");
    expect(describeCursorResource("context", "x").support).toBe("native");
    for (const type of ["skills", "agents", "hooks", "templates"] as const)
      expect(describeCursorResource(type, "x").support).toBe("compatibility");
    const files = new Map<string, string>();
    const fs: FileSystem = {
      exists: (path) => files.has(path),
      read: (path) => files.get(path) ?? "",
      write: (path, content) => files.set(path, content),
      mkdir: () => undefined,
    };
    expect(renderCursorContext("/project", "# Context\n", fs)).toBe("AGENTS.md");
    expect(files.get("/project/AGENTS.md")).toBe("# Context\n");
  });

  it("rejects invalid runtime resource types", () => {
    expect(() =>
      describeCursorResource(
        "bogus" as unknown as Parameters<typeof describeCursorResource>[0],
        "x",
      ),
    ).toThrow("Unsupported Cursor resource type: bogus");
  });
});

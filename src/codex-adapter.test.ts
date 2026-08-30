import { describe, expect, it } from "vitest";
import { renderCodexResource, renderResourcePath } from "./adapter.js";
import type { FileSystem } from "./types.js";

function memoryFileSystem(): { fs: FileSystem; files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    fs: {
      exists: (path: string): boolean => files.has(path),
      read: (path: string): string => files.get(path) ?? "",
      write: (path: string, content: string): void => {
        files.set(path, content);
      },
      mkdir: (): void => {},
    },
  };
}

describe("Codex adapter", () => {
  it("maps every supported resource to a Codex-owned path", () => {
    expect(renderResourcePath("codex", "skills", "brainstorm")).toBe(
      ".agents/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("codex", "rules", "quality")).toBe(
      ".agents/rules/quality/quality.md",
    );
    expect(renderResourcePath("codex", "agents", "architect")).toContain(
      ".agents/agents/architect",
    );
    expect(renderResourcePath("codex", "hooks", "pre-commit")).toContain(
      ".agents/hooks/pre-commit",
    );
    expect(renderResourcePath("codex", "templates", "spec")).toContain(".agents/templates/spec");
  });

  it("renders content without changing it", () => {
    const { fs, files } = memoryFileSystem();
    const path = renderCodexResource("rules", "quality", "# Quality\n", "/project", fs);
    expect(path).toBe(".agents/rules/quality/quality.md");
    expect(files.get("/project/.agents/rules/quality/quality.md")).toBe("# Quality\n");
  });
});

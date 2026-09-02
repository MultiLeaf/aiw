import { describe, expect, it } from "vitest";
import { detectTarget } from "./adapter.js";
import type { FileSystem } from "./types.js";

function fileSystem(paths: string[]): FileSystem {
  return {
    exists: (path: string): boolean => paths.includes(path),
    read: (): string => "",
    write: (): void => {},
    mkdir: (): void => {},
  };
}

describe("target detection", () => {
  it("detects installed target markers", () => {
    expect(detectTarget("/project", fileSystem(["/project/.claude"]))).toBe("claude");
    expect(detectTarget("/project", fileSystem(["/project/.cursor"]))).toBe("cursor");
    expect(detectTarget("/project", fileSystem(["/project/.gemini"]))).toBe("gemini");
    expect(detectTarget("/project", fileSystem(["/project/.github/copilot-instructions.md"]))).toBe(
      "copilot",
    );
  });

  it("uses deterministic marker precedence when multiple targets exist", () => {
    expect(detectTarget("/project", fileSystem(["/project/.agents", "/project/.claude"]))).toBe(
      "codex",
    );
  });

  it("returns undefined when no target marker exists", () => {
    expect(detectTarget("/project", fileSystem([]))).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";
import { describeGeminiResource, renderGeminiContext } from "./gemini-layout.js";
import type { FileSystem } from "./types.js";

describe("Gemini CLI adapter", () => {
  it("maps resources to Gemini-owned paths", () => {
    expect(renderResourcePath("gemini", "skills", "brainstorm")).toBe(
      ".gemini/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("gemini", "rules", "quality")).toBe(".gemini/aiw/rules/quality.md");
    expect(renderResourcePath("gemini", "agents", "architect")).toBe(".gemini/agents/architect.md");
  });

  it("describes native and compatibility support and renders context", () => {
    expect(describeGeminiResource("skills", "x").support).toBe("native");
    expect(describeGeminiResource("agents", "x").support).toBe("native");
    expect(describeGeminiResource("context", "x").support).toBe("native");
    for (const type of ["rules", "hooks", "templates"] as const)
      expect(describeGeminiResource(type, "x").support).toBe("compatibility");
    const files = new Map<string, string>();
    const fs: FileSystem = {
      exists: (path) => files.has(path),
      read: (path) => files.get(path) ?? "",
      write: (path, content) => files.set(path, content),
      mkdir: () => undefined,
    };
    expect(renderGeminiContext("/project", "# Context\n", fs)).toBe("GEMINI.md");
    expect(files.get("/project/GEMINI.md")).toBe("# Context\n");
  });

  it("rejects invalid runtime resource types", () => {
    expect(() =>
      describeGeminiResource(
        "bogus" as unknown as Parameters<typeof describeGeminiResource>[0],
        "x",
      ),
    ).toThrow("Unsupported Gemini resource type: bogus");
  });
});

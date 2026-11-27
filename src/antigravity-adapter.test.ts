import { describe, expect, it } from "vitest";
import { normalizeTarget, renderAiInitPath, renderResourcePath } from "./adapter.js";
import { describeAntigravityResource, renderAntigravityContext } from "./antigravity-layout.js";
import type { FileSystem } from "./types.js";

describe("Antigravity (agy) adapter", () => {
  it("normalizes the agy alias to antigravity and maps resources to .agents/", () => {
    expect(normalizeTarget("agy")).toBe("antigravity");
    expect(normalizeTarget("gemini")).toBe("gemini");
    expect(renderAiInitPath("antigravity")).toBe(".agents/skills/ai-init/SKILL.md");
    expect(renderResourcePath("antigravity", "skills", "brainstorm")).toBe(
      ".agents/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("antigravity", "rules", "quality")).toBe(".agents/rules/quality.md");
    expect(renderResourcePath("antigravity", "agents", "architect")).toBe(
      ".agents/agents/architect.md",
    );
    expect(renderResourcePath("antigravity", "hooks", "pre-commit")).toBe(
      ".agents/hooks/pre-commit.md",
    );
    expect(renderResourcePath("antigravity", "templates", "spec")).toBe(
      ".agents/templates/spec.md",
    );
  });

  it("describes native vs compatibility support and renders GEMINI.md context", () => {
    expect(describeAntigravityResource("skills", "x").support).toBe("native");
    expect(describeAntigravityResource("rules", "x").support).toBe("native");
    expect(describeAntigravityResource("context", "x").support).toBe("native");
    for (const type of ["agents", "hooks", "templates"] as const)
      expect(describeAntigravityResource(type, "x").support).toBe("compatibility");

    const files = new Map<string, string>();
    const fs: FileSystem = {
      exists: (path) => files.has(path),
      read: (path) => files.get(path) ?? "",
      write: (path, content) => files.set(path, content),
      mkdir: () => undefined,
    };
    expect(renderAntigravityContext("/project", "# Context\n", fs)).toBe("GEMINI.md");
    expect(files.get("/project/GEMINI.md")).toBe("# Context\n");
  });

  it("rejects invalid runtime resource types", () => {
    expect(() =>
      describeAntigravityResource(
        "bogus" as unknown as Parameters<typeof describeAntigravityResource>[0],
        "x",
      ),
    ).toThrow("Unsupported Antigravity resource type: bogus");
  });
});

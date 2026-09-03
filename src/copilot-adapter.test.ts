import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";
import { describeCopilotResource, renderCopilotContext } from "./copilot-layout.js";
import type { FileSystem } from "./types.js";

describe("GitHub Copilot adapter", () => {
  it("maps resources to Copilot-owned paths", () => {
    expect(renderResourcePath("copilot", "skills", "brainstorm")).toBe(
      ".github/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("copilot", "rules", "quality")).toBe(
      ".github/instructions/quality.instructions.md",
    );
    expect(renderResourcePath("copilot", "agents", "architect")).toBe(
      ".github/agents/architect.md",
    );
  });

  it("describes support and renders native instructions", () => {
    for (const type of ["skills", "rules", "agents", "context"] as const)
      expect(describeCopilotResource(type, "x").support).toBe("native");
    for (const type of ["hooks", "templates"] as const)
      expect(describeCopilotResource(type, "x").support).toBe("compatibility");
    const files = new Map<string, string>();
    const fs: FileSystem = {
      exists: (path) => files.has(path),
      read: (path) => files.get(path) ?? "",
      write: (path, content) => files.set(path, content),
      mkdir: () => undefined,
    };
    expect(renderCopilotContext("/project", "# Context\n", fs)).toBe(
      ".github/copilot-instructions.md",
    );
    expect(files.get("/project/.github/copilot-instructions.md")).toBe("# Context\n");
  });

  it("rejects invalid runtime resource types", () => {
    expect(() =>
      describeCopilotResource(
        "bogus" as unknown as Parameters<typeof describeCopilotResource>[0],
        "x",
      ),
    ).toThrow("Unsupported Copilot resource type: bogus");
  });
});

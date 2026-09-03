import { describe, expect, it } from "vitest";
import { describeCodexResource, renderCodexContext } from "./codex-layout.js";
import type { FileSystem } from "./types.js";

describe("Codex layout", () => {
  it("distinguishes native resources from compatibility resources", () => {
    expect(describeCodexResource("skills", "review")).toEqual({
      path: ".agents/skills/review/SKILL.md",
      support: "native",
    });
    expect(describeCodexResource("context", "project")).toEqual({
      path: "AGENTS.md",
      support: "native",
    });
    expect(describeCodexResource("rules", "quality").support).toBe("compatibility");
    expect(describeCodexResource("agents", "reviewer").support).toBe("compatibility");
    expect(describeCodexResource("hooks", "pre-commit").support).toBe("compatibility");
  });

  it("renders project context to the native Codex instruction file", () => {
    const files = new Map<string, string>();
    const fs: FileSystem = {
      exists: (path) => files.has(path),
      read: (path) => files.get(path) ?? "",
      write: (path, content) => files.set(path, content),
      mkdir: () => undefined,
    };
    expect(renderCodexContext("/project", "# Project rules\n", fs)).toBe("AGENTS.md");
    expect(files.get("/project/AGENTS.md")).toBe("# Project rules\n");
  });

  it("rejects unsupported resource types at the runtime boundary", () => {
    expect(() =>
      describeCodexResource("bogus" as unknown as Parameters<typeof describeCodexResource>[0], "x"),
    ).toThrow("Unsupported Codex resource type: bogus");
  });
});

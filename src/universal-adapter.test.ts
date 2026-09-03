import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";
import { describeUniversalResource, renderUniversalContext } from "./universal-layout.js";
import type { FileSystem } from "./types.js";

describe("universal adapter", () => {
  it("renders resources in the neutral fallback structure", () => {
    expect(renderResourcePath("universal", "skills", "brainstorm")).toBe(
      ".aiw/resources/skills/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("universal", "rules", "quality")).toBe(
      ".aiw/resources/rules/quality/quality.md",
    );
    expect(renderResourcePath("universal", "agents", "architect")).toContain(
      ".aiw/resources/agents",
    );
  });

  it("marks every resource as fallback and renders neutral context", () => {
    for (const type of ["skills", "rules", "agents", "hooks", "templates", "context"] as const)
      expect(describeUniversalResource(type, "x").support).toBe("fallback");
    const files = new Map<string, string>();
    const fs: FileSystem = {
      exists: (path) => files.has(path),
      read: (path) => files.get(path) ?? "",
      write: (path, content) => files.set(path, content),
      mkdir: () => undefined,
    };
    expect(renderUniversalContext("/project", "# Context\n", fs)).toBe(
      ".aiw/resources/context/project/project.md",
    );
    expect(files.get("/project/.aiw/resources/context/project/project.md")).toBe("# Context\n");
  });

  it("rejects invalid runtime resource types", () => {
    expect(() =>
      describeUniversalResource(
        "bogus" as unknown as Parameters<typeof describeUniversalResource>[0],
        "x",
      ),
    ).toThrow("Unsupported universal resource type: bogus");
  });
});

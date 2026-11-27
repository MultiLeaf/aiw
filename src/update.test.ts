import { describe, expect, it } from "vitest";
import { computeUpdatePlan, refreshOwnershipChecksums } from "./update.js";
import type { FileSystem } from "./types.js";
import { createOwnedFile, serializeOwnership } from "./ownership.js";

function memoryFs(files: Record<string, string>): FileSystem {
  return {
    exists: (path: string): boolean => path in files,
    read: (path: string): string => {
      if (!(path in files)) throw new Error(`missing: ${path}`);
      return files[path];
    },
    write: (path: string, content: string): void => {
      files[path] = content;
    },
    mkdir: (): void => {},
    remove: (path: string): void => {
      delete files[path];
    },
  };
}

const bundle = new Map(
  [
    { key: "skills/alpha", type: "skills", id: "alpha", content: "alpha v2" },
    { key: "skills/beta", type: "skills", id: "beta", content: "beta v1" },
    { key: "skills/gamma", type: "skills", id: "gamma", content: "gamma v1" },
  ].map((r) => [
    r.key,
    { type: r.type as string, id: r.id as string, content: r.content as string },
  ]),
);

function installWith(
  files: Record<string, string>,
  owned: { path: string; content: string; resourceId: string }[],
): Record<string, string> {
  const entries = owned.map((o) =>
    createOwnedFile(o.path, o.content, {
      kind: "neutral-resource",
      target: "universal",
      resourceType: "skills",
      resourceId: o.resourceId,
    }),
  );
  files[".aiw/ownership.yml"] = serializeOwnership(entries);
  return files;
}

const base = (files: Record<string, string>): Parameters<typeof computeUpdatePlan>[0] => ({
  fs: memoryFs(files),
  root: "",
  aiw: ".aiw",
  target: "codex" as const,
  add: [] as string[],
  bundle,
});

describe("update plan (UPD-001)", () => {
  it("classifies updated, unchanged, and conflict via the ownership checksum oracle (REQ-001/002)", () => {
    const files = installWith(
      {
        ".agents/skills/alpha/SKILL.md": "alpha v1",
        ".agents/skills/beta/SKILL.md": "beta v1",
        ".agents/skills/drifted/SKILL.md": "drifted v1",
      },
      [
        { path: ".agents/skills/alpha/SKILL.md", content: "alpha v1", resourceId: "alpha" },
        { path: ".agents/skills/beta/SKILL.md", content: "beta v1", resourceId: "beta" },
        { path: ".agents/skills/drifted/SKILL.md", content: "other bytes", resourceId: "alpha" },
      ],
    );
    // alpha: installed v1, catalog v2, no drift -> updated.
    // beta: identical -> unchanged.
    // drifted: ownership checksum does not match the file -> conflict.
    const plan = computeUpdatePlan(base(files));
    expect(plan.updated).toEqual([{ path: ".agents/skills/alpha/SKILL.md", content: "alpha v2" }]);
    expect(plan.unchanged).toBeGreaterThanOrEqual(1);
    expect(plan.conflicts).toContain(".agents/skills/drifted/SKILL.md");
  });

  it("fails closed on unknown --add ids with the available ids (REQ-003)", () => {
    const files = installWith({}, []);
    expect(() => computeUpdatePlan({ ...base(files), add: ["skills/nope"] })).toThrow(
      "Unknown resource id: skills/nope",
    );
  });

  it("marks uninstalled catalog resources as new (REQ-001)", () => {
    const files = installWith({ ".agents/skills/alpha/SKILL.md": "alpha v1" }, [
      { path: ".agents/skills/alpha/SKILL.md", content: "alpha v1", resourceId: "alpha" },
    ]);
    const plan = computeUpdatePlan(base(files));
    expect(plan.newIds).toContain("skills/beta");
    expect(plan.newIds).toContain("skills/gamma");
  });

  it("is deterministic for identical state (REQ-004)", () => {
    const files = installWith({ ".agents/skills/alpha/SKILL.md": "alpha v1" }, [
      { path: ".agents/skills/alpha/SKILL.md", content: "alpha v1", resourceId: "alpha" },
    ]);
    const first = computeUpdatePlan(base(files));
    const second = computeUpdatePlan(base(files));
    expect(first).toEqual(second);
  });

  it("refreshes ownership checksums after applying new bytes (REQ-002)", () => {
    const files = installWith({ ".agents/skills/alpha/SKILL.md": "alpha v2" }, [
      { path: ".agents/skills/alpha/SKILL.md", content: "alpha v1", resourceId: "alpha" },
    ]);
    const fs = memoryFs(files);
    const refreshed = refreshOwnershipChecksums(
      [
        {
          ...createOwnedFile(".agents/skills/alpha/SKILL.md", "alpha v1", {
            kind: "neutral-resource",
            resourceType: "skills",
            resourceId: "alpha",
          }),
        },
      ],
      fs,
      "",
    );
    expect(refreshed[0].checksum).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(refreshed[0].checksum).not.toBe(
      createOwnedFile(".agents/skills/alpha/SKILL.md", "alpha v1", {}).checksum,
    );
  });
});

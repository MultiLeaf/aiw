import { describe, expect, it } from "vitest";
import {
  archiveWorkflowArtifacts,
  resolveStageArtifact,
  stageArtifactPaths,
} from "./artifact-paths.js";
import type { FileSystem } from "./types.js";

function memoryFs(files: Record<string, string>, dirs: Set<string> = new Set()): FileSystem {
  return {
    exists: (path: string): boolean =>
      path in files ||
      dirs.has(path) ||
      Object.keys(files).some((file) => file.startsWith(`${path}/`)),
    read: (path: string): string => {
      if (!(path in files)) throw new Error(`missing: ${path}`);
      return files[path];
    },
    write: (path: string, content: string): void => {
      files[path] = content;
    },
    mkdir: (path: string): void => {
      dirs.add(path);
    },
    remove: (path: string): void => {
      delete files[path];
    },
    list: (path: string): string[] =>
      Object.keys(files)
        .filter((file) => file.startsWith(`${path}/`))
        .map((file) => file.slice(path.length + 1)),
  };
}

describe("stage artifact paths", () => {
  it("builds scoped and legacy paths per stage kind (REQ-001)", () => {
    const spec = stageArtifactPaths(".aiw", "specification", "wf-1");
    expect(spec.scoped).toBe(".aiw/generated/specs/wf-1/specification.md");
    expect(spec.legacy).toBe(".aiw/generated/specs/specification.md");
    const plan = stageArtifactPaths(".aiw", "plan", "wf-1");
    expect(plan.scoped).toBe(".aiw/generated/plans/wf-1/implementation-plan.md");
    const trace = stageArtifactPaths(".aiw", "traceability", "wf-1");
    expect(trace.scoped).toBe(".aiw/generated/artifacts/wf-1/traceability.yml");
  });

  it("returns legacy-only paths without a workflow id", () => {
    const { scoped, legacy } = stageArtifactPaths(".aiw", "specification");
    expect(scoped).toBeUndefined();
    expect(legacy).toBe(".aiw/generated/specs/specification.md");
  });

  it("prefers the scoped artifact and flags legacy fallback (REQ-004)", () => {
    const scopedFs = memoryFs({ ".aiw/generated/specs/wf-1/specification.md": "new" });
    const resolved = resolveStageArtifact(scopedFs, ".aiw", "specification", "wf-1");
    expect(resolved).toEqual({
      path: ".aiw/generated/specs/wf-1/specification.md",
      legacyFallback: false,
    });
    const legacyFs = memoryFs({ ".aiw/generated/specs/specification.md": "old" });
    const fallback = resolveStageArtifact(legacyFs, ".aiw", "specification", "wf-1");
    expect(fallback).toEqual({
      path: ".aiw/generated/specs/specification.md",
      legacyFallback: true,
    });
    const noneFs = memoryFs({});
    const missing = resolveStageArtifact(noneFs, ".aiw", "specification", "wf-1");
    expect(missing.legacyFallback).toBe(false);
  });

  it("archives scoped artifact trees to checkpoints (REQ-005)", () => {
    const files: Record<string, string> = {
      ".aiw/generated/specs/wf-1/specification.md": "spec",
      ".aiw/generated/reports/wf-1/implementation-report.md": "report",
      ".aiw/generated/specs/wf-2/specification.md": "other workflow untouched",
    };
    const fs = memoryFs(files);
    const archived = archiveWorkflowArtifacts(fs, ".aiw", "wf-1");
    expect(archived.sort()).toEqual(["reports/implementation-report.md", "specs/specification.md"]);
    expect(files[".aiw/checkpoints/workflow-wf-1-artifacts/specs/specification.md"]).toBe("spec");
    expect(files[".aiw/generated/specs/wf-2/specification.md"]).toBe("other workflow untouched");
    expect(archiveWorkflowArtifacts(memoryFs({}), ".aiw", "wf-3")).toEqual([]);
  });
});

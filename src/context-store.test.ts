import { describe, expect, it } from "vitest";
import { composeContext, readContextStore, writeContextLayer } from "./context-store.js";
import type { FileSystem } from "./types.js";

function memoryFileSystem(): FileSystem {
  const files = new Map<string, string>();
  return {
    exists: (path) => files.has(path),
    read: (path) => files.get(path) ?? "",
    write: (path, content) => files.set(path, content),
    mkdir: () => undefined,
  };
}

describe("layered context store", () => {
  it("writes and reads independent context layers", () => {
    const fs = memoryFileSystem();
    writeContextLayer("/project", fs, "project", "Use strict TypeScript.");
    writeContextLayer("/project", fs, "task", "Implement context retrieval.");
    const store = readContextStore("/project", fs);
    expect(store.layers.project).toContain("strict TypeScript");
    expect(store.layers.task).toContain("context retrieval");
    expect(store.layers.session).toBe("");
  });

  it("composes layers in stable precedence order", () => {
    expect(composeContext({ layers: { global: "G", project: "P", task: "T", session: "S" } })).toBe(
      "# global context\n\nG\n\n# project context\n\nP\n\n# task context\n\nT\n\n# session context\n\nS",
    );
  });
});

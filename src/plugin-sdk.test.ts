import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  createPluginScaffold,
  definePlugin,
  resolvePluginDirectory,
  validatePluginDirectory,
  writePluginScaffold,
} from "./plugin-sdk.js";
import { memoryFileSystem } from "./fixtures/plugin-files.js";

describe("plugin SDK", () => {
  it("creates and validates a deterministic English plugin scaffold", () => {
    const fs = memoryFileSystem();
    const scaffold = createPluginScaffold("/project", "plugins/example", {
      id: "acme/example",
      version: "1.2.3",
      description: "Provide an example workflow.",
    });
    writePluginScaffold(fs, scaffold);
    const contract = validatePluginDirectory(fs, scaffold.root);
    expect(contract.id).toBe("acme/example");
    expect(fs.read(join(scaffold.root, "skills/example/SKILL.md"))).toContain(
      "Describe the focused workflow",
    );
    expect(
      createPluginScaffold("/project", "plugins/example", {
        id: "acme/example",
        version: "1.2.3",
        description: "Provide an example workflow.",
      }),
    ).toEqual(scaffold);
  });

  it("rejects unsafe destinations and overwrites before writing", () => {
    expect(() =>
      createPluginScaffold("/project", "../outside", {
        id: "acme/example",
        version: "1.0.0",
        description: "Example.",
      }),
    ).toThrow("inside the project");
    expect(() => resolvePluginDirectory("/project", "/outside")).toThrow("project-relative");
    const fs = memoryFileSystem({ "/project/plugins/example/package.yaml": "existing" });
    const before = fs.snapshot();
    expect(() =>
      writePluginScaffold(
        fs,
        createPluginScaffold("/project", "plugins/example", {
          id: "acme/example",
          version: "1.0.0",
          description: "Example.",
        }),
      ),
    ).toThrow("overwrite");
    expect(fs.snapshot()).toEqual(before);
  });

  it("exposes typed immutable plugin definitions", () => {
    const contract = definePlugin({
      schema: 1,
      id: "acme/example",
      version: "1.0.0",
      provider: "local",
      source: ".",
      resources: { skills: [], rules: [], agents: [], hooks: [], templates: [] },
      dependencies: [],
      permissions: [],
      provenance: { source: "." },
    });
    expect(Object.isFrozen(contract)).toBe(true);
  });
});

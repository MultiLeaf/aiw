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
    const contract = validatePluginDirectory(fs, "/project", "plugins/example");
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
    ).toThrow("project-relative");
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

  it("rejects normalized root, traversal, and control-character directories", () => {
    const definition = {
      id: "acme/example",
      version: "1.0.0",
      description: "Example.",
    };
    for (const directory of [
      "./",
      "a/..",
      "a/../",
      "../project/plugin",
      "plugin\tname",
      "plugin\u0085name",
      "plugin\u2028name",
    ]) {
      expect(() => createPluginScaffold("/project", directory, definition)).toThrow();
    }
  });

  it("preflights duplicate, root, and file-ancestor destinations atomically", () => {
    const cases: Array<Record<string, string>> = [
      { "": "root", "package.yaml": "manifest" },
      { ".": "root", "package.yaml": "manifest" },
      { a: "file", "a/b": "child" },
      { "a/b": "child", a: "file" },
      { "package.yaml": "first", "a/../package.yaml": "second" },
    ];
    for (const files of cases) {
      const fs = memoryFileSystem();
      expect(() =>
        writePluginScaffold(fs, {
          projectRoot: "/project",
          root: "/project/plugin",
          files,
        }),
      ).toThrow();
      expect(fs.snapshot()).toEqual({});
    }
  });

  it("rejects malformed manifests and duplicate resource identities", () => {
    const scaffold = createPluginScaffold("/project", "plugins/example", {
      id: "acme/example",
      version: "1.2.3",
      description: "Example.",
    });
    const valid = scaffold.files["package.yaml"];
    const mutations = [
      `${valid}BROKEN: [\n`,
      valid.replace("provider: local", 'provider: "local'),
      valid.replace("  rules: []", "  rules: []\n  rules: []"),
      valid.replace("dependencies: []", 'dependencies: ["unterminated]'),
      valid.replace("permissions: []", "permissions: [network,,execution]"),
      valid.replace("  rules: []", "  rules:\n    - { broken"),
      valid.replace("  rules: []", "  rules: garbage"),
      valid.replace(
        "    - { id: example, version: 1.2.3, path: skills/example/SKILL.md }",
        "    - { id: example, version: 1.2.3, path: skills/example/SKILL.md }\n    - { id: example, version: 1.2.3, path: skills/example/SKILL.md }",
      ),
      valid.replace("version: 1.2.3, path", "version: 01.2.3, path"),
    ];
    for (const manifest of mutations) {
      const fs = memoryFileSystem({
        "/project/plugins/example/package.yaml": manifest,
        "/project/plugins/example/skills/example/SKILL.md": "skill",
      });
      expect(() => validatePluginDirectory(fs, "/project", "plugins/example")).toThrow();
    }
  });

  it("quotes the generated validation command for paths containing spaces", () => {
    const scaffold = createPluginScaffold("/project", "plugins/my plugin", {
      id: "acme/example",
      version: "1.0.0",
      description: "Example.",
    });
    expect(scaffold.files["README.md"]).toContain("--directory='plugins/my plugin'");
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
    expect(Object.isFrozen(contract.permissions)).toBe(true);
  });
});

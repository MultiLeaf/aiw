import { describe, expect, it } from "vitest";
import { memoryFileSystem } from "./fixtures/plugin-files.js";
import {
  loadSettings,
  parseSettingOverrides,
  readFactOverrides,
  saveSettingOverrides,
  saveSettingsSection,
} from "./settings.js";

describe("settings store and override persistence", () => {
  it("returns undefined when settings.yml is absent and rejects invalid YAML or non-mappings", () => {
    const fs = memoryFileSystem();
    expect(loadSettings(fs, "/project/.aiw")).toBeUndefined();

    fs.write("/project/.aiw/settings.yml", "[\n");
    expect(() => loadSettings(fs, "/project/.aiw")).toThrow("not valid YAML");

    fs.write("/project/.aiw/settings.yml", "- one\n- two\n");
    expect(() => loadSettings(fs, "/project/.aiw")).toThrow("must contain a YAML mapping");

    fs.write("/project/.aiw/settings.yml", "");
    expect(loadSettings(fs, "/project/.aiw")).toEqual({});
  });

  it("saves sections with schema: 1 while preserving unrelated sections", () => {
    const fs = memoryFileSystem();
    saveSettingsSection(fs, "/project/.aiw", "semantic", { enabled: true, model: "m1" });
    saveSettingsSection(fs, "/project/.aiw", "telemetry", { enabled: false });

    const loaded = loadSettings(fs, "/project/.aiw");
    expect(loaded).toEqual({
      schema: 1,
      semantic: { enabled: true, model: "m1" },
      telemetry: { enabled: false },
    });
  });

  it("reads overrides from settings.yml first and falls back to legacy overrides.yml", () => {
    const fs = memoryFileSystem({
      "/project/.aiw/overrides.yml":
        "schema: 1\noverrides:\n  - key: tool.linter\n    action: accept\n",
    });
    expect(readFactOverrides(fs, "/project/.aiw")).toEqual([
      { key: "tool.linter", action: "accept" },
    ]);

    saveSettingOverrides(fs, "/project/.aiw", [
      { key: "tool.linter", action: "edit", value: "biome" },
      { key: "tool.formatter", action: "reject" },
    ]);
    expect(readFactOverrides(fs, "/project/.aiw")).toEqual([
      { key: "tool.linter", action: "edit", value: "biome" },
      { key: "tool.formatter", action: "reject" },
    ]);
  });

  it("rejects malformed override entries", () => {
    expect(() => parseSettingOverrides("not-a-list")).toThrow("must be a list");
    expect(() => parseSettingOverrides([null])).toThrow("Invalid settings override entry");
    expect(() => parseSettingOverrides([{ key: "  ", action: "accept" }])).toThrow(
      "non-empty string",
    );
    expect(() => parseSettingOverrides([{ key: "k", action: "bogus" }])).toThrow(
      "Invalid settings override action",
    );
    expect(() => parseSettingOverrides([{ key: "k", action: "edit" }])).toThrow(
      "requires a value for an edit action",
    );
  });
});

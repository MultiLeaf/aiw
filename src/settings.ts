import { parseDocument, stringify } from "yaml";
import type { FileSystem } from "./types.js";
import type { FactOverride } from "./confirmation.js";
import { parseOverrides } from "./confirmation.js";

export const SETTINGS_PATH = "settings.yml";
export const LEGACY_SETTINGS_PATHS = [
  "semantic.yml",
  "decision.yml",
  "telemetry.yml",
  "overrides.yml",
] as const;

export type SettingsDocument = Record<string, unknown>;

export function loadSettings(fs: FileSystem, aiwPath: string): SettingsDocument | undefined {
  const path = `${aiwPath}/${SETTINGS_PATH}`;
  if (!fs.exists(path)) return undefined;
  const document = parseDocument(fs.read(path));
  if (document.errors.length > 0) throw new Error(`Settings file ${path} is not valid YAML`);
  const root = document.toJSON();
  if (root === null) return {};
  if (typeof root !== "object" || Array.isArray(root))
    throw new Error(`Settings file ${path} must contain a YAML mapping`);
  return root as SettingsDocument;
}

export function saveSettingsSection(
  fs: FileSystem,
  aiwPath: string,
  section: string,
  value: unknown,
): void {
  const path = `${aiwPath}/${SETTINGS_PATH}`;
  const existing = loadSettings(fs, aiwPath) ?? {};
  existing[section] = value;
  const document = parseDocument(stringify(existing));
  document.set("schema", 1);
  fs.write(path, document.toString());
}

export function serializeSettingOverrides(overrides: FactOverride[]): unknown {
  return overrides.map((item) => ({
    key: item.key,
    action: item.action,
    ...(item.value ? { value: item.value } : {}),
  }));
}

export function readFactOverrides(fs: FileSystem, aiwPath: string): FactOverride[] {
  const settings = loadSettings(fs, aiwPath);
  if (settings !== undefined)
    return "overrides" in settings ? parseSettingOverrides(settings.overrides) : [];
  const legacyPath = `${aiwPath}/overrides.yml`;
  if (!fs.exists(legacyPath)) return [];
  return parseOverrides(fs.read(legacyPath));
}

export function saveSettingOverrides(
  fs: FileSystem,
  aiwPath: string,
  overrides: FactOverride[],
): void {
  saveSettingsSection(fs, aiwPath, "overrides", serializeSettingOverrides(overrides));
}

export function parseSettingOverrides(raw: unknown): FactOverride[] {
  if (!Array.isArray(raw)) throw new Error("Settings overrides section must be a list");
  return raw.map((item): FactOverride => {
    if (!item || typeof item !== "object") throw new Error("Invalid settings override entry");
    const entry = item as Record<string, unknown>;
    if (typeof entry.key !== "string" || entry.key.trim() === "")
      throw new Error("Settings override key must be a non-empty string");
    if (entry.action !== "accept" && entry.action !== "reject" && entry.action !== "edit")
      throw new Error(`Invalid settings override action for key ${entry.key}`);
    if (entry.action === "edit" && (typeof entry.value !== "string" || entry.value === ""))
      throw new Error(`Settings override ${entry.key} requires a value for an edit action`);
    return {
      key: entry.key,
      action: entry.action,
      ...(typeof entry.value === "string" && entry.value !== "" ? { value: entry.value } : {}),
    };
  });
}

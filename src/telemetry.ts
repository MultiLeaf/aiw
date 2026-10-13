import type { CommandResult, FileSystem } from "./types.js";
import { loadSettings, saveSettingsSection } from "./settings.js";

export type TelemetryConfig = {
  schema: 1;
  enabled: boolean;
  includeCommand: boolean;
  includeOutcome: boolean;
};

export type TelemetryEvent = {
  schema: 1;
  command?: string;
  outcome?: "success" | "failure";
};

export interface TelemetryClient {
  record(event: TelemetryEvent): Promise<void>;
}

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  schema: 1,
  enabled: false,
  includeCommand: true,
  includeOutcome: true,
};

export const TELEMETRY_CONSENT_PROMPT =
  "Enable anonymous telemetry? Each event contains only the command name and its outcome (success or failure) - never arguments, file paths, or file contents. [y/N] ";

export async function offerTelemetryConsent(
  fs: FileSystem,
  aiwPath: string,
  answer: (question: string) => Promise<string>,
): Promise<boolean> {
  const settings = loadSettings(fs, aiwPath);
  if (settings !== undefined && "telemetry" in settings)
    return loadTelemetryConfig(fs, aiwPath).enabled;
  const response = (await answer(TELEMETRY_CONSENT_PROMPT)).trim().toLowerCase();
  const enabled = response === "y" || response === "yes";
  saveSettingsSection(
    fs,
    aiwPath,
    "telemetry",
    serializeTelemetryMapping({
      schema: 1,
      enabled,
      includeCommand: true,
      includeOutcome: true,
    }),
  );
  return enabled;
}

const TELEMETRY_COMMANDS = new Set([
  "adr",
  "audit-package",
  "brainstorm",
  "capabilities",
  "confirm",
  "context",
  "context-quality",
  "context-summary",
  "decision",
  "doctor",
  "gate",
  "generate",
  "install",
  "organization-policy",
  "plan",
  "plugin",
  "policy-check",
  "preset",
  "recommend",
  "registry",
  "repair",
  "resolve",
  "rollback",
  "scan",
  "self-validate",
  "semantic",
  "skills",
  "spec",
  "status",
  "sync",
  "target",
  "telemetry",
  "token-usage",
  "trace",
  "uninstall",
  "update",
  "validate",
  "verify",
  "verify-package",
]);

export function parseTelemetryMapping(raw: unknown): TelemetryConfig {
  if (!raw || typeof raw !== "object") throw new Error("telemetry settings must be a mapping");
  const record = raw as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") throw new Error("telemetry.enabled must be a boolean");
  if (typeof record.include_command !== "boolean")
    throw new Error("telemetry.include_command must be a boolean");
  if (typeof record.include_outcome !== "boolean")
    throw new Error("telemetry.include_outcome must be a boolean");
  return {
    schema: 1,
    enabled: record.enabled,
    includeCommand: record.include_command,
    includeOutcome: record.include_outcome,
  };
}

export function serializeTelemetryMapping(config: TelemetryConfig): unknown {
  return {
    enabled: config.enabled,
    include_command: config.includeCommand,
    include_outcome: config.includeOutcome,
  };
}

export function loadTelemetryConfig(fs: FileSystem, aiwPath: string): TelemetryConfig {
  const settings = loadSettings(fs, aiwPath);
  if (settings !== undefined)
    return "telemetry" in settings
      ? parseTelemetryMapping(settings.telemetry)
      : DEFAULT_TELEMETRY_CONFIG;
  const legacyPath = `${aiwPath}/telemetry.yml`;
  if (!fs.exists(legacyPath)) return DEFAULT_TELEMETRY_CONFIG;
  return parseTelemetryConfig(fs.read(legacyPath));
}

export function parseTelemetryConfig(content: string): TelemetryConfig {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== "schema: 1") throw new Error("Telemetry schema must be version 1.");
  if (lines.length !== 5) throw new Error("Telemetry configuration structure is invalid.");
  if (lines[2] !== "privacy:") throw new Error("Telemetry privacy section is required.");
  return {
    schema: 1,
    enabled: booleanLine(lines[1], /^enabled: (true|false)$/, "enabled"),
    includeCommand: booleanLine(
      lines[3],
      /^[ ]{2}include_command: (true|false)$/,
      "include_command",
    ),
    includeOutcome: booleanLine(
      lines[4],
      /^[ ]{2}include_outcome: (true|false)$/,
      "include_outcome",
    ),
  };
}

export function serializeTelemetryConfig(config: TelemetryConfig): string {
  return `schema: 1\nenabled: ${config.enabled}\nprivacy:\n  include_command: ${config.includeCommand}\n  include_outcome: ${config.includeOutcome}\n`;
}

export function createTelemetryEvent(
  command: string | undefined,
  result: CommandResult,
  config: TelemetryConfig,
): TelemetryEvent | undefined {
  if (!config.enabled) return undefined;
  return {
    schema: 1,
    ...(config.includeCommand ? { command: safeCommand(command) } : {}),
    ...(config.includeOutcome ? { outcome: result.exitCode === 0 ? "success" : "failure" } : {}),
  };
}

export const TELEMETRY_BUFFER_FILE = "telemetry-buffer.jsonl";
export const TELEMETRY_BUFFER_CAP = 200;

export function telemetryBufferPath(aiwPath: string): string {
  return `${aiwPath}/${TELEMETRY_BUFFER_FILE}`;
}

export function readTelemetryBuffer(fs: FileSystem, aiwPath: string): TelemetryEvent[] {
  const path = telemetryBufferPath(aiwPath);
  if (!fs.exists(path)) return [];
  return fs
    .read(path)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parsed = JSON.parse(line) as TelemetryEvent;
      if (parsed.schema !== 1) throw new Error("Invalid buffered telemetry event");
      return parsed;
    });
}

export function appendTelemetryBuffer(
  fs: FileSystem,
  aiwPath: string,
  event: TelemetryEvent,
): void {
  const buffered = [...readTelemetryBuffer(fs, aiwPath), event];
  const rotated = buffered.slice(Math.max(0, buffered.length - TELEMETRY_BUFFER_CAP));
  fs.write(
    telemetryBufferPath(aiwPath),
    `${rotated.map((item) => JSON.stringify(item)).join("\n")}\n`,
  );
}

export function purgeTelemetryBuffer(fs: FileSystem, aiwPath: string): void {
  const path = telemetryBufferPath(aiwPath);
  if (fs.exists(path) && fs.remove) fs.remove(path);
}

export async function recordConfiguredTelemetry(
  fs: FileSystem,
  aiwPath: string,
  client: TelemetryClient | undefined,
  command: string | undefined,
  result: CommandResult,
): Promise<void> {
  if (!client) {
    try {
      const config = loadTelemetryConfig(fs, aiwPath);
      const settings = loadSettings(fs, aiwPath);
      const configured =
        (settings !== undefined && "telemetry" in settings) ||
        fs.exists(`${aiwPath}/telemetry.yml`);
      if (configured) {
        const event = createTelemetryEvent(command, result, config);
        if (event) appendTelemetryBuffer(fs, aiwPath, event);
      }
    } catch {
      // Telemetry must never affect the requested workflow operation.
    }
    return;
  }
  try {
    const config = loadTelemetryConfig(fs, aiwPath);
    const settings = loadSettings(fs, aiwPath);
    const configured =
      (settings !== undefined && "telemetry" in settings) || fs.exists(`${aiwPath}/telemetry.yml`);
    if (!configured) return;
    const event = createTelemetryEvent(command, result, config);
    if (event) await client.record(event);
  } catch {
    // Telemetry must never affect the requested workflow operation.
  }
}

function safeCommand(command: string | undefined): string {
  return command && TELEMETRY_COMMANDS.has(command) ? command : "unknown";
}

function booleanLine(line: string | undefined, pattern: RegExp, key: string): boolean {
  const parsed = line?.match(pattern)?.[1];
  if (!parsed) throw new Error(`Telemetry field '${key}' must be true or false.`);
  return parsed === "true";
}

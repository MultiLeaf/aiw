import type { CommandResult, FileSystem } from "./types.js";

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

const TELEMETRY_COMMANDS = new Set([
  "adr",
  "audit-package",
  "brainstorm",
  "capabilities",
  "confirm",
  "context",
  "context-quality",
  "context-summary",
  "doctor",
  "gate",
  "generate",
  "install",
  "organization-policy",
  "plan",
  "policy-check",
  "preset",
  "recommend",
  "registry",
  "repair",
  "resolve",
  "rollback",
  "scan",
  "self-validate",
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

export async function recordConfiguredTelemetry(
  fs: FileSystem,
  configPath: string,
  client: TelemetryClient | undefined,
  command: string | undefined,
  result: CommandResult,
): Promise<void> {
  if (!client || !fs.exists(configPath)) return;
  try {
    const event = createTelemetryEvent(command, result, parseTelemetryConfig(fs.read(configPath)));
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

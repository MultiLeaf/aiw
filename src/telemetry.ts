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
  const schema = value(content, "schema");
  if (schema !== "1") throw new Error("Telemetry schema must be version 1.");
  return {
    schema: 1,
    enabled: booleanValue(content, "enabled"),
    includeCommand: booleanValue(content, "include_command"),
    includeOutcome: booleanValue(content, "include_outcome"),
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

function value(content: string, key: string): string | undefined {
  return content.match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, "m"))?.[1];
}

function booleanValue(content: string, key: string): boolean {
  const parsed = value(content, key);
  if (parsed !== "true" && parsed !== "false")
    throw new Error(`Telemetry field '${key}' must be true or false.`);
  return parsed === "true";
}

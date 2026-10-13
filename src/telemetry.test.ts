import { describe, expect, it } from "vitest";
import {
  createTelemetryEvent,
  purgeTelemetryBuffer,
  readTelemetryBuffer,
  recordConfiguredTelemetry,
  serializeTelemetryMapping,
  TELEMETRY_BUFFER_CAP,
  parseTelemetryConfig,
  serializeTelemetryConfig,
  type TelemetryConfig,
} from "./telemetry.js";
import type { FileSystem } from "./types.js";
import { saveSettingsSection } from "./settings.js";

const enabled: TelemetryConfig = {
  schema: 1,
  enabled: true,
  includeCommand: true,
  includeOutcome: true,
};

describe("telemetry privacy", () => {
  it("round-trips explicit telemetry preferences", () => {
    expect(parseTelemetryConfig(serializeTelemetryConfig(enabled))).toEqual(enabled);
    expect(() => parseTelemetryConfig("schema: 2\n")).toThrow("version 1");
    expect(() =>
      parseTelemetryConfig(
        "unrelated:\n  schema: 1\n  enabled: true\n  privacy:\n    include_command: true\n    include_outcome: true\n",
      ),
    ).toThrow("Telemetry");
    expect(() =>
      parseTelemetryConfig(`${serializeTelemetryConfig(enabled)}token: secret\n`),
    ).toThrow("structure");
  });

  it("creates only allowlisted aggregate fields", () => {
    expect(createTelemetryEvent("scan", { exitCode: 1, error: "secret path" }, enabled)).toEqual({
      schema: 1,
      command: "scan",
      outcome: "failure",
    });
    expect(
      createTelemetryEvent(
        "ordinary-secret",
        { exitCode: 0 },
        { ...enabled, includeOutcome: false },
      ),
    ).toEqual({ schema: 1, command: "unknown" });
    expect(
      createTelemetryEvent("semantic", { exitCode: 0 }, { ...enabled, includeOutcome: false }),
    ).toEqual({ schema: 1, command: "semantic" });
    expect(
      createTelemetryEvent("decision", { exitCode: 1 }, { ...enabled, includeCommand: false }),
    ).toEqual({ schema: 1, outcome: "failure" });
  });

  it("emits nothing unless telemetry is explicitly enabled", () => {
    expect(createTelemetryEvent("scan", { exitCode: 0 }, { ...enabled, enabled: false })).toBe(
      undefined,
    );
  });
});

describe("local telemetry buffer", () => {
  it("accumulates events in a rotated local buffer without a host client", async () => {
    const files: Record<string, string> = {};
    const fs = memoryFs(files);
    saveSettingsSection(fs, ".aiw", "telemetry", serializeTelemetryMapping(enabled));
    await recordConfiguredTelemetry(fs, ".aiw", undefined, "scan", { exitCode: 0 });
    await recordConfiguredTelemetry(fs, ".aiw", undefined, "doctor", { exitCode: 1 });
    const buffered = readTelemetryBuffer(fs, ".aiw");
    expect(buffered).toEqual([
      { schema: 1, command: "scan", outcome: "success" },
      { schema: 1, command: "doctor", outcome: "failure" },
    ]);
  });

  it("keeps only the most recent events up to the retention cap", async () => {
    const files: Record<string, string> = {};
    const fs = memoryFs(files);
    saveSettingsSection(fs, ".aiw", "telemetry", serializeTelemetryMapping(enabled));
    for (let index = 0; index < TELEMETRY_BUFFER_CAP + 5; index += 1)
      await recordConfiguredTelemetry(fs, ".aiw", undefined, "scan", { exitCode: 0 });
    const buffered = readTelemetryBuffer(fs, ".aiw");
    expect(buffered).toHaveLength(TELEMETRY_BUFFER_CAP);
    expect(files[".aiw/telemetry-buffer.jsonl"].trim().split("\n")).toHaveLength(
      TELEMETRY_BUFFER_CAP,
    );
  });

  it("records nothing locally when telemetry is disabled or unconfigured", async () => {
    const files: Record<string, string> = {};
    const fs = memoryFs(files);
    await recordConfiguredTelemetry(fs, ".aiw", undefined, "scan", { exitCode: 0 });
    expect(fs.exists(".aiw/telemetry-buffer.jsonl")).toBe(false);
    saveSettingsSection(
      fs,
      ".aiw",
      "telemetry",
      serializeTelemetryMapping({ ...enabled, enabled: false }),
    );
    await recordConfiguredTelemetry(fs, ".aiw", undefined, "scan", { exitCode: 0 });
    expect(fs.exists(".aiw/telemetry-buffer.jsonl")).toBe(false);
  });

  it("prefers the host client and never buffers alongside it", async () => {
    const files: Record<string, string> = {};
    const fs = memoryFs(files);
    saveSettingsSection(fs, ".aiw", "telemetry", serializeTelemetryMapping(enabled));
    const recorded: unknown[] = [];
    await recordConfiguredTelemetry(
      fs,
      ".aiw",
      { record: async (e) => void recorded.push(e) },
      "scan",
      { exitCode: 0 },
    );
    expect(recorded).toEqual([{ schema: 1, command: "scan", outcome: "success" }]);
    expect(fs.exists(".aiw/telemetry-buffer.jsonl")).toBe(false);
  });

  it("purges the buffer", async () => {
    const files: Record<string, string> = {};
    const fs = memoryFs(files);
    saveSettingsSection(fs, ".aiw", "telemetry", serializeTelemetryMapping(enabled));
    await recordConfiguredTelemetry(fs, ".aiw", undefined, "scan", { exitCode: 0 });
    expect(readTelemetryBuffer(fs, ".aiw")).toHaveLength(1);
    purgeTelemetryBuffer(fs, ".aiw");
    expect(readTelemetryBuffer(fs, ".aiw")).toEqual([]);
  });
});

function memoryFs(files: Record<string, string>): FileSystem {
  return {
    exists: (path: string): boolean => path in files,
    read: (path: string): string => files[path],
    write: (path: string, content: string): void => {
      files[path] = content;
    },
    mkdir: (): void => {},
    remove: (path: string): void => {
      delete files[path];
    },
  };
}

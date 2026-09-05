import { describe, expect, it } from "vitest";
import {
  createTelemetryEvent,
  parseTelemetryConfig,
  serializeTelemetryConfig,
  type TelemetryConfig,
} from "./telemetry.js";

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
  });

  it("emits nothing unless telemetry is explicitly enabled", () => {
    expect(createTelemetryEvent("scan", { exitCode: 0 }, { ...enabled, enabled: false })).toBe(
      undefined,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  describeHeartbeatOutcome,
  emptyHeartbeatState,
  parseHeartbeatState,
  recordBeat,
  serializeHeartbeatCheckpoint,
  serializeHeartbeatState,
  validateHeartbeatThresholds,
} from "./heartbeat.js";
import { installHeartbeatHooks, parseClaudeSettings } from "./hook-installer.js";

const start = new Date("2026-10-20T10:00:00Z");
const beat = (secondsLater: number): Date => new Date(start.getTime() + secondsLater * 1000);

describe("heartbeat engine", () => {
  it("tracks session-start and active beats without acting", () => {
    let state = emptyHeartbeatState();
    const first = recordBeat(state, "s1", start);
    expect(first.outcome.decision).toBe("session-start");
    expect(first.outcome.checkpoint).toBeUndefined();
    state = first.state;
    const active = recordBeat(state, "s1", beat(37));
    expect(active.outcome.decision).toBe("active");
    expect(active.outcome.gapSeconds).toBe(37);
    expect(active.outcome.checkpoint).toBeUndefined();
    expect(active.state.sessions[0].beats).toBe(2);
  });

  it("orders compact-before-expiry inside the warn window while the cache is warm", () => {
    const state = recordBeat(emptyHeartbeatState(), "s1", start).state;
    const warm = recordBeat(state, "s1", beat(4 * 60 + 33));
    expect(warm.outcome.decision).toBe("compact-before-expiry");
    expect(warm.outcome.gapSeconds).toBe(273);
    expect(warm.outcome.checkpoint).toEqual({
      session: "s1",
      index: 1,
      decision: "compact-before-expiry",
    });
    expect(warm.state.sessions[0].status).toBe("warm");
    expect(describeHeartbeatOutcome(warm.outcome)).toContain("cache still warm");
  });

  it("marks expired caches cold and checkpoints for the next gap", () => {
    const state = recordBeat(emptyHeartbeatState(), "s1", start).state;
    const expired = recordBeat(state, "s1", beat(8 * 60));
    expect(expired.outcome.decision).toBe("cache-expired");
    expect(expired.state.sessions[0].status).toBe("cold");
    expect(expired.state.sessions[0].actions).toBe(1);
    expect(describeHeartbeatOutcome(expired.outcome)).toContain("paid the rebuild");
  });

  it("round-trips state and increments checkpoint indexes across actions", () => {
    let state = recordBeat(emptyHeartbeatState(), "s1", start).state;
    state = recordBeat(state, "s1", beat(500)).state;
    const second = recordBeat(state, "s1", beat(1200));
    expect(second.outcome.checkpoint?.index).toBe(2);
    const restored = parseHeartbeatState(serializeHeartbeatState(second.state));
    expect(restored).toEqual(second.state);
    expect(serializeHeartbeatCheckpoint(second.outcome.checkpoint!, 700, 300)).toContain(
      "decision: cache-expired",
    );
    expect(parseHeartbeatState("")).toEqual(emptyHeartbeatState());
  });

  it("validates thresholds", () => {
    expect(() => validateHeartbeatThresholds(300, 300)).toThrow(/smaller/);
    expect(() => validateHeartbeatThresholds(0, 300)).toThrow(/positive integer/);
    expect(() => recordBeat(emptyHeartbeatState(), "s1", start, 400, 300)).toThrow();
    expect(() => recordBeat(emptyHeartbeatState(), " ", start)).toThrow(/session id/);
  });
});

describe("claude code hook installer", () => {
  it("adds heartbeat hooks to empty settings and stays idempotent", () => {
    const first = installHeartbeatHooks(parseClaudeSettings(""));
    expect(first.added).toEqual(["Stop", "UserPromptSubmit"]);
    const second = installHeartbeatHooks(first.settings);
    expect(second.added).toEqual([]);
    expect(second.alreadyPresent).toEqual(["Stop", "UserPromptSubmit"]);
  });

  it("preserves foreign hooks untouched", () => {
    const existing = parseClaudeSettings(
      JSON.stringify({
        permissions: { allow: ["Bash(npm test)"] },
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
      }),
    );
    const result = installHeartbeatHooks(existing);
    expect(result.settings.hooks.Stop).toHaveLength(2);
    expect(result.settings.hooks.Stop[0].hooks[0].command).toBe("echo done");
    expect(result.settings.permissions).toEqual({ allow: ["Bash(npm test)"] });
  });

  it("rejects malformed settings files instead of overwriting them", () => {
    expect(() => parseClaudeSettings("[]")).toThrow(/JSON object/);
    expect(() => parseClaudeSettings('{"hooks":{"Stop":"nope"}}')).toThrow(/list/);
  });
});

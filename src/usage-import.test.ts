import { describe, expect, it } from "vitest";
import {
  mergeImportedEvents,
  parseClaudeCodeTranscript,
  parseCodexSession,
  parseGeminiTranscript,
  parsePiSession,
} from "./usage-import.js";
import type { UsageSidecarEntry } from "./usage-sidecar.js";

const claudeLine = (id: string, usage: Record<string, number>, model = "gpt-5.6-terra"): string =>
  JSON.stringify({
    type: "assistant",
    sessionId: "sess-1",
    version: "2.1.257",
    message: { id, model, usage },
  });

describe("claude code import", () => {
  it("maps all four tiers, dedupes stream chunks by message id", () => {
    const usage = {
      input_tokens: 900,
      cache_creation_input_tokens: 400,
      cache_read_input_tokens: 8000,
      output_tokens: 150,
    };
    const events = parseClaudeCodeTranscript(
      [claudeLine("msg-1", usage), claudeLine("msg-1", usage), claudeLine("msg-2", usage)].join(
        "\n",
      ),
    );
    expect(events).toHaveLength(2);
    expect(events[0].tiers).toEqual({
      "fresh-input": 900,
      "cache-write": 400,
      "cache-read": 8000,
      output: 150,
    });
    expect(events[0]).toMatchObject({
      label: "measured",
      harness: "claude-code",
      harnessVersion: "2.1.257",
      model: "gpt-5.6-terra",
    });
    expect(events[0].command).toMatch(/^import\.claude-code\.e[0-9a-f]{12}$/);
  });

  it("skips lines without usage or with non-assistant types", () => {
    expect(
      parseClaudeCodeTranscript(
        [
          JSON.stringify({ type: "user", message: { id: "u1" } }),
          "not json",
          claudeLine("m", { input_tokens: 1 }),
        ].join("\n"),
      ),
    ).toHaveLength(1);
  });
});

describe("codex import", () => {
  const session = (cwd: string): string =>
    [
      JSON.stringify({ type: "session_meta", payload: { cwd, cli_version: "0.162.1" } }),
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.6-codex" } }),
      JSON.stringify({
        type: "token_usage_record",
        ordinal: 14,
        payload: {
          response_id: "resp_1",
          turn_id: "t1",
          usage: {
            input_tokens: 21700,
            cached_input_tokens: 7936,
            cache_write_input_tokens: 200,
            output_tokens: 129,
          },
        },
      }),
    ].join("\n");

  it("separates cached input from fresh and scopes sessions by cwd", () => {
    const events = parseCodexSession(session("/Users/x/proj"), "/Users/x/proj");
    expect(events).toHaveLength(1);
    expect(events[0].tiers).toEqual({
      "cache-read": 7936,
      "cache-write": 200,
      "fresh-input": 21700 - 7936 - 200,
      output: 129,
    });
    expect(events[0]).toMatchObject({
      harness: "codex",
      harnessVersion: "0.162.1",
      model: "gpt-5.6-codex",
      label: "measured",
    });
    expect(parseCodexSession(session("/Users/x/other"), "/Users/x/proj")).toBeUndefined();
    expect(parseCodexSession("{}", "/Users/x/proj")).toBeUndefined();
  });
});

describe("gemini import", () => {
  it("maps planner responses with input, cache-read, and output", () => {
    const events = parseGeminiTranscript(
      [
        JSON.stringify({ type: "USER_INPUT", step_index: 0, input_tokens: 5 }),
        JSON.stringify({
          type: "PLANNER_RESPONSE",
          step_index: 1,
          created_at: "2026-10-09T08:32:27Z",
          input_tokens: 15183,
          cache_read_tokens: 3200,
          output_tokens: 740,
        }),
      ].join("\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0].tiers).toEqual({
      "fresh-input": 15183,
      "cache-read": 3200,
      "cache-write": 0,
      output: 740,
    });
    expect(events[0].harness).toBe("gemini-cli");
  });
});

describe("idempotent merge", () => {
  it("never double-imports the same event identity", () => {
    const events = parseClaudeCodeTranscript(
      claudeLine("msg-1", { input_tokens: 10, output_tokens: 2 }),
    );
    const first = mergeImportedEvents([], events);
    expect(first.imported).toBe(1);
    const second = mergeImportedEvents(first.ledger, events);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.ledger).toHaveLength(1);
    const ledger: UsageSidecarEntry[] = first.ledger;
    expect(ledger[0].seq).toBe(1);
  });
});

describe("pi import", () => {
  const piMessage = (
    id: string,
    provider: string,
    model: string,
    usage: Record<string, number>,
  ): string =>
    JSON.stringify({
      type: "message",
      id,
      timestamp: "2026-10-19T22:14:25.530Z",
      message: { role: "assistant", provider, model, usage },
    });
  const piUsageEntry = (id: string, kind: string, usage: Record<string, number>): string =>
    JSON.stringify({
      type: "usage",
      id,
      kind,
      provider: "anthropic",
      model: "claude-sonnet-5",
      usage,
    });

  it("maps per-message tiers with provider and model attribution", () => {
    const events = parsePiSession(
      [
        piMessage("m1", "zai", "glm-5.3", {
          input: 1571,
          output: 177,
          cacheRead: 1152,
          cacheWrite: 0,
        }),
        JSON.stringify({ type: "message", id: "u1", message: { role: "user" } }),
        piMessage("m1", "zai", "glm-5.3", { input: 1571, output: 177, cacheRead: 1152 }), // same id: dedup via stable identity? keep — pi ids are unique per entry
      ].join("\n"),
    );
    expect(events).toHaveLength(2);
    expect(events[0].tiers).toEqual({
      "fresh-input": 1571,
      "cache-read": 1152,
      "cache-write": 0,
      output: 177,
    });
    expect(events[0]).toMatchObject({
      harness: "pi",
      provider: "zai",
      model: "glm-5.3",
      label: "measured",
    });
  });

  it("imports dedicated usage entries (e.g. cache warming) with top-level provider", () => {
    const events = parsePiSession(
      [
        piUsageEntry("u9", "cache_warm", { input: 0, output: 0, cacheRead: 50000, cacheWrite: 0 }),
      ].join("\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0].tiers["cache-read"]).toBe(50000);
    expect(events[0].provider).toBe("anthropic");
  });
});

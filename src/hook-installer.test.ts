import { describe, expect, it } from "vitest";
import { memoryFileSystem } from "./fixtures/plugin-files.js";
import {
  AIW_HEARTBEAT_EVENTS,
  CLAUDE_HOOK_COMMAND,
  installHeartbeatHooks,
  parseClaudeSettings,
  writeClaudeSettings,
} from "./hook-installer.js";

describe("Claude Code heartbeat hook installer", () => {
  it("parses valid settings JSON and rejects non-objects or malformed hooks maps", () => {
    expect(parseClaudeSettings("")).toEqual({});
    expect(parseClaudeSettings('{"permissions":{"allow":[]}}')).toEqual({
      permissions: { allow: [] },
    });
    expect(() => parseClaudeSettings("[]")).toThrow("must be a JSON object");
    expect(() => parseClaudeSettings('{"hooks":[]}')).toThrow("must be an object");
    expect(() => parseClaudeSettings('{"hooks":{"Stop":"bad"}}')).toThrow("must be a list");
  });

  it("appends heartbeat hooks idempotently while preserving unrelated settings and hooks", () => {
    const initial = parseClaudeSettings(
      JSON.stringify({
        theme: "dark",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "echo custom-stop" }] }],
        },
      }),
    );
    const first = installHeartbeatHooks(initial);
    expect(first.added).toEqual([...AIW_HEARTBEAT_EVENTS]);
    expect(first.alreadyPresent).toEqual([]);
    expect(first.settings.theme).toBe("dark");
    expect(first.settings.hooks?.Stop).toHaveLength(2);
    expect(first.settings.hooks?.Stop?.[0].hooks[0].command).toBe("echo custom-stop");
    expect(first.settings.hooks?.Stop?.[1].hooks[0].command).toBe(CLAUDE_HOOK_COMMAND);

    const second = installHeartbeatHooks(first.settings);
    expect(second.added).toEqual([]);
    expect(second.alreadyPresent).toEqual([...AIW_HEARTBEAT_EVENTS]);
    expect(second.settings.hooks?.Stop).toHaveLength(2);

    const fs = memoryFileSystem();
    writeClaudeSettings(fs, "/project/.claude/settings.json", second.settings);
    expect(parseClaudeSettings(fs.read("/project/.claude/settings.json"))).toEqual(second.settings);
  });
});

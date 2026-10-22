import type { FileSystem } from "./types.js";

/**
 * Claude Code hook installer: wires harness events to `aiw heartbeat`
 * without a scheduler. Project-scoped: writes `.claude/settings.json` in
 * the repository, never the user's global settings.
 *
 * Merge policy: existing hooks the project already declares are preserved
 * untouched; AIW only appends its own entries, identified by the
 * `aiw heartbeat` command, and skips them when already present
 * (idempotent). Any JSON that is not a settings object is a hard conflict.
 */

export const CLAUDE_HOOK_COMMAND = "npx --yes --package=@multileaf/ai-workflow -- aiw heartbeat";

export type ClaudeHookEntry = { hooks: { type: string; command: string; timeout?: number }[] };
export type ClaudeSettings = { hooks?: Record<string, ClaudeHookEntry[]> } & Record<
  string,
  unknown
>;

export const AIW_HEARTBEAT_EVENTS = ["Stop", "UserPromptSubmit"] as const;

export function parseClaudeSettings(content: string): ClaudeSettings {
  if (!content.trim()) return {};
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(".claude/settings.json must be a JSON object.");
  const settings = parsed as ClaudeSettings;
  if (settings.hooks !== undefined) {
    if (
      typeof settings.hooks !== "object" ||
      settings.hooks === null ||
      Array.isArray(settings.hooks)
    )
      throw new Error(".claude/settings.json hooks must be an object keyed by event name.");
    for (const [event, entries] of Object.entries(settings.hooks))
      if (!Array.isArray(entries))
        throw new Error(`.claude/settings.json hooks.${event} must be a list.`);
  }
  return settings;
}

export function installHeartbeatHooks(settings: ClaudeSettings): {
  settings: ClaudeSettings;
  added: string[];
  alreadyPresent: string[];
} {
  const hooks = { ...(settings.hooks ?? {}) };
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  for (const event of AIW_HEARTBEAT_EVENTS) {
    const entries = hooks[event] ? [...hooks[event]] : [];
    const exists = entries.some((entry) =>
      entry.hooks?.some((hook) => hook.command === CLAUDE_HOOK_COMMAND),
    );
    if (exists) alreadyPresent.push(event);
    else {
      entries.push({
        hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, timeout: 15 }],
      });
      added.push(event);
    }
    hooks[event] = entries;
  }
  return { settings: { ...settings, hooks }, added, alreadyPresent };
}

export function writeClaudeSettings(fs: FileSystem, path: string, settings: ClaudeSettings): void {
  fs.write(path, `${JSON.stringify(settings, null, 2)}\n`);
}

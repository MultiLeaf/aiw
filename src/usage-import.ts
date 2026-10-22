import { createHash } from "node:crypto";
import type { UsageSidecarEntry, UsageTier } from "./usage-sidecar.js";

/**
 * Deterministic importers that turn local harness session logs into
 * measured sidecar entries (the switchboard pattern: raw logs -> canonical
 * ledger via per-source converters; no LLM, no network, no timestamps).
 *
 * Formats were validated against real logs:
 * - Claude Code: the .jsonl transcripts under ~/.claude/projects/<munged-root>
 *   carry message.usage with all four tiers; stream chunks
 *   duplicate per message.id, so entries are deduplicated by message id.
 * - Codex: the recursive rollout-*.jsonl tree under ~/.codex/sessions — token_usage_record entries; input_tokens includes the cached subset; session_meta.cwd
 *   scopes a session to this project.
 * - Gemini (antigravity-cli): the transcript_full.jsonl logs under the ~/.gemini/antigravity-cli/brain sessions — PLANNER_RESPONSE entries with
 *   input/cache_read/output. Sessions do not record their working
 *   directory, so Gemini imports cannot be scoped per project.
 *
 * - Pi (pi.dev): the session JSONL tree under ~/.pi/agent/sessions, grouped
 *   by project directory. Assistant messages carry per-message usage with
 *   all four tiers plus the provider and model, and dedicated usage entries
 *   (for example cache warming) record model-attributed consumption that
 *   never becomes a message.
 *
 * Import is idempotent: each event derives a stable command identity
 * (`import.<source>.<hash>`), and events already present in the ledger
 * are skipped, so reruns never double-count.
 */

export type ImportSource = "claude-code" | "codex" | "gemini" | "pi";

/** An event ready to append: no seq (assigned by the ledger). */
export type ImportedUsageEvent = Omit<UsageSidecarEntry, "seq">;

export type ImportResult = {
  source: ImportSource;
  files: number;
  events: number;
  imported: number;
  skipped: number;
};

const zeroTiers = (): Record<UsageTier, number> => ({
  "cache-read": 0,
  "fresh-input": 0,
  "cache-write": 0,
  output: 0,
});

const tiersOf = (values: Partial<Record<UsageTier, number>>): Record<UsageTier, number> => ({
  ...zeroTiers(),
  ...Object.fromEntries(
    (Object.entries(values) as [UsageTier, number][]).filter(([, value]) => value > 0),
  ),
});

function event(
  source: ImportSource,
  identity: string,
  tiers: Record<UsageTier, number>,
  extra: { model?: string; harnessVersion?: string; provider?: string } = {},
): ImportedUsageEvent | undefined {
  if (!USAGE_TIERS_NONZERO(tiers)) return undefined;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  const imported: ImportedUsageEvent | undefined = {
    command: `import.${source}.e${hash}`,
    label: "measured",
    tiers,
    harness: source === "gemini" ? "gemini-cli" : source,
    ...(extra.model ? { model: extra.model } : {}),
    ...(extra.provider ? { provider: extra.provider } : {}),
    ...(extra.harnessVersion ? { harnessVersion: extra.harnessVersion } : {}),
  };
  return imported;
}

function USAGE_TIERS_NONZERO(tiers: Record<UsageTier, number>): boolean {
  return (Object.values(tiers) as number[]).some((value) => value > 0);
}

function safeParse(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Claude Code: one JSONL transcript per session; dedupe assistant chunks by message id. */
export function parseClaudeCodeTranscript(content: string): ImportedUsageEvent[] {
  const events: ImportedUsageEvent[] = [];
  const seen = new Set<string>();
  for (const line of content.split("\n")) {
    if (!line.includes('"usage"')) continue;
    const entry = safeParse(line);
    if (!entry || entry.type !== "assistant") continue;
    const message = entry.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, number> | undefined;
    if (!message || !usage) continue;
    const messageId = String(message.id ?? "");
    if (!messageId || seen.has(messageId)) continue;
    seen.add(messageId);
    const parsed = event(
      "claude-code",
      `${entry.sessionId ?? ""}:${messageId}`,
      tiersOf({
        "fresh-input": usage.input_tokens ?? 0,
        "cache-write": usage.cache_creation_input_tokens ?? 0,
        "cache-read": usage.cache_read_input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
      }),
      {
        model: typeof message.model === "string" ? message.model : undefined,
        harnessVersion: typeof entry.version === "string" ? entry.version : undefined,
      },
    );
    if (parsed) events.push(parsed);
  }
  return events;
}

/** Codex: rollout JSONL; returns undefined when the session belongs to another project. */
export function parseCodexSession(
  content: string,
  projectRoot: string,
): ImportedUsageEvent[] | undefined {
  const events: ImportedUsageEvent[] = [];
  let sessionCwd: string | undefined;
  let cliVersion: string | undefined;
  let model: string | undefined;
  for (const line of content.split("\n")) {
    const entry = safeParse(line);
    if (!entry) continue;
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    if (entry.type === "session_meta") {
      sessionCwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
      cliVersion = typeof payload.cli_version === "string" ? payload.cli_version : undefined;
      continue;
    }
    if (entry.type === "turn_context" && typeof payload.model === "string") model = payload.model;
    if (entry.type !== "token_usage_record") continue;
    const usage = payload.usage as Record<string, number> | undefined;
    if (!usage) continue;
    const cached = usage.cached_input_tokens ?? 0;
    const cacheWrite = usage.cache_write_input_tokens ?? 0;
    const input = usage.input_tokens ?? 0;
    const parsed = event(
      "codex",
      `${payload.response_id ?? createHash("sha256").update(line).digest("hex").slice(0, 16)}:${payload.turn_id ?? ""}:${entry.ordinal ?? ""}`,
      tiersOf({
        "cache-read": cached,
        "cache-write": cacheWrite,
        "fresh-input": Math.max(0, input - cached - cacheWrite),
        output: usage.output_tokens ?? 0,
      }),
      { model, harnessVersion: cliVersion },
    );
    if (parsed) events.push(parsed);
  }
  if (sessionCwd === undefined) return undefined;
  if (sessionCwd.replace(/\/+$/, "") !== projectRoot.replace(/\/+$/, "")) return undefined;
  return events;
}

/** Gemini (antigravity-cli): transcript_full JSONL; PLANNER_RESPONSE steps carry token counts. */
export function parseGeminiTranscript(content: string): ImportedUsageEvent[] {
  const events: ImportedUsageEvent[] = [];
  for (const line of content.split("\n")) {
    if (!line.includes("input_tokens")) continue;
    const entry = safeParse(line);
    if (!entry || entry.type !== "PLANNER_RESPONSE") continue;
    const num = (value: unknown): number => (typeof value === "number" ? value : 0);
    const parsed = event(
      "gemini",
      `${entry.created_at ?? ""}:${entry.step_index ?? ""}:${createHash("sha256").update(line).digest("hex").slice(0, 16)}`,
      tiersOf({
        "fresh-input": num(entry.input_tokens),
        "cache-read": num(entry.cache_read_tokens),
        output: num(entry.output_tokens),
      }),
    );
    if (parsed) events.push(parsed);
  }
  return events;
}

/** Pi (pi.dev): session JSONL; assistant messages and dedicated usage entries both carry per-message tiers and provider. */
export function parsePiSession(content: string): ImportedUsageEvent[] {
  const events: ImportedUsageEvent[] = [];
  for (const line of content.split("\n")) {
    if (!line.includes('"usage"')) continue;
    const entry = safeParse(line);
    if (!entry) continue;
    const message = entry.message as Record<string, unknown> | undefined;
    const usage = (message?.usage ?? entry.usage) as Record<string, number> | undefined;
    if (!usage) continue;
    if (entry.type === "message" && message?.role !== "assistant") continue;
    const parsed = event(
      "pi",
      String(entry.id ?? createHash("sha256").update(line).digest("hex").slice(0, 16)),
      tiersOf({
        "fresh-input": usage.input ?? 0,
        "cache-read": usage.cacheRead ?? 0,
        "cache-write": usage.cacheWrite ?? 0,
        output: usage.output ?? 0,
      }),
      {
        model:
          typeof message?.model === "string"
            ? message.model
            : typeof entry.model === "string"
              ? entry.model
              : undefined,
        provider:
          typeof message?.provider === "string"
            ? message.provider
            : typeof entry.provider === "string"
              ? entry.provider
              : undefined,
      },
    );
    if (parsed) events.push(parsed);
  }
  return events;
}

/** Merge imported events into a ledger idempotently (already-present command ids are skipped). */
export function mergeImportedEvents(
  ledger: UsageSidecarEntry[],
  events: ImportedUsageEvent[],
): { ledger: UsageSidecarEntry[]; imported: number; skipped: number } {
  const existing = new Set(ledger.map((entry) => entry.command));
  const fresh = events.filter((candidate) => !existing.has(candidate.command));
  return {
    ledger: [
      ...ledger,
      ...fresh.map((candidate, index) => ({ ...candidate, seq: ledger.length + index + 1 })),
    ],
    imported: fresh.length,
    skipped: events.length - fresh.length,
  };
}

export function summarizeImport(result: ImportResult): string {
  return [
    `source: ${result.source}`,
    `files scanned: ${result.files}`,
    `usage events found: ${result.events}`,
    `imported: ${result.imported} (label: measured)`,
    `skipped (already in ledger): ${result.skipped}`,
  ].join("\n");
}

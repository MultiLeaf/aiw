import { parseDocument } from "yaml";

/**
 * Session heartbeat: event-driven cache-TTL management.
 *
 * Harness hooks (Claude Code Stop/UserPromptSubmit, Gemini
 * PostInvocation/Stop, Codex turn notifications) call `aiw heartbeat` on
 * every event. Each beat measures the gap since the previous one:
 *
 * - gap < warn (default 4 min): active session, nothing to do;
 * - warn <= gap < ttl (default 5 min): the provider cache is still warm —
 *   this request just read it at cache price — so a compact checkpoint is
 *   written now: if the session goes idle past the TTL, the next resume
 *   loads a small prefix instead of rebuilding the full one;
 * - gap >= ttl: the cache already expired and this request paid the full
 *   rebuild — a compact checkpoint is written so the *next* gap hurts an
 *   order of magnitude less.
 *
 * The guarantee: a session never pays the full-price prefix rebuild twice
 * in a row on the same context. No timers, no keep-alive pings: the gap is
 * always measured on the next beat, which costs nothing locally.
 *
 * Timestamps are legitimate here: this is operational state (like workflow
 * checkpoints), not a deterministic report.
 */

export const HEARTBEAT_SCHEMA = 1;
export const HEARTBEAT_STATE_PATH = "heartbeats.yml";
export const HEARTBEAT_WARN_SECONDS = 240;
export const HEARTBEAT_TTL_SECONDS = 300;

export type HeartbeatDecision =
  "session-start" | "active" | "compact-before-expiry" | "cache-expired";

export type HeartbeatSession = {
  id: string;
  lastBeat: string;
  beats: number;
  status: "warm" | "cold";
  actions: number;
};

export type HeartbeatState = {
  schema: number;
  sessions: HeartbeatSession[];
};

export type HeartbeatOutcome = {
  decision: HeartbeatDecision;
  gapSeconds: number | undefined;
  session: HeartbeatSession;
  /** Set when a compact checkpoint should be written (decision tier warn/ttl). */
  checkpoint: { session: string; index: number; decision: HeartbeatDecision } | undefined;
};

export function validateHeartbeatThresholds(warnSeconds: number, ttlSeconds: number): void {
  for (const [name, value] of [
    ["warn", warnSeconds],
    ["ttl", ttlSeconds],
  ] as const)
    if (!Number.isInteger(value) || value <= 0)
      throw new Error(`Heartbeat ${name} threshold must be a positive integer (seconds).`);
  if (warnSeconds >= ttlSeconds)
    throw new Error("Heartbeat warn threshold must be smaller than the TTL threshold.");
}

export function emptyHeartbeatState(): HeartbeatState {
  return { schema: HEARTBEAT_SCHEMA, sessions: [] };
}

export function parseHeartbeatState(content: string): HeartbeatState {
  if (!content.trim()) return emptyHeartbeatState();
  const document = parseDocument(content);
  if (document.errors.length) throw new Error("Heartbeat state is not valid YAML.");
  const schema = document.get("schema");
  if (schema !== HEARTBEAT_SCHEMA)
    throw new Error(`Heartbeat state schema must be version ${HEARTBEAT_SCHEMA}.`);
  const sessionsNode = document.get("sessions");
  const sessions: HeartbeatSession[] = [];
  if (sessionsNode !== null && sessionsNode !== undefined) {
    const items = Array.isArray(sessionsNode)
      ? sessionsNode
      : ((sessionsNode as { items?: unknown[] }).items ?? []);
    for (const raw of items as Record<string, unknown>[]) {
      const read = (key: string): unknown =>
        typeof raw.get === "function" ? raw.get(key) : raw[key];
      const id = String(read("id"));
      if (!id.trim()) throw new Error("Heartbeat session id must not be empty.");
      const lastBeat = String(read("last_beat"));
      if (Number.isNaN(Date.parse(lastBeat)))
        throw new Error(`Heartbeat session ${id} has an invalid last_beat timestamp.`);
      sessions.push({
        id,
        lastBeat,
        beats: Number(read("beats")),
        status: read("status") === "cold" ? "cold" : "warm",
        actions: Number(read("actions") ?? 0),
      });
    }
  }
  return { schema: HEARTBEAT_SCHEMA, sessions };
}

export function serializeHeartbeatState(state: HeartbeatState): string {
  const lines = [`schema: ${state.schema}`, "sessions:"];
  if (!state.sessions.length) lines.push("  []");
  for (const session of state.sessions)
    lines.push(
      `  - id: ${session.id}`,
      `    last_beat: ${session.lastBeat}`,
      `    beats: ${session.beats}`,
      `    status: ${session.status}`,
      `    actions: ${session.actions}`,
    );
  return lines.join("\n") + "\n";
}

/** Record a beat and decide. `now` is injectable for deterministic tests. */
export function recordBeat(
  state: HeartbeatState,
  sessionId: string,
  now: Date,
  warnSeconds: number = HEARTBEAT_WARN_SECONDS,
  ttlSeconds: number = HEARTBEAT_TTL_SECONDS,
): { state: HeartbeatState; outcome: HeartbeatOutcome } {
  if (!sessionId.trim()) throw new Error("Heartbeat session id must not be empty.");
  validateHeartbeatThresholds(warnSeconds, ttlSeconds);
  const iso = now.toISOString();
  const previous = state.sessions.find((session) => session.id === sessionId);
  let decision: HeartbeatDecision;
  let gapSeconds: number | undefined;
  if (!previous) {
    decision = "session-start";
  } else {
    gapSeconds = Math.max(0, Math.round((now.getTime() - Date.parse(previous.lastBeat)) / 1000));
    decision =
      gapSeconds < warnSeconds
        ? "active"
        : gapSeconds < ttlSeconds
          ? "compact-before-expiry"
          : "cache-expired";
  }
  const updated: HeartbeatSession = {
    id: sessionId,
    lastBeat: iso,
    beats: (previous?.beats ?? 0) + 1,
    status: decision === "cache-expired" ? "cold" : "warm",
    actions: previous?.actions ?? 0,
  };
  const shouldCheckpoint = decision === "compact-before-expiry" || decision === "cache-expired";
  if (shouldCheckpoint) updated.actions += 1;
  const sessions = state.sessions.filter((session) => session.id !== sessionId).concat(updated);
  sessions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    state: { schema: state.schema, sessions },
    outcome: {
      decision,
      gapSeconds,
      session: updated,
      checkpoint: shouldCheckpoint
        ? { session: sessionId, index: updated.actions, decision }
        : undefined,
    },
  };
}

export function serializeHeartbeatCheckpoint(
  checkpoint: NonNullable<HeartbeatOutcome["checkpoint"]>,
  gapSeconds: number,
  ttlSeconds: number,
): string {
  return (
    [
      "schema: 1",
      `session: ${checkpoint.session}`,
      `decision: ${checkpoint.decision}`,
      `gap_seconds: ${gapSeconds}`,
      `ttl_seconds: ${ttlSeconds}`,
      "action: resume from this checkpoint; prefer harness compaction (/compact) before continuing the session",
    ].join("\n") + "\n"
  );
}

export function describeHeartbeatOutcome(outcome: HeartbeatOutcome): string {
  const gap = outcome.gapSeconds === undefined ? "" : ` (gap ${formatGap(outcome.gapSeconds)})`;
  switch (outcome.decision) {
    case "session-start":
      return `heartbeat: session ${outcome.session.id} started`;
    case "active":
      return `heartbeat: session ${outcome.session.id} active${gap}`;
    case "compact-before-expiry":
      return `heartbeat: session ${outcome.session.id} idle${gap} — cache still warm; compact checkpoint #${outcome.session.actions} saved for a cheap resume`;
    case "cache-expired":
      return `heartbeat: session ${outcome.session.id} idle${gap} — cache expired and this request paid the rebuild; compact checkpoint #${outcome.session.actions} saved so the next gap is cheap`;
  }
}

function formatGap(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m${rest}s` : `${minutes}m`;
}

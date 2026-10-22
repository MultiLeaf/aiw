import { isSeq, parseDocument } from "yaml";

/**
 * Usage sidecar (switchboard pattern): per-run token records with billing
 * tiers, measurement labels, and harness attribution, stored alongside
 * workflow checkpoints.
 *
 * Honest-measurement rules (docs/token-efficiency-study-notes.md):
 * - every entry carries `measured` or `estimated`; aggregates propagate the
 *   label pessimistically (any estimated component makes the total estimated);
 * - no timestamps: entries are ordered by a monotonic sequence number, so
 *   unchanged input produces byte-identical output;
 * - naive `tokens x price` accounting overstates savings on cache-heavy
 *   agents, so tiers are kept separate and cache hit rate is a first-class
 *   metric. Cost conversion is deliberately not built in: provider prices
 *   rot, and unlabeled dollars would be dishonest by default.
 */

export const USAGE_SIDECAR_SCHEMA = 1;
export const USAGE_SIDECAR_PATH = "checkpoints/usage-sidecar.yml";
export const USAGE_SIDECAR_CAP = 500;

export const USAGE_TIERS = ["cache-read", "fresh-input", "cache-write", "output"] as const;
export type UsageTier = (typeof USAGE_TIERS)[number];
export type UsageLabel = "measured" | "estimated";

export type UsageSidecarEntry = {
  seq: number;
  command: string;
  label: UsageLabel;
  tiers: Record<UsageTier, number>;
  model?: string;
  provider?: string;
  harness?: string;
  harnessVersion?: string;
  requirement?: string;
  /** Correlates entries with one SDD task run (`aiw task start --id=` or ticket), start to merged PR. */
  workflow?: string;
};

export type UsageSidecarSummary = {
  entries: number;
  label: UsageLabel;
  tiers: Record<UsageTier, number>;
  cacheHitRate?: number;
  byModel: { model: string; tokens: number; label: UsageLabel }[];
  byHarness: { harness: string; tokens: number; label: UsageLabel }[];
  byProvider: { provider: string; tokens: number; label: UsageLabel }[];
};

export function validateUsageSidecarEntry(entry: UsageSidecarEntry): UsageSidecarEntry {
  if (!Number.isInteger(entry.seq) || entry.seq < 1)
    throw new Error("Usage sidecar seq must be a positive integer.");
  if (!entry.command.trim()) throw new Error("Usage sidecar command must not be empty.");
  for (const tier of USAGE_TIERS) {
    const value = entry.tiers[tier];
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`Usage sidecar tier ${tier} must be a non-negative integer.`);
  }
  if (!USAGE_TIERS.some((tier) => entry.tiers[tier] > 0))
    throw new Error("Usage sidecar entry needs at least one non-zero tier.");
  if (entry.model !== undefined && !entry.model.trim())
    throw new Error("Usage sidecar model must be a non-empty string when present.");
  if (entry.provider !== undefined && !entry.provider.trim())
    throw new Error("Usage sidecar provider must be a non-empty string when present.");
  if (entry.requirement !== undefined && !/^REQ-\d+$/.test(entry.requirement))
    throw new Error("Usage sidecar requirement must use the REQ-### identifier format.");
  if (entry.workflow !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.workflow))
    throw new Error(
      "Usage sidecar workflow must be a workflow id or ticket identifier without spaces.",
    );
  for (const [name, value] of [
    ["harness", entry.harness],
    ["harnessVersion", entry.harnessVersion],
  ] as const)
    if (value !== undefined && !value.trim())
      throw new Error(`Usage sidecar ${name} must be a non-empty string when present.`);
  return entry;
}

export function parseUsageSidecar(content: string): UsageSidecarEntry[] {
  if (!content.trim()) return [];
  const document = parseDocument(content);
  if (document.errors.length) throw new Error("Usage sidecar is not valid YAML.");
  const node = document.get("entries");
  if (node === null || node === undefined) throw new Error("Usage sidecar is missing entries.");
  if (!isSeq(node)) throw new Error("Usage sidecar entries must be a list.");
  const schema = document.get("schema");
  if (schema !== USAGE_SIDECAR_SCHEMA)
    throw new Error(`Usage sidecar schema must be version ${USAGE_SIDECAR_SCHEMA}.`);
  const entries = node.items.map((raw) => {
    const pick = (key: string): unknown =>
      typeof (raw as { get?: unknown }).get === "function"
        ? (raw as { get: (key: string) => unknown }).get(key)
        : (raw as Record<string, unknown>)[key];
    const tiers: Partial<Record<UsageTier, number>> = {};
    const rawTiers = pick("tiers");
    if (rawTiers === null || typeof rawTiers !== "object")
      throw new Error("Usage sidecar entry is missing tiers.");
    const readTier = (tier: string): unknown =>
      typeof (rawTiers as { get?: unknown }).get === "function"
        ? (rawTiers as { get: (key: string) => unknown }).get(tier)
        : (rawTiers as Record<string, unknown>)[tier];
    for (const tier of USAGE_TIERS) {
      const value = readTier(tier);
      if (value !== null && value !== undefined) tiers[tier] = value as number;
    }
    const optional = (key: string): string | undefined => {
      const value = pick(key);
      return value === null || value === undefined ? undefined : String(value);
    };
    return validateUsageSidecarEntry({
      seq: pick("seq") as number,
      command: String(pick("command")),
      label: pick("label") as UsageLabel,
      tiers: Object.fromEntries(USAGE_TIERS.map((tier) => [tier, tiers[tier] ?? 0])) as Record<
        UsageTier,
        number
      >,
      ...(optional("model") === undefined ? {} : { model: optional("model") }),
      ...(optional("provider") === undefined ? {} : { provider: optional("provider") }),
      ...(optional("harness") === undefined ? {} : { harness: optional("harness") }),
      ...(optional("harness_version") === undefined
        ? {}
        : { harnessVersion: optional("harness_version") }),
      ...(optional("requirement") === undefined ? {} : { requirement: optional("requirement") }),
      ...(optional("workflow") === undefined ? {} : { workflow: optional("workflow") }),
    });
  });
  const sequences = entries.map((entry: UsageSidecarEntry) => entry.seq);
  if (new Set(sequences).size !== sequences.length)
    throw new Error("Usage sidecar sequence numbers must be unique.");
  return entries;
}

export function serializeUsageSidecar(entries: UsageSidecarEntry[]): string {
  const lines = [`schema: ${USAGE_SIDECAR_SCHEMA}`, "entries:"];
  for (const entry of entries) {
    lines.push(
      `  - seq: ${entry.seq}`,
      `    command: ${entry.command}`,
      `    label: ${entry.label}`,
      "    tiers:",
      ...USAGE_TIERS.map((tier) => `      ${tier}: ${entry.tiers[tier]}`),
      ...(entry.model === undefined ? [] : [`    model: ${entry.model}`]),
      ...(entry.provider === undefined ? [] : [`    provider: ${entry.provider}`]),
      ...(entry.harness === undefined ? [] : [`    harness: ${entry.harness}`]),
      ...(entry.harnessVersion === undefined
        ? []
        : [`    harness_version: ${entry.harnessVersion}`]),
      ...(entry.requirement === undefined ? [] : [`    requirement: ${entry.requirement}`]),
      ...(entry.workflow === undefined ? [] : [`    workflow: ${entry.workflow}`]),
    );
  }
  return lines.join("\n") + "\n";
}

/** Append an entry, assigning the next sequence number. Drops nothing: the ledger is capped by the caller. */
export function appendUsageSidecarEntry(
  entries: UsageSidecarEntry[],
  entry: Omit<UsageSidecarEntry, "seq">,
): UsageSidecarEntry[] {
  validateUsageSidecarEntry({ ...entry, seq: 1 });
  const nextSeq = entries.reduce((max, existing) => Math.max(max, existing.seq), 0) + 1;
  const recorded = [...entries, { ...entry, seq: nextSeq }];
  return recorded.length > USAGE_SIDECAR_CAP
    ? recorded.slice(recorded.length - USAGE_SIDECAR_CAP)
    : recorded;
}

const totalTokens = (entry: UsageSidecarEntry): number =>
  USAGE_TIERS.reduce((total, tier) => total + entry.tiers[tier], 0);

export function summarizeUsageSidecar(entries: UsageSidecarEntry[]): UsageSidecarSummary {
  if (!entries.length)
    return {
      entries: 0,
      label: "measured",
      tiers: Object.fromEntries(USAGE_TIERS.map((tier) => [tier, 0])) as Record<UsageTier, number>,
      cacheHitRate: undefined,
      byModel: [],
      byProvider: [],
      byHarness: [],
    };
  const tiers = Object.fromEntries(
    USAGE_TIERS.map((tier) => [
      tier,
      entries.reduce((total, entry) => total + entry.tiers[tier], 0),
    ]),
  ) as Record<UsageTier, number>;
  const billableInput = tiers["cache-read"] + tiers["fresh-input"];
  const group = (
    key: "model" | "harness" | "provider",
  ): { name: string; tokens: number; label: UsageLabel }[] => {
    const map = new Map<string, { tokens: number; measured: boolean }>();
    for (const entry of entries) {
      const name = entry[key] ?? "unattributed";
      const bucket = map.get(name) ?? { tokens: 0, measured: true };
      bucket.tokens += totalTokens(entry);
      bucket.measured = bucket.measured && entry.label === "measured";
      map.set(name, bucket);
    }
    return [...map]
      .map(([name, { tokens, measured }]) => ({
        name,
        tokens,
        label: measured ? ("measured" as const) : ("estimated" as const),
      }))
      .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  };
  return {
    entries: entries.length,
    label: entries.every((entry) => entry.label === "measured") ? "measured" : "estimated",
    tiers,
    ...(billableInput > 0 ? { cacheHitRate: tiers["cache-read"] / billableInput } : {}),
    byModel: group("model").map(({ name, tokens, label }) => ({ model: name, tokens, label })),
    byProvider: group("provider")
      .filter(({ name }) => name !== "unattributed")
      .map(({ name, tokens, label }) => ({ provider: name, tokens, label })),
    byHarness: group("harness").map(({ name, tokens, label }) => ({
      harness: name,
      tokens,
      label,
    })),
  };
}

export function serializeUsageSidecarSummary(summary: UsageSidecarSummary): string {
  if (!summary.entries) return "No usage sidecar entries recorded.";
  const percent =
    summary.cacheHitRate === undefined ? undefined : `${Math.round(summary.cacheHitRate * 100)}%`;
  return [
    `entries: ${summary.entries} (label: ${summary.label})`,
    ...USAGE_TIERS.map(
      (tier) => `  ${tier}: ${summary.tiers[tier].toLocaleString("en-US")} tokens`,
    ),
    ...(percent === undefined
      ? []
      : [`  cache_hit_rate: ${percent} (cache-read / billable input)`]),
    ...(summary.byModel.length
      ? [
          "by model:",
          ...summary.byModel.map(
            ({ model, tokens, label }) =>
              `  - ${model}: ${tokens.toLocaleString("en-US")} (${label})`,
          ),
        ]
      : []),
    ...(summary.byHarness.length
      ? [
          "by harness:",
          ...summary.byHarness.map(
            ({ harness, tokens, label }) =>
              `  - ${harness}: ${tokens.toLocaleString("en-US")} (${label})`,
          ),
        ]
      : []),
    ...(summary.byProvider.length
      ? [
          "by provider:",
          ...summary.byProvider.map(
            ({ provider, tokens, label }) =>
              `  - ${provider}: ${tokens.toLocaleString("en-US")} (${label})`,
          ),
        ]
      : []),
  ].join("\n");
}

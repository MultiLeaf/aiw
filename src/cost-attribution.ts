import { USAGE_TIERS, type UsageLabel, type UsageSidecarEntry } from "./usage-sidecar.js";
import type { TraceabilityGraph } from "./traceability.js";

/**
 * Cost attribution per verified requirement — the outcome-denominated cost
 * metric (Uber's "cost per merged PR", adapted to AI Workflow's unit of
 * value: a requirement with verification evidence).
 *
 * Honesty rules:
 * - tokens attributed to requirements and unattributed tokens are reported
 *   side by side, so the ratio cannot be gamed by leaving expensive work
 *   unattributed;
 * - the denominator counts only requirements the traceability graph marks
 *   as verified (linked evidence present);
 * - labels propagate pessimistically (any estimated entry poisons the total).
 */

export type RequirementCost = {
  requirement: string;
  tokens: number;
  label: UsageLabel;
  verified: boolean;
};

export type CostAttribution = {
  attributed: RequirementCost[];
  unattributedTokens: number;
  unattributedLabel: UsageLabel;
  verifiedRequirements: number;
  unverifiedRequirements: number;
  totalTokens: number;
  totalLabel: UsageLabel;
  /** Outcome-denominated metric: attributed tokens per verified requirement. */
  tokensPerVerifiedRequirement?: number;
};

const totalTokens = (entry: UsageSidecarEntry): number =>
  USAGE_TIERS.reduce((total, tier) => total + entry.tiers[tier], 0);

export function computeCostAttribution(
  entries: UsageSidecarEntry[],
  graph: TraceabilityGraph,
): CostAttribution {
  const verifiedByRequirement = new Map(
    graph.links.map((link) => [link.requirement, link.evidence.length > 0]),
  );
  const byRequirement = new Map<string, UsageSidecarEntry[]>();
  const unattributed: UsageSidecarEntry[] = [];
  for (const entry of entries) {
    if (entry.requirement) {
      const bucket = byRequirement.get(entry.requirement) ?? [];
      bucket.push(entry);
      byRequirement.set(entry.requirement, bucket);
    } else unattributed.push(entry);
  }
  const labelOf = (group: UsageSidecarEntry[]): UsageLabel =>
    group.every((entry) => entry.label === "measured") ? "measured" : "estimated";

  const attributed: RequirementCost[] = [...byRequirement]
    .map(([requirement, group]) => ({
      requirement,
      tokens: group.reduce((total, entry) => total + totalTokens(entry), 0),
      label: labelOf(group),
      verified: verifiedByRequirement.get(requirement) ?? false,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.requirement.localeCompare(b.requirement));

  const graphRequirements = new Set(graph.links.map((link) => link.requirement));
  const verifiedRequirements = attributed.filter(({ verified }) => verified).length;
  const unverifiedRequirements =
    attributed.filter(({ requirement }) => graphRequirements.has(requirement)).length -
    verifiedRequirements;
  const attributedToVerified = attributed
    .filter(({ verified }) => verified)
    .reduce((total, entry) => total + entry.tokens, 0);

  return {
    attributed,
    unattributedTokens: unattributed.reduce((total, entry) => total + totalTokens(entry), 0),
    unattributedLabel: labelOf(unattributed),
    verifiedRequirements,
    unverifiedRequirements,
    totalTokens: entries.reduce((total, entry) => total + totalTokens(entry), 0),
    totalLabel: labelOf(entries),
    ...(verifiedRequirements > 0
      ? { tokensPerVerifiedRequirement: Math.ceil(attributedToVerified / verifiedRequirements) }
      : {}),
  };
}

export function serializeCostAttribution(attribution: CostAttribution): string {
  if (!attribution.attributed.length && !attribution.unattributedTokens)
    return "No usage recorded against requirements yet. Record with `aiw usage-sidecar record --requirement=REQ-###`.";
  const lines = [
    `total_tokens: ${attribution.totalTokens.toLocaleString("en-US")} (${attribution.totalLabel})`,
    `unattributed_tokens: ${attribution.unattributedTokens.toLocaleString("en-US")} (${attribution.unattributedLabel})`,
    `verified_requirements: ${attribution.verifiedRequirements}`,
    `unverified_requirements: ${attribution.unverifiedRequirements}`,
    ...(attribution.tokensPerVerifiedRequirement === undefined
      ? ["tokens_per_verified_requirement: n/a (no verified requirements yet)"]
      : [
          `tokens_per_verified_requirement: ${attribution.tokensPerVerifiedRequirement.toLocaleString("en-US")} (estimated; outcome-denominated)`,
        ]),
    "by requirement:",
    ...attribution.attributed.map(
      ({ requirement, tokens, label, verified }) =>
        `  - ${requirement}: ${tokens.toLocaleString("en-US")} tokens (${label}, ${verified ? "verified" : "unverified"})`,
    ),
  ];
  return lines.join("\n");
}

/**
 * Task-lifecycle usage: total tokens from task start to merged PR.
 *
 * Tokens — not dollars — are the model-invariant metric: switching between a
 * frontier and an entry-level model changes the price per token but not the
 * input/output consumption, so lifecycle token totals stay comparable across
 * model routing changes and harness migrations. All input tiers count as
 * input tokens processed (cached reads still consume tokens; they just bill
 * less), and the tier split stays visible for cache-behavior analysis.
 */

export type TaskUsageStage = {
  stage: string;
  tokens: number;
  label: UsageLabel;
  models: string[];
};

export type TaskUsageSummary = {
  workflow: string;
  entries: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  label: UsageLabel;
  cacheHitRate?: number;
  stages: TaskUsageStage[];
  requirements: string[];
  models: string[];
  harnesses: string[];
};

export function summarizeTaskUsage(
  entries: UsageSidecarEntry[],
  workflow: string,
): TaskUsageSummary {
  const scoped = entries.filter((entry) => entry.workflow === workflow);
  const labelOf = (group: UsageSidecarEntry[]): UsageLabel =>
    group.every((entry) => entry.label === "measured") ? "measured" : "estimated";
  const inputTokens = scoped.reduce(
    (total, entry) =>
      total + entry.tiers["cache-read"] + entry.tiers["fresh-input"] + entry.tiers["cache-write"],
    0,
  );
  const billableInput = scoped.reduce(
    (total, entry) => total + entry.tiers["cache-read"] + entry.tiers["fresh-input"],
    0,
  );
  const byCommand = new Map<string, UsageSidecarEntry[]>();
  for (const entry of scoped) {
    const bucket = byCommand.get(entry.command) ?? [];
    bucket.push(entry);
    byCommand.set(entry.command, bucket);
  }
  const stages: TaskUsageStage[] = [...byCommand]
    .map(([stage, group]) => ({
      stage,
      tokens: group.reduce((total, entry) => total + totalTokens(entry), 0),
      label: labelOf(group),
      models: [...new Set(group.map((entry) => entry.model ?? "unattributed"))].sort(),
    }))
    .sort((a, b) => b.tokens - a.tokens || a.stage.localeCompare(b.stage));
  const uniqueSorted = (values: (string | undefined)[]): string[] =>
    [...new Set(values.filter((value): value is string => value !== undefined))].sort();
  return {
    workflow,
    entries: scoped.length,
    inputTokens,
    outputTokens: scoped.reduce((total, entry) => total + entry.tiers.output, 0),
    totalTokens: scoped.reduce((total, entry) => total + totalTokens(entry), 0),
    label: labelOf(scoped),
    ...(billableInput > 0
      ? {
          cacheHitRate:
            scoped.reduce((total, entry) => total + entry.tiers["cache-read"], 0) / billableInput,
        }
      : {}),
    stages,
    requirements: uniqueSorted(scoped.map((entry) => entry.requirement)),
    models: uniqueSorted(scoped.map((entry) => entry.model)),
    harnesses: uniqueSorted(scoped.map((entry) => entry.harness)),
  };
}

export function serializeTaskUsage(summary: TaskUsageSummary): string {
  if (!summary.entries)
    return `No usage recorded for workflow ${summary.workflow}. Correlate runs with \`aiw usage-sidecar record --workflow=${summary.workflow}\`.`;
  return [
    `workflow: ${summary.workflow} (${summary.entries} entries, ${summary.label})`,
    `input_tokens: ${summary.inputTokens.toLocaleString("en-US")} (cache-read + fresh-input + cache-write)`,
    `output_tokens: ${summary.outputTokens.toLocaleString("en-US")}`,
    `total_tokens: ${summary.totalTokens.toLocaleString("en-US")}`,
    ...(summary.cacheHitRate === undefined
      ? []
      : [`cache_hit_rate: ${Math.round(summary.cacheHitRate * 100)}%`]),
    ...(summary.models.length ? [`models: ${summary.models.join(", ")}`] : []),
    ...(summary.harnesses.length ? [`harnesses: ${summary.harnesses.join(", ")}`] : []),
    ...(summary.requirements.length ? [`requirements: ${summary.requirements.join(", ")}`] : []),
    "by stage:",
    ...summary.stages.map(
      ({ stage, tokens, label, models }) =>
        `  - ${stage}: ${tokens.toLocaleString("en-US")} tokens (${label}${models.length ? `; ${models.join(", ")}` : ""})`,
    ),
    "metric: tokens are model-invariant — comparable across model routing changes and harness migrations.",
  ].join("\n");
}

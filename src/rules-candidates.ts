/**
 * REQ-003: rejection-reason persistence loop.
 *
 * Recurring rejection reasons recorded in approval ledgers (active and
 * archived checkpoints) are clustered into draft rule/skill candidates.
 * Nothing becomes an active rule or skill without an explicit human
 * accept — the file only ever records draft/accepted/dismissed states.
 */
import { join } from "path";
import { parse as parseYaml, stringify } from "yaml";
import type { FileSystem } from "./types.js";

export const RULES_CANDIDATES_PATH = "generated/rules-candidates.yml";
/** Occurrences required before a cluster becomes a candidate. */
export const CANDIDATE_THRESHOLD = 2;

export type RejectionOccurrence = {
  workflowId: string;
  stage: string;
  reason: string;
  date: string;
};

export type RulesCandidateStatus = "draft" | "accepted" | "dismissed";

export type RulesCandidate = {
  id: string;
  summary: string;
  occurrences: RejectionOccurrence[];
  status: RulesCandidateStatus;
};

export function rulesCandidatesPath(aiw: string): string {
  return join(aiw, RULES_CANDIDATES_PATH);
}

/** Lowercase, collapse punctuation/whitespace so paraphrases group loosely. */
export function normalizeReason(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateId(summary: string): string {
  const slug = normalizeReason(summary).split(" ").slice(0, 6).join("-").slice(0, 40);
  return `rc-${slug || "candidate"}`;
}

/**
 * Cluster rejection occurrences by normalized reason. Clusters with at least
 * CANDIDATE_THRESHOLD occurrences become candidates; prior statuses for the
 * same candidate id are preserved.
 */
export function clusterRejections(
  occurrences: RejectionOccurrence[],
  prior: RulesCandidate[] = [],
): RulesCandidate[] {
  const byKey = new Map<string, RejectionOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = normalizeReason(occurrence.reason);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), occurrence]);
  }
  const candidates: RulesCandidate[] = [];
  for (const [, group] of byKey) {
    if (group.length < CANDIDATE_THRESHOLD) continue;
    const summary = group[0].reason.trim();
    const id = candidateId(summary);
    const existing = prior.find((candidate) => candidate.id === id);
    candidates.push({
      id,
      summary,
      occurrences: group.slice(-20),
      status: existing?.status ?? "draft",
    });
  }
  return candidates.sort((a, b) => b.occurrences.length - a.occurrences.length);
}

export function parseRulesCandidates(content: string): RulesCandidate[] {
  if (!content.trim()) return [];
  const value: unknown = parseYaml(content);
  if (!Array.isArray(value)) throw new Error("Rules candidates file must be a YAML list.");
  return value.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as RulesCandidate).id !== "string" ||
      typeof (entry as RulesCandidate).summary !== "string" ||
      !Array.isArray((entry as RulesCandidate).occurrences) ||
      !["draft", "accepted", "dismissed"].includes((entry as RulesCandidate).status ?? "")
    )
      throw new Error("Rules candidates file has an invalid entry.");
    return entry as RulesCandidate;
  });
}

export function serializeRulesCandidates(candidates: RulesCandidate[]): string {
  return stringify(candidates, { lineWidth: 0 });
}

export function loadRulesCandidates(fs: FileSystem, aiw: string): RulesCandidate[] {
  const path = rulesCandidatesPath(aiw);
  return fs.exists(path) ? parseRulesCandidates(fs.read(path)) : [];
}

export function saveRulesCandidates(
  fs: FileSystem,
  aiw: string,
  candidates: RulesCandidate[],
): string {
  const path = rulesCandidatesPath(aiw);
  fs.write(path, serializeRulesCandidates(candidates));
  return path;
}

export function setCandidateStatus(
  candidates: RulesCandidate[],
  id: string,
  status: RulesCandidateStatus,
): RulesCandidate[] {
  const found = candidates.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No rules candidate with id: ${id}`);
  return candidates.map((candidate) =>
    candidate.id === id ? { ...candidate, status } : candidate,
  );
}

export function formatRulesCandidates(candidates: RulesCandidate[]): string {
  if (candidates.length === 0)
    return "No recurring rejection reasons found (threshold: 2 occurrences).";
  const lines = candidates.map(
    (candidate) =>
      `${candidate.id} [${candidate.status}] (${candidate.occurrences.length}x): ${candidate.summary}`,
  );
  return lines.join("\n");
}

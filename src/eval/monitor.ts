import { parseDocument } from "yaml";
import { recordOccurrence, shouldSurfaceProposal, type Occurrence } from "./proposals.js";
import type { ProposalStore } from "./types.js";

export type SessionArtifact =
  | { type: "gate-failure"; stage: string; ref: string }
  | { type: "rejection"; stage: string; reason: string; ref: string };

export type MonitorResult = { surfaced: string[] };

/**
 * Deterministic observation extraction from AIW's own session artifacts only —
 * never chat transcripts (portability + privacy, REQ-007). Gate failures and
 * recorded rejections are the strongest "this keeps going wrong" signals.
 */
export function extractObservations(artifacts: SessionArtifact[]): Occurrence[] {
  return artifacts.map((artifact) => {
    if (artifact.type === "gate-failure")
      return {
        kind: "rule",
        signature: `gate-${artifact.stage}-quality`,
        origin: "monitor",
        evidence: artifact.ref,
      } satisfies Occurrence;
    return {
      kind: "rule",
      signature: `rejection-${artifact.stage}`,
      origin: "monitor",
      evidence: artifact.ref,
    } satisfies Occurrence;
  });
}

/**
 * Harvest monitor observations from the AIW approval ledger: every stage a
 * human rejected is a "this keeps going wrong" signal, cited by reason.
 */
export function harvestApprovalObservations(content: string): SessionArtifact[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  let raw: unknown;
  try {
    raw = parseDocument(trimmed).toJS();
  } catch {
    return [];
  }
  const stages = (raw as { stages?: Record<string, { status?: string; reason?: string }> })?.stages;
  if (!stages || typeof stages !== "object") return [];
  return Object.entries(stages)
    .filter(([, entry]) => entry?.status === "rejected")
    .map(([stage, entry]) => ({
      type: "rejection" as const,
      stage,
      reason: String(entry?.reason ?? ""),
      ref: "approvals.yml",
    }));
}

/**
 * Observe one session boundary: record occurrences into the store and report
 * which signatures may now surface to the human (threshold + cooldown +
 * suppression all enforced by the store policy). Mutates only the store.
 */
export function monitorSession(store: ProposalStore, artifacts: SessionArtifact[]): MonitorResult {
  const observations = extractObservations(artifacts);
  for (const observation of observations) recordOccurrence(store, observation);
  const surfaced: string[] = [];
  for (const observation of observations)
    if (shouldSurfaceProposal(store, observation.signature).surface)
      surfaced.push(observation.signature);
  return { surfaced };
}

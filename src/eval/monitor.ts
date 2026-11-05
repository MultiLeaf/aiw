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

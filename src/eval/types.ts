export const PROPOSAL_KINDS = ["skill", "agent", "rule", "hook", "template"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export type ProposalStatus = "proposed" | "approved" | "rejected" | "suppressed";
export type ProposalOrigin = "onboarding" | "monitor";

export type ProposalRecord = {
  id: string;
  kind: ProposalKind;
  origin: ProposalOrigin;
  signature: string;
  status: ProposalStatus;
  title: string;
  outline: string;
  evidence: string[];
  occurrences: number;
  lastSeq: number;
  rejectReason: string | null;
  rejectedAtOccurrences: number | null;
  provenance: string;
};

export type ProposalPolicy = {
  threshold: number;
  cooldown: number;
  suppressed: string[];
};

export type ProposalStore = {
  schema: 1;
  /** Monotonic sequence number: every mutation advances it (no wall timestamps). */
  seq: number;
  lastSurfacedSeq: number;
  policy: ProposalPolicy;
  proposals: ProposalRecord[];
};

export type SurfaceVerdict = { surface: boolean; reason: string };

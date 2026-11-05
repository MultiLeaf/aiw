import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { defaultPolicy } from "./policy.js";
import {
  PROPOSAL_KINDS,
  type ProposalKind,
  type ProposalRecord,
  type ProposalStore,
  type SurfaceVerdict,
} from "./types.js";

export const PROPOSALS_STORE_SCHEMA = 1;

/** Evidence refs kept per proposal: bounded growth, most recent first-class. */
export const MAX_EVIDENCE_REFS = 20;
/** Evidence refs kept after a proposal reaches a terminal state. */
export const COMPACT_EVIDENCE_REFS = 5;

export function createEmptyStore(): ProposalStore {
  return {
    schema: PROPOSALS_STORE_SCHEMA,
    seq: 0,
    lastSurfacedSeq: 0,
    policy: defaultPolicy(),
    proposals: [],
  };
}

export type Occurrence = {
  kind: ProposalKind;
  signature: string;
  origin?: "onboarding" | "monitor";
  /** Artifact reference for this occurrence; defaults to a sequence marker. */
  evidence?: string;
};

/** Stable content hash of a draft record: identical re-imports are no-ops. */
export function draftSignatureHash(record: {
  kind: string;
  signature: string;
  title: string;
  outline: string;
  evidence: string[];
}): string {
  return createHash("sha256")
    .update(
      [record.kind, record.signature, record.title, record.outline, record.evidence.join(",")].join(
        "\u0000",
      ),
    )
    .digest("hex");
}

/**
 * Record one observation of a pattern. Occurrences deduplicate by signature:
 * the proposal is created once and its evidence list grows per occurrence.
 */
export function recordOccurrence(store: ProposalStore, occurrence: Occurrence): void {
  store.seq += 1;
  const existing = store.proposals.find((proposal) => proposal.signature === occurrence.signature);
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeq = store.seq;
    existing.evidence.push(occurrence.evidence ?? `occurrences/${store.seq}`);
    if (existing.evidence.length > MAX_EVIDENCE_REFS)
      existing.evidence.splice(0, existing.evidence.length - MAX_EVIDENCE_REFS);
    return;
  }
  const number = store.proposals.length + 1;
  store.proposals.push({
    id: `prop-${String(number).padStart(3, "0")}`,
    kind: occurrence.kind,
    origin: occurrence.origin ?? "monitor",
    signature: occurrence.signature,
    status: "proposed",
    title: "",
    outline: "",
    evidence: [occurrence.evidence ?? `occurrences/${store.seq}`],
    occurrences: 1,
    lastSeq: store.seq,
    rejectReason: null,
    rejectedAtOccurrences: null,
    provenance: "",
    draftHash: null,
  });
}

/** Record `count` occurrences of one pattern in a single call (test/batch helper). */
export function recordMany(store: ProposalStore, occurrence: Occurrence, count: number): void {
  for (let index = 0; index < count; index += 1) recordOccurrence(store, occurrence);
}

/**
 * Compact terminal proposals (approved/rejected/suppressed): their evidence
 * already served the human review, so only the most recent refs are kept.
 * Deterministic normalization — does not advance the sequence.
 */
export function compactProposalStore(store: ProposalStore): void {
  for (const proposal of store.proposals)
    if (proposal.status !== "proposed" && proposal.evidence.length > COMPACT_EVIDENCE_REFS)
      proposal.evidence.splice(0, proposal.evidence.length - COMPACT_EVIDENCE_REFS);
}

/**
 * Decide whether a pattern may surface to the human. Pure check plus one
 * honest side effect: a positive verdict records the surface event
 * (`lastSurfacedSeq`), which is what makes the cooldown gap measurable.
 * Callers that only inspect state should read the returned reason.
 */
export function shouldSurfaceProposal(store: ProposalStore, signature: string): SurfaceVerdict {
  const proposal = store.proposals.find((candidate) => candidate.signature === signature);
  if (!proposal) return { surface: false, reason: "no proposal recorded for this signature" };
  if (store.policy.suppressed.includes(signature) || proposal.status === "suppressed")
    return { surface: false, reason: "suppressed by do-not-suggest-again policy" };
  if (proposal.status === "approved") return { surface: false, reason: "already approved" };
  if (proposal.status === "rejected") {
    const cited = proposal.rejectedAtOccurrences ?? proposal.occurrences;
    if (proposal.occurrences <= cited)
      return { surface: false, reason: "rejected without new occurrences since rejection" };
  }
  if (proposal.occurrences < store.policy.threshold)
    return {
      surface: false,
      reason: `below threshold: ${proposal.occurrences}/${store.policy.threshold} occurrences`,
    };
  if (store.lastSurfacedSeq > 0 && store.seq - store.lastSurfacedSeq < store.policy.cooldown)
    return {
      surface: false,
      reason: `cooldown: ${store.seq - store.lastSurfacedSeq}/${store.policy.cooldown} sequence gap since last surfacing`,
    };
  store.lastSurfacedSeq = store.seq;
  return { surface: true, reason: `threshold met with ${proposal.occurrences} occurrences` };
}

function byId(store: ProposalStore, id: string): ProposalRecord {
  const proposal = store.proposals.find((candidate) => candidate.id === id);
  if (!proposal) throw new Error(`Unknown proposal id: ${id}`);
  return proposal;
}

export function approveProposal(store: ProposalStore, id: string): void {
  store.seq += 1;
  byId(store, id).status = "approved";
}

export function rejectProposal(store: ProposalStore, id: string, reason: string): void {
  store.seq += 1;
  const proposal = byId(store, id);
  proposal.status = "rejected";
  proposal.rejectReason = reason;
  proposal.rejectedAtOccurrences = proposal.occurrences;
}

export function suppressProposal(store: ProposalStore, id: string): void {
  store.seq += 1;
  const proposal = byId(store, id);
  proposal.status = "suppressed";
  if (!store.policy.suppressed.includes(proposal.signature))
    store.policy.suppressed.push(proposal.signature);
}

function scalar(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

/** Deterministic serialization: same store state yields byte-identical YAML. */
export function serializeProposalStore(store: ProposalStore): string {
  const lines = [
    `schema: ${store.schema}`,
    `seq: ${store.seq}`,
    `last_surfaced_seq: ${store.lastSurfacedSeq}`,
    "policy:",
    `  threshold: ${store.policy.threshold}`,
    `  cooldown: ${store.policy.cooldown}`,
    `  suppressed: [${store.policy.suppressed.join(", ")}]`,
    "proposals:",
  ];
  for (const proposal of store.proposals) {
    lines.push(
      `  - id: ${proposal.id}`,
      `    kind: ${proposal.kind}`,
      `    origin: ${proposal.origin}`,
      `    signature: ${scalar(proposal.signature)}`,
      `    status: ${proposal.status}`,
      `    title: ${scalar(proposal.title)}`,
      `    outline: ${scalar(proposal.outline)}`,
      `    evidence: [${proposal.evidence.map(scalar).join(", ")}]`,
      `    occurrences: ${proposal.occurrences}`,
      `    last_seq: ${proposal.lastSeq}`,
      `    reject_reason: ${proposal.rejectReason === null ? "null" : scalar(proposal.rejectReason)}`,
      `    rejected_at_occurrences: ${proposal.rejectedAtOccurrences ?? "null"}`,
      `    provenance: ${scalar(proposal.provenance)}`,
      `    draft_hash: ${proposal.draftHash === null ? "null" : scalar(proposal.draftHash)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

type RawProposal = Record<string, unknown>;

function parseProposal(raw: RawProposal, index: number): ProposalRecord {
  const kind = String(raw.kind);
  if (!PROPOSAL_KINDS.includes(kind as ProposalKind))
    throw new Error(`Invalid proposal kind: ${kind}`);
  const status = raw.status;
  if (!["proposed", "approved", "rejected", "suppressed"].includes(String(status)))
    throw new Error(`Invalid proposal status: ${status}`);
  return {
    id: String(raw.id ?? `prop-${String(index + 1).padStart(3, "0")}`),
    kind: kind as ProposalKind,
    origin: (raw.origin === "onboarding" ? "onboarding" : "monitor") as "onboarding" | "monitor",
    signature: String(raw.signature ?? ""),
    status: status as "proposed" | "approved" | "rejected" | "suppressed",
    title: String(raw.title ?? ""),
    outline: String(raw.outline ?? ""),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String) : [],
    occurrences: Number(raw.occurrences ?? 0),
    lastSeq: Number(raw.last_seq ?? 0),
    rejectReason:
      raw.reject_reason === null || raw.reject_reason === undefined
        ? null
        : String(raw.reject_reason),
    rejectedAtOccurrences:
      raw.rejected_at_occurrences === null || raw.rejected_at_occurrences === undefined
        ? null
        : Number(raw.rejected_at_occurrences),
    provenance: String(raw.provenance ?? ""),
    draftHash:
      raw.draft_hash === null || raw.draft_hash === undefined ? null : String(raw.draft_hash),
  };
}

export function parseProposalStore(content: string): ProposalStore {
  const document = parseDocument(content);
  const raw = document.toJS() as Record<string, unknown> | null;
  if (!raw || Number(raw.schema) !== PROPOSALS_STORE_SCHEMA)
    throw new Error(`Unsupported proposal store schema: ${String(raw?.schema)}`);
  const policy = defaultPolicy();
  const rawPolicy = raw.policy as Record<string, unknown> | undefined;
  if (rawPolicy) {
    if (Number.isFinite(Number(rawPolicy.threshold)))
      policy.threshold = Number(rawPolicy.threshold);
    if (Number.isFinite(Number(rawPolicy.cooldown))) policy.cooldown = Number(rawPolicy.cooldown);
    if (Array.isArray(rawPolicy.suppressed)) policy.suppressed = rawPolicy.suppressed.map(String);
  }
  const proposals = Array.isArray(raw.proposals)
    ? (raw.proposals as RawProposal[]).map((entry, index) => parseProposal(entry, index))
    : [];
  return {
    schema: PROPOSALS_STORE_SCHEMA,
    seq: Number(raw.seq ?? 0),
    lastSurfacedSeq: Number(raw.last_surfaced_seq ?? 0),
    policy,
    proposals,
  };
}

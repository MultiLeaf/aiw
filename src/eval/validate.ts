import { parseDocument } from "yaml";
import { PROPOSAL_KINDS, type ProposalKind } from "./types.js";
import type { EvidenceBundle } from "./signals.js";

export type DraftRecord = {
  kind: ProposalKind | string;
  signature: string;
  title: string;
  outline: string;
  evidence: string[];
};

export type DraftFailure = { record: string; reason: string[] };

export type DraftValidation = {
  records: DraftRecord[];
  errors: DraftFailure[];
  overlaps: { signature: string; catalogId: string }[];
};

const REQUIRED: (keyof DraftRecord)[] = ["kind", "signature", "title", "outline", "evidence"];

function slugTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function parseDrafts(content: string): DraftRecord[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  const raw = parseDocument(trimmed).toJS();
  if (!Array.isArray(raw)) throw new Error("Drafts file must contain a YAML list of records");
  return (raw as Record<string, unknown>[]).map((entry) => ({
    kind: String(entry.kind ?? ""),
    signature: String(entry.signature ?? ""),
    title: String(entry.title ?? ""),
    outline: String(entry.outline ?? ""),
    evidence: Array.isArray(entry.evidence) ? entry.evidence.map(String) : [],
  }));
}

/**
 * Contract check run after the host agent writes its drafts: required fields,
 * evidence refs must resolve into the EvidenceBundle, kinds must be known, and
 * overlap with existing catalog resources is annotated for the reviewer.
 */
export function validateDrafts(
  drafts: DraftRecord[],
  bundle: EvidenceBundle,
  catalogIds: string[],
): DraftValidation {
  const knownFactIds = new Set(bundle.facts.map((fact) => fact.id));
  const records: DraftRecord[] = [];
  const errors: DraftFailure[] = [];
  const overlaps: { signature: string; catalogId: string }[] = [];
  for (const draft of drafts) {
    const reason: string[] = [];
    for (const field of REQUIRED)
      if (
        field === "evidence"
          ? draft.evidence.length === 0
          : draft[field] === undefined || draft[field] === null || !String(draft[field]).trim()
      )
        reason.push(`missing required field: ${field}`);
    if (!PROPOSAL_KINDS.includes(draft.kind as ProposalKind))
      reason.push(`unknown kind: ${draft.kind}`);
    const dangling = draft.evidence.filter((ref) => !knownFactIds.has(ref));
    if (dangling.length) reason.push(`evidence refs not present in bundle: ${dangling.join(", ")}`);
    if (reason.length) {
      errors.push({ record: draft.signature || "(unnamed)", reason });
      continue;
    }
    records.push(draft);
    const tokens = slugTokens(draft.title);
    for (const catalogId of catalogIds) {
      const [type, ...rest] = catalogId.split("/");
      const slug = rest.join(" ").replaceAll("-", " ");
      const slugTokensList = slugTokens(slug);
      if (
        type.replace(/s$/, "") === draft.kind &&
        slugTokensList.length > 0 &&
        slugTokensList.every((token) => tokens.includes(token))
      )
        overlaps.push({ signature: draft.signature, catalogId });
    }
  }
  return { records, errors, overlaps };
}

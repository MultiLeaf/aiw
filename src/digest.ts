/**
 * OPP-013 Read-Optimized Artifacts: deterministic digest extraction.
 *
 * Artifacts are written once and re-read many times downstream (~80% of an
 * artifact's lifetime token cost is re-reading, measured on this repository's
 * own full-lane work). The digest is a fingerprint-bound, machine-extracted
 * index of an approved artifact: downstream stages read it by default and
 * open the full artifact only on demand. Digests are parsed from the sections
 * gates already mandate — never model-generated.
 */

import type { FileSystem } from "./types.js";
import { stageFingerprint, type HumanApprovalStage } from "./human-approval.js";

export type ArtifactDigest = {
  schema: 1;
  stage: HumanApprovalStage;
  /** Fingerprint of the exact approved artifact bytes this digest summarizes. */
  fingerprint: string;
  generatedAt: string;
  title: string;
  requirementIds: string[];
  taskIds: string[];
  decisionIds: string[];
  criteriaCount: number;
  /** First line of the artifact's `## Decision` section, when present. */
  decision?: string;
};

export const DIGEST_DIRECTORY = "digests";

export function digestPath(aiw: string, stage: HumanApprovalStage): string {
  return `${aiw}/${DIGEST_DIRECTORY}/${stage}.yml`;
}

export function extractDigest(
  stage: HumanApprovalStage,
  artifact: string,
  fingerprint: string,
  now = new Date().toISOString(),
): ArtifactDigest {
  const title = /^#\s+(.+)$/m.exec(artifact)?.[1]?.trim() ?? stage;
  const requirementIds = [...new Set(artifact.matchAll(/REQ-\d+/g))].map((match) => match[0]);
  const taskIds = [...new Set(artifact.matchAll(/TASK-\d+/g))].map((match) => match[0]);
  const decisionIds = [...new Set(artifact.matchAll(/ADR-\d+/g))].map((match) => match[0]);
  const criteriaCount = (artifact.match(/Given\b/g) ?? []).length;
  const decision = /^##\s+Decision\s*\n+\s*([^\n]+)/m.exec(artifact)?.[1]?.trim();
  return {
    schema: 1,
    stage,
    fingerprint,
    generatedAt: now,
    title: title.slice(0, 120),
    requirementIds,
    taskIds,
    decisionIds,
    criteriaCount,
    ...(decision ? { decision } : {}),
  };
}

export function serializeDigest(digest: ArtifactDigest): string {
  const lines = [
    "schema: 1",
    `stage: ${digest.stage}`,
    `fingerprint: ${digest.fingerprint}`,
    `generatedAt: ${digest.generatedAt}`,
    `title: ${JSON.stringify(digest.title)}`,
    `requirementIds: [${digest.requirementIds.join(", ")}]`,
    `taskIds: [${digest.taskIds.join(", ")}]`,
    `decisionIds: [${digest.decisionIds.join(", ")}]`,
    `criteriaCount: ${digest.criteriaCount}`,
  ];
  if (digest.decision) lines.push(`decision: ${JSON.stringify(digest.decision)}`);
  return `${lines.join("\n")}\n`;
}

export function parseDigest(content: string, stage: HumanApprovalStage): ArtifactDigest {
  const field = (name: string): string =>
    new RegExp(`^${name}: (.*)$`, "m").exec(content)?.[1]?.replace(/^"|"$/g, "") ?? "";
  const list = (name: string): string[] =>
    field(name)
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  const decision = field("decision");
  return {
    schema: 1,
    stage,
    fingerprint: field("fingerprint"),
    generatedAt: field("generatedAt"),
    title: field("title"),
    requirementIds: list("requirementIds"),
    taskIds: list("taskIds"),
    decisionIds: list("decisionIds"),
    criteriaCount: Number(field("criteriaCount")) || 0,
    ...(decision ? { decision } : {}),
  };
}

export type DigestFreshness =
  | { state: "fresh"; digest: ArtifactDigest }
  | { state: "stale"; digest: ArtifactDigest }
  | { state: "missing" };

/**
 * Freshness is fail-safe toward fidelity: when the live artifact's fingerprint
 * no longer matches the approved digest, the digest is `stale` and callers must
 * direct agents to the full artifact for current content.
 */
export function digestFreshness(
  aiw: string,
  fs: FileSystem,
  stage: HumanApprovalStage,
  artifactPath?: string,
): DigestFreshness {
  const path = digestPath(aiw, stage);
  if (!fs.exists(path)) return { state: "missing" };
  const digest = parseDigest(fs.read(path), stage);
  if (digest.fingerprint.length === 0) return { state: "missing" };
  if (!artifactPath || !fs.exists(artifactPath)) return { state: "fresh", digest };
  const live = stageFingerprint(fs.read(artifactPath));
  return live === digest.fingerprint ? { state: "fresh", digest } : { state: "stale", digest };
}

/** One human/agent-readable line summarizing a digest. */
export function formatDigestLine(freshness: DigestFreshness): string {
  if (freshness.state === "missing") return `${"digest: none"}`;
  const { digest } = freshness;
  const ids = [
    digest.requirementIds.length > 0 ? `requirements: ${digest.requirementIds.join(", ")}` : "",
    digest.taskIds.length > 0 ? `tasks: ${digest.taskIds.join(", ")}` : "",
    digest.decisionIds.length > 0 ? `decisions: ${digest.decisionIds.join(", ")}` : "",
    digest.criteriaCount > 0 ? `criteria: ${digest.criteriaCount}` : "",
  ].filter((part) => part.length > 0);
  const summary = ids.length > 0 ? ` · ${ids.join(" · ")}` : "";
  const decision = digest.decision ? ` · decision: ${digest.decision}` : "";
  if (freshness.state === "stale")
    return `digest(${digest.stage}): STALE — artifact changed after approval; read the full artifact for current content.${decision}`;
  return `digest(${digest.stage}): ${digest.fingerprint.slice(0, 16)}…${summary}${decision}`;
}

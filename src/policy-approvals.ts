/**
 * REQ-003: scoped, fingerprinted human approvals for strict policy paths.
 * Approvals are deliberate human commands (never auto-invoked), recorded in
 * `.aiw/checkpoints/policy-approvals.yml`, and invalidated when the change's
 * path set changes.
 */
import { createHash } from "node:crypto";
import { join } from "path";
import { parse as parseYaml, stringify } from "yaml";
import { pathPatternMatches } from "./policy-gate.js";
import type { FileSystem } from "./types.js";

export const MAX_POLICY_APPROVALS = 50;

export type PolicyApprovalRecord = {
  /** SHA-256 over the sorted changed-path set at approval time. */
  fingerprint: string;
  /** Path patterns the human approved. */
  paths: string[];
  approvedAt: string;
};

export function policyApprovalsPath(aiw: string): string {
  return join(aiw, "checkpoints/policy-approvals.yml");
}

/** The change fingerprint: identical change → identical fingerprint (NFR-003). */
export function changeFingerprint(paths: readonly string[]): string {
  return `sha256-${createHash("sha256")
    .update([...paths].sort().join("\n"))
    .digest("hex")}`;
}

export function parsePolicyApprovals(content: string): PolicyApprovalRecord[] {
  if (!content.trim()) return [];
  const value: unknown = parseYaml(content);
  if (!Array.isArray(value)) throw new Error("Policy approvals file must be a YAML list.");
  return value.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as PolicyApprovalRecord).fingerprint !== "string" ||
      !Array.isArray((entry as PolicyApprovalRecord).paths) ||
      typeof (entry as PolicyApprovalRecord).approvedAt !== "string"
    )
      throw new Error(`Policy approval record ${index + 1} is invalid.`);
    return entry as PolicyApprovalRecord;
  });
}

export function recordPolicyApproval(
  fs: FileSystem,
  aiw: string,
  input: { paths: string[]; fingerprint: string; approvedAt: string },
): string {
  const path = policyApprovalsPath(aiw);
  if (!input.paths.length || input.paths.some((pattern) => !pattern.trim()))
    throw new Error("Policy approvals require at least one non-empty path pattern.");
  const prior = fs.exists(path) ? parsePolicyApprovals(fs.read(path)) : [];
  const record: PolicyApprovalRecord = {
    fingerprint: input.fingerprint,
    paths: input.paths,
    approvedAt: input.approvedAt,
  };
  const kept = [...prior, record].slice(-MAX_POLICY_APPROVALS);
  if (!fs.exists(join(aiw, "checkpoints"))) fs.mkdir(join(aiw, "checkpoints"));
  fs.write(path, stringify(kept, { lineWidth: 0 }));
  return path;
}

/** A changed path is covered when a matching-pattern record shares the current fingerprint. */
export function isPathApproved(
  approvals: readonly PolicyApprovalRecord[],
  fingerprint: string,
  path: string,
): boolean {
  return approvals.some(
    (record) =>
      record.fingerprint === fingerprint &&
      record.paths.some((pattern) => pathPatternMatches(pattern, path)),
  );
}

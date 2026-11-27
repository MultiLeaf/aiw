import {
  enforceOrganizationPolicy,
  type OrganizationPolicy,
  type PackagePolicySubject,
} from "./organization-policy.js";
import { execFileSync } from "node:child_process";
import { relative } from "node:path";

export interface PolicyTracking {
  isTracked(root: string, path: string): boolean;
}

export const gitPolicyTracking: PolicyTracking = {
  isTracked(root, path) {
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", "--", relative(root, path)], {
        cwd: root,
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  },
};

/** REQ-006: deterministic policy strictness ordering — stricter always wins. */
export type PolicyDecision = "allow" | "require-approval" | "always-require-human" | "deny";

export const POLICY_STRICTNESS_ORDER: readonly PolicyDecision[] = [
  "allow",
  "require-approval",
  "always-require-human",
  "deny",
];

export function strictnessOf(decision: PolicyDecision): number {
  const index = POLICY_STRICTNESS_ORDER.indexOf(decision);
  if (index < 0) throw new Error(`Unknown policy decision: ${decision}`);
  return index;
}

export type PolicyRule = {
  id: string;
  /** Path prefixes a rule matches; a trailing `*` matches descendants (e.g. `src/auth/*`). */
  paths: string[];
  decision: PolicyDecision;
  /** When set, the decision is treated as always-require-human regardless of the declared level. */
  alwaysRequireHuman?: boolean;
};

export type ResolvedPolicy = {
  decision: PolicyDecision;
  matchedRules: string[];
};

function ruleMatchesPath(rule: PolicyRule, path: string): boolean {
  return rule.paths.some((pattern) =>
    pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path,
  );
}

/**
 * REQ-006: resolve the rules that match a path. When multiple rules match,
 * the strictest one wins; equal strictness resolves to that same (strictest)
 * decision deterministically.
 */
export function resolvePolicy(
  rules: readonly PolicyRule[],
  path: string,
): ResolvedPolicy | undefined {
  const matched = rules.filter((rule) => ruleMatchesPath(rule, path));
  if (!matched.length) return undefined;
  const effective = matched.map((rule) => ({
    rule,
    decision: (rule.alwaysRequireHuman ? "always-require-human" : rule.decision) as PolicyDecision,
  }));
  const strictest = effective.reduce((a, b) =>
    strictnessOf(b.decision) > strictnessOf(a.decision) ? b : a,
  );
  return { decision: strictest.decision, matchedRules: matched.map((rule) => rule.id).sort() };
}

/**
 * REQ-006: a classifier or other automated result can never raise the resolved
 * decision above require-approval, and can never override a resolved
 * always-require-human or deny decision — those always need a human.
 */
export function applyAutomatedResult(
  resolved: ResolvedPolicy,
  automated: PolicyDecision,
): ResolvedPolicy {
  if (
    resolved.decision === "always-require-human" ||
    resolved.decision === "deny" ||
    strictnessOf(automated) > strictnessOf("require-approval")
  )
    return resolved;
  return { ...resolved, decision: automated };
}

export function enforcePolicyGate(
  policy: OrganizationPolicy,
  subjects: readonly PackagePolicySubject[],
): void {
  subjects.forEach((subject) => enforceOrganizationPolicy(policy, subject));
}

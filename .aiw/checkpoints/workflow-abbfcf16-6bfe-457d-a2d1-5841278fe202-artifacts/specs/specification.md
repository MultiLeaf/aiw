# Specification: Policy path rules with strictest-wins enforcement

- Workflow ID: abbfcf16-6bfe-457d-a2d1-5841278fe202
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Brainstorm v1 (approved)

## Context

The policy resolver (resolvePolicy/applyAutomatedResult/strictnessOf, src/policy-gate.ts) is exported and test-covered but consumed by nothing. The organization policy format is flat (approved_sources/denied_permissions). This specification connects them: organizations declare path-scoped rules, `aiw policy-check` resolves changed paths through the resolver and enforces the strictest decision, and a deliberate, attributable human action records approvals. Design decisions (each resolves a brainstorm open question):

- **D1 (path source):** rules evaluate against the **changed paths of the working tree** (git diff vs the merge-base with the default branch); non-git repositories fall back to the union of file paths declared by the `--package=` manifests (the declared-list fallback).
- **D2 (approval record):** a dedicated command `aiw policy approve --paths=<glob>[,<glob>...]` records an approval scoped to the current change (fingerprinted) in `.aiw/checkpoints/policy-approvals.yml`, attributed with a timestamp; it never edits the policy file.
- **D3 (consumers):** `aiw policy-check` is the enforcement consumer; the flat source/permission enforcement in `resolve`/`update` is untouched.
- **D4 (limits):** at most 64 rules per policy; ids, paths, and decisions validated at parse time (consistent with orchestration's task caps); duplicate rule ids rejected.

## Requirements

### REQ-001: Path rules in the organization policy

- **Description:** `organization.yml` gains an optional `rules:` list; each rule declares an id, path patterns, a decision, and an optional always-require-human flag.
- **Acceptance criteria:**
  - Given an organization policy file with a `rules:` list
  - When it is parsed (`parseOrganizationPolicy` / `aiw organization-policy --file=`)
  - Then each rule validates: unique id (≤64 rules), non-empty `paths` (trailing `*` matches descendants), decision in {allow, require-approval, always-require-human, deny}, and `always-require-human: true` is equivalent to decision always-require-human
  - And a policy without `rules:` parses and enforces exactly as today (flat behavior unchanged)
  - And serialization round-trips the rules

### REQ-002: policy-check resolves changed paths through the resolver

- **Description:** `aiw policy-check` evaluates the change's paths against the rules using `resolvePolicy` and enforces the resolved decision.
- **Acceptance criteria:**
  - Given a git repository with changes vs the default branch and a policy with rules
  - When `aiw policy-check` runs
  - Then every changed path resolves through `resolvePolicy` (strictest match wins; equal strictness deterministic); the command fails with an actionable message naming the offending paths, matched rules, and the required action when any path resolves to `deny`
  - And paths resolving to `require-approval` or `always-require-human` pass only when a recorded approval covers them (REQ-003), else fail with the same actionable shape
  - And in a non-git repository, the changed-path set is the union of the `--package=` manifests' declared file paths (D1 fallback); with no packages and no git, the check passes with an explicit advisory that no paths were evaluated
  - And a policy without rules behaves exactly as today (source/permission checks only)

### REQ-003: Recorded human approval for strict paths

- **Description:** `aiw policy approve --paths=<patterns>` records a scoped, fingerprinted human approval that satisfies require-approval/always-require-human path resolutions for the current change.
- **Acceptance criteria:**
  - Given paths failing policy-check with require-approval or always-require-human
  - When `aiw policy approve --paths=<those paths>` runs (a deliberate human action)
  - Then an approval record is written to `.aiw/checkpoints/policy-approvals.yml` with the path patterns, the change fingerprint (the same changed-path set hash), and a timestamp
  - And a subsequent `aiw policy-check` passes for exactly those paths — approving `src/auth/*` does not satisfy `src/billing/*`
  - And a change to the working tree (different fingerprint) invalidates the approval for the new paths, failing policy-check again
  - And `deny` resolutions are never satisfiable by approval (deny is deny)

### REQ-004: Automated results are capped by the resolver

- **Description:** Where an automated signal produces a policy-relevant result, it is applied through `applyAutomatedResult` — never above require-approval, never overriding always-require-human/deny.
- **Acceptance criteria:**
  - Given a resolved policy decision for a path and an automated result
  - When the result is applied
  - Then the effective decision uses `applyAutomatedResult` (automated allow may lower to allow; automated deny cannot raise above require-approval; always-require-human/deny are unchanged)
  - And the wiring is exercised by at least one consumer (e.g. an `aiw policy-check --advisory=<decision>` flag that reports what an automated signal would change without enforcing it) so the exported resolver is no longer dead code

## Non-functional Requirements

- **NFR-001 Additive schema:** the flat policy fields are untouched; both shapes validate everywhere `parseOrganizationPolicy` is used.
- **NFR-002 Trust boundaries:** the approval record is a deliberate human command, never auto-invoked; automated results only tighten or report.
- **NFR-003 Determinism:** identical policy + identical change always yields the identical verdict (pure resolution, no environment dependence beyond git state).

## Constraints

- Use the existing resolver functions; no reimplementation of strictness semantics.
- No new network surface; git is read-only usage (diff/merge-base), no pushes.
- Policy files remain human-committed (agents never commit rule files — trust boundaries).

## Open Questions

- None — D1..D4 resolve the brainstorm questions; remaining detail (exact YAML layout, fingerprint hashing) is technical-design work.

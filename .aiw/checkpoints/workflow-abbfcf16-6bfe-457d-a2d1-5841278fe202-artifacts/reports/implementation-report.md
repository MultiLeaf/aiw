# Implementation Report: Policy path rules with strictest-wins enforcement

- Workflow ID: abbfcf16-6bfe-457d-a2d1-5841278fe202
- Date: 2026-11-27
- Source: Implementation plan v1 (approved), TASK-001..TASK-005

## Changed Files

- src/organization-policy.ts — TASK-001: `PolicyRuleRecord`, optional `rules` block parsed via yaml slice with full validation (≤64, unique ids, decision set, non-empty paths; `always-require-human` normalization), serialization round-trip, `POLICY_DECISIONS` exported.
- src/policy-gate.ts — TASK-002: `changedPaths(root)` (git diff vs merge-base fallback chain + uncommitted + untracked, `.aiw/` state excluded), shared `pathPatternMatches` extracted.
- src/policy-approvals.ts — TASK-004 (new): fingerprint (`changeFingerprint`), record parse/serialize (cap 50), scoped coverage (`isPathApproved`: pattern + exact fingerprint), empty-pattern rejection.
- src/workflow.ts — TASK-003/004/005: policy-check path-rule enforcement (deny blocks unconditionally with actionable output; strict paths require recorded approval; summary counts; package-manifest fallback for non-git; no-paths advisory), `aiw policy approve --paths=` command, `policy-check --advisory=<decision>` (applyAutomatedResult delta report, verdict unchanged).
- src/organization-policy.test.ts, src/policy-paths.test.ts, src/policy-approvals.test.ts, src/policy-check-rules.test.ts — new/extended suites (16 tests total across them).
- CHANGELOG.md, docs/trust-boundaries.md — TASK-005: entry + approval/advisory trust lines.

## Tests

- TASK-001: rules parse/round-trip; invalid decision, duplicate id, empty paths, >64, non-block rules rejected; flat policy unchanged.
- TASK-002: pattern matcher semantics; changedPaths in a real git fixture (committed + uncommitted + untracked; .aiw excluded; base untouched); non-git → undefined.
- TASK-003: allow paths pass with summary; deny blocks naming paths/rules with "not satisfiable by approval"; strict paths require approval; approving `src/auth/*` does not satisfy `src/billing/*`; fingerprint invalidation on new change; flat policy output byte-identical; non-git fallback via package manifest paths.
- TASK-004: deterministic path-set fingerprints; scoped coverage (pattern + fingerprint); cap 50 with oldest dropped; empty-pattern writes rejected; deny never satisfiable (covered in the deny test).
- TASK-005: advisory allow reports `require-approval → allow` with "verdict unchanged" and cannot make an unapproved check pass; advisory deny never produces `→ deny`; invalid advisory values rejected.
- Regression: full suite 821 tests passing; flat policy enforcement unchanged.

## Validation

- TASK-001: Validation: `npx vitest run src/organization-policy.test.ts` → exit 0
- TASK-002: Validation: `npx vitest run src/policy-paths.test.ts` → exit 0
- TASK-003: Validation: `npx vitest run src/policy-check-rules.test.ts` → exit 0
- TASK-004: Validation: `npx vitest run src/policy-approvals.test.ts src/policy-check-rules.test.ts` → exit 0
- TASK-005: Validation: `npx vitest run src/policy-check-rules.test.ts` → exit 0
- Full project quality: `npm run check` (format:check + lint + typecheck + build + vitest 821 + security:check) → exit 0.

## Deviations

- `changedPaths` excludes `.aiw/` state files: recording an approval creates a checkpoint file inside `.aiw/`, which would otherwise change the path set and invalidate the approval's own fingerprint (documented in code; semantically correct — policy rules target project paths, not workflow bookkeeping).
- Merge-base fallback chain: `origin/HEAD` → `origin/main` → `origin/master` → `HEAD~1` → uncommitted-only (as designed; fresh-clone behavior degrades to uncommitted+untracked with the base diff skipped, never a false pass beyond advisories).

## Requirements Implemented

- REQ-001: validated optional rules schema with round-trip; flat behavior unchanged.
- REQ-002: policy-check resolves changed paths through resolvePolicy; deny blocks; strict paths gate on recorded approval; D1 fallback + no-paths advisory.
- REQ-003: scoped fingerprinted approvals; pattern-scoped coverage; invalidation on change; deny unsatisfiable.
- REQ-004: `--advisory` consumes applyAutomatedResult — the resolver is wired into a real path; verdict never changes.

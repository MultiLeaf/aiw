# Technical Design: Policy path rules with strictest-wins enforcement

- Workflow ID: abbfcf16-6bfe-457d-a2d1-5841278fe202
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Specification v1 (approved), decisions D1..D4

## Context

`src/organization-policy.ts` parses flat policies with line-regex helpers (`scalar`/`list`, inline lists only). `src/policy-gate.ts` exports the tested resolver (`resolvePolicy`, `applyAutomatedResult`, `strictnessOf`, `PolicyRule`). `aiw policy-check` (src/workflow.ts ~3936) loads `.aiw/organization.yml`, gathers subjects from packages/lock/registries, and enforces the flat policy. Git usage exists in the codebase (`gitPolicyTracking`, orchestration's `git()`).

## Proposed Design

### 1. Policy schema extension (REQ-001)

- `OrganizationPolicy` gains `rules?: PolicyRuleRecord[]` where `PolicyRuleRecord = { id: string; paths: string[]; decision: PolicyDecision; alwaysRequireHuman?: boolean }` (reuses `PolicyDecision` from policy-gate).
- Parsing: keep the flat regex helpers; parse the optional `rules:` block with the repo's `yaml` library (`parseDocument`) by slicing the file at the `^rules:` line (the flat fields remain top-level inline keys; the rules block is the only block-style section). Validation at parse: ≤64 rules, unique ids, non-empty paths, decision in the four-value set; `alwaysRequireHuman: true` normalizes to decision `always-require-human`. Errors are actionable ("Organization policy rule 3 has an invalid decision: …").
- Serialization: flat keys as today, then the rules block via `stringify` (round-trips).

### 2. Changed-path evaluation in policy-check (REQ-002)

- New helper `changedPaths(root): string[] | undefined` in `src/policy-gate.ts`: git repositories → `git diff --name-only <merge-base with origin default branch or HEAD~1 fallback>…HEAD` plus uncommitted changes (`git diff --name-only` + `git ls-files --others --exclude-standard`); non-git → `undefined`.
- `policy-check` flow addition (after flat enforcement): if `policy.rules` exists — evaluate `changedPaths(root)` (fallback: union of package manifests' declared files, D1); for each path call `resolvePolicy(rules, path)`; group results by decision:
  - `deny` → fail: offending paths + matched rule ids + "deny is not satisfiable by approval".
  - `require-approval` | `always-require-human` → pass only if the approval record covers the path (§3), else fail with the same actionable shape naming the resolution path.
  - `allow` or no matching rule → pass.
- Advisory output on success: counts per decision ("paths: 12 changed · allow 9 · require-approval 2 (approved) · deny 0").
- No rules in policy → behavior byte-identical to today; no git/no packages → explicit advisory "no paths evaluated" and pass.

### 3. Scoped approval records (REQ-003)

- New command `aiw policy approve --paths=<glob>[,<glob>...]` in workflow.ts: computes the change fingerprint `sha256-…` over the sorted changed-path set, and appends `{ fingerprint, paths, approvedAt }` to `.aiw/checkpoints/policy-approvals.yml` (YAML, additive list; cap 50 records, oldest dropped).
- Coverage check: a path is covered when it matches one of the record's path patterns (same prefix/`*` semantics as rules) **and** the record's fingerprint equals the current change fingerprint. Any working-tree change alters the path set → different fingerprint → approval no longer applies (spec's invalidation criterion).
- `deny` bypass is structurally impossible: the deny branch never consults approvals.

### 4. Advisory automated results (REQ-004)

- `aiw policy-check --advisory=<decision>` (single decision for all paths, simulating an automated signal): the command computes `applyAutomatedResult(resolved, advisory)` per path and prints the delta ("advisory allow would lower 2 paths from require-approval to allow; always-require-human (1) and deny (0) unchanged") **without changing the enforced verdict**. This makes the exported resolver consumed on a real path while keeping enforcement human-owned.

## Alternatives

- Rewriting the whole policy parser to full YAML documents — rejected: touches every flat-policy consumer for no gain; the sliced-block approach is additive and keeps the flat format byte-stable.
- Approvals stored inside `organization.yml` — rejected: the policy file is org-level config, human-committed (trust boundaries); per-change approvals are checkpoint state.
- Path evaluation from package manifest file lists only — rejected as primary: packages don't declare their full touch surface; git changed-paths is the ground truth, with the manifest fallback for non-git (D1).
- A `--force` flag on policy-check instead of scoped approvals — rejected: unauditable, unlimited scope.

## Interfaces

- **Schema (additive):** `OrganizationPolicy.rules?: PolicyRuleRecord[]`; flat fields untouched.
- **CLI (additive):** `aiw policy approve --paths=<patterns>`; `aiw policy-check --advisory=<decision>`; existing commands unchanged.
- **Module exports (additive):** `changedPaths(root)` in policy-gate.ts; policy-approval record helpers (parse/serialize/coverage) in a new small module `src/policy-approvals.ts`.
- **Files (new):** `.aiw/checkpoints/policy-approvals.yml`.
- **Docs:** CHANGELOG entry; trust-boundaries line (approvals are deliberate human commands; advisory never enforces).

## Risks

- Merge-base heuristics in shallow/fresh clones (no origin default branch) — fallback chain: `origin/<default>`, `origin/HEAD`, `HEAD~1`, and finally uncommitted-only with an advisory; never a false pass beyond the advisory's honesty.
- Path-pattern semantics divergence between rules and approvals — both use the same prefix/`*` matcher, extracted to one shared function in policy-gate.ts.
- Fingerprint churn on trivial changes (whitespace-only) invalidates approvals — acceptable and conservative (approvals are cheap to re-record); documented.

## Validation

- Unit tests: rules parse/serialize round-trip (valid, invalid decision, duplicate id, >64 rules, empty paths); flat policy unchanged; changedPaths in a real git fixture; coverage matcher; fingerprint invalidation.
- CLI tests: policy-check denies with actionable output; require-approval passes only after `policy approve --paths`; scoped approval does not leak across patterns; deny never satisfiable; non-git fallback via package lists; no-rules regression byte-identical; `--advisory` reports deltas without changing the verdict.
- Project quality: `npm run check` exit 0; full suite green.
- Acceptance mapping: REQ-001 → schema tests; REQ-002 → policy-check tests; REQ-003 → approval tests; REQ-004 → advisory tests.

## Traceability

- REQ-001 → §1 | REQ-002 → §2 | REQ-003 → §3 | REQ-004 → §4 | NFR-001 → §1 (flat untouched), Interfaces | NFR-002 → §3/§4, Alternatives | NFR-003 → §2 determinism, Validation.

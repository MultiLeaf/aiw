# Brainstorm: Policy path rules with strictest-wins enforcement

- Workflow ID: abbfcf16-6bfe-457d-a2d1-5841278fe202
- Version: 1 (draft)
- Date: 2026-11-27
- Input: Backlog item 6 from the session; code-review deviations of workflow 4f3eab42 (REQ-006 resolver exported but unconsumed).

## Goal

Give `aiw policy-check` (and the policy enforcement used by `resolve`/`update`) real multi-rule path semantics: organizations declare path-scoped rules with decisions, conflicting rules resolve strictest-wins, `always-require-human` rules are never overridable by automated results — connecting the already-exported, test-covered resolver (`resolvePolicy`/`applyAutomatedResult`/`strictnessOf` in src/policy-gate.ts) to actual policy files.

## Facts

- `OrganizationPolicy` today is flat: `name`, `approved_sources`, `denied_permissions` (src/organization-policy.ts:1-6) — no paths, no rules, no conflicts possible.
- `enforceOrganizationPolicy` checks source approval and denied permissions per package subject; it has no path notion (packages declare permissions, not paths).
- The resolver exists and is tested: `PolicyRule` (id, paths, decision, alwaysRequireHuman), `resolvePolicy` (strictest-match-wins, prefix/`*` path matching), `applyAutomatedResult` (caps automated results at require-approval; never overrides always-require-human/deny) — src/policy-gate.ts, src/policy-conflicts.test.ts.
- `aiw policy-check` loads `.aiw/organization.yml`, requires it be git-tracked, and enforces subjects from `--package=` manifests, the lock file, and private registries.
- The strictness order is already fixed: `allow < require-approval < always-require-human < deny`.
- Package manifests declare `permissions` (string lists) — there is no per-path notion in package contracts today.

## Hypotheses

- Path rules make most sense scoped to **project paths** (which files/directories a package or change may touch), evaluated at `policy-check` time against the changed paths of the working tree or the declared package file lists — the organization decides what needs human review by path sensitivity (auth, billing, CI).
- The rule format can extend `organization.yml` additively: an optional `rules:` list where each rule has `id`, `paths`, `decision`, and optional `always-require-human`; absent `rules:` keeps today's flat behavior exactly.
- `aiw policy-check` becomes the primary consumer: it resolves every changed path against the rules and fails on `deny` or on `require-approval`/`always-require-human` without a recorded human approval — giving CI the enforcement hook.
- The `applyAutomatedResult` cap matters when a later automated signal (a scan, a classifier) tries to lower a strict decision: it can never go above require-approval and never touch always-require-human/deny.

## Decisions

- None yet; awaiting human direction on the open questions.

## Open Questions

- **Path source:** which paths do rules evaluate against — the working tree's changed files (git diff vs base), the package manifests' file lists, or both?
- **Approval record:** how is a human approval for a `require-approval` path recorded — a command (`aiw policy approve --paths=…`), a comment in the policy file, or delegated to branch protection?
- **Migration:** do existing flat policies need translation (they express source/permission policy, not path policy — probably orthogonal, kept as-is)?
- **Scope of consumers:** policy-check only, or also the `resolve`/`update` enforcement path (which currently uses approved_sources/denied_permissions)?
- **Rule count/validation limits:** cap rules per policy, validate ids/paths at parse time (consistent with orchestration's ≤64 tasks)?

## Users

- Platform/tech leads who set organization policy for repos adopting aiw packages and want sensitive paths (auth, billing, CI config) to always require human review.
- CI pipelines running `aiw policy-check` as a required check.

## Desired Outcomes

- `organization.yml` can express path-scoped rules with deterministic conflict resolution.
- `aiw policy-check` enforces them: deny blocks, require-approval/always-require-human demand recorded human approval.
- Automated signals can never weaken a strict rule (resolver guarantee, now actually consumed).
- Existing flat policies keep working unchanged.

## Constraints

- Additive-only policy schema (NFR pattern from prior workflows); `aiw organization-policy --file=` validation must accept both shapes.
- No new network/subprocess surface; path evaluation uses local git/files only (or purely declared lists).
- Resolver semantics are fixed and tested — the wiring must use them, not reimplement them.

## Risks

- Path semantics on non-git repos: changed-path evaluation needs git; declared-list evaluation does not — the fallback question in Open Questions.
- Approval records could become a bypass vector if self-reported — must be a deliberate, attributable human action, consistent with trust boundaries.
- Rule explosion in large orgs — validation limits and strictest-wins determinism keep evaluation predictable.

## Non-Goals

- GitHub branch-protection integration (that stays with the forge).
- Replacing the flat approved_sources/denied_permissions enforcement.
- Auto-approving anything — automation can only tighten or report, never approve.

## Scope Candidates (for specification, if approved)

1. Additive `rules:` format in organization.yml (id, paths, decision, always-require-human) with parse/serialize/validate.
2. `aiw policy-check` evaluates changed paths (git-based, with declared-list fallback) through `resolvePolicy` and enforces the resolved decision.
3. Recorded human approval for require-approval/always-require-human paths (exact mechanism per the design decision).
4. `applyAutomatedResult` wired where an automated signal exists (e.g. scan/advisory results), capped as designed.

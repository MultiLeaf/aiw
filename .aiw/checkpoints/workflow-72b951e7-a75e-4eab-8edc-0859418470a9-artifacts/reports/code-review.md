# Code Review: End-to-end idea to merge-ready PR

- Workflow ID: 72b951e7-a75e-4eab-8edc-0859418470a9
- Date: 2026-11-27

## Scope

The TASK-001..TASK-006 diff: stage model (types/human-approval/artifact-paths), `aiw prd` and `aiw pr` commands, QA matrix gates, ADR enforcement, pr merge-ready gate with forecast auto-consumption, completion-report PR section, templates and skills (pr-submission new), and test updates for the new feature stage order.

## Findings

- F-1 (minor, robustness): the pr-gate forecast auto-consumption reads the *first* `checkpoints/orchestration-*.yml` file with a repo-level `orchestration.yml`; in a repository with multiple orchestration plans the forecast may target an unrelated plan. Mitigated by try/catch fallback and the human checklist. Evidence: src/workflow.ts pr-gate branch. triage: judgment-required
- F-2 (minor, correctness): the plan-gate TC↔REQ check validates per-line linkage; a TC line that references a REQ on a following line (wrapped) would be flagged as unlinked. Bounded: the template documents the one-line format. Evidence: src/quality-gates.ts plan branch. triage: auto-fixable
- F-3 (minor, robustness): `prReadinessSection` extracts report sections by regex; a heading body containing `## ` inside a fenced code block would truncate extraction. Cosmetic — evidence lines, not decisions. Evidence: src/completion-report.ts. triage: auto-fixable
- F-4 (info, process): in-flight workflows hit ledger drift when the feature stage list changes; the repair is a manual ledger edit (performed for this workflow with a recorded reason). A future `aiw doctor` rule could automate this. triage: judgment-required

## Checks

- Full suite: 797 tests pass, including the new pr/prd/ADR/QA-matrix suites and all pre-existing suites updated only for the legitimate stage-order change.
- `npm run check` (format, eslint, tsc, build, vitest, security) → exit 0.
- Gate strictness review: new checks are ratcheted (legacy artifacts pass unchanged); the pr gate verifies locally checkable evidence and defers forge-only facts to the human checklist.
- Trust boundaries: no forge/network/subprocess additions in the CLI; `aiw pr` prints host-side instructions only (asserted by test); forecast re-use is local git with fallback.
- Process regression: bugfix and idea-assessment stage lists untouched (test-asserted); completion blocked until pr resolves (test-asserted).
- Traceability: TC entries flow into requirement `tests` arrays without schema change.

## Residual Risks

- Multi-plan repositories may consume the wrong forecast (F-1) — human checklist covers it.
- Self-reported PR evidence (CI, unresolved count) is forge-verifiable only by the human at merge — by design (D2/D5).
- Stage-list changes strand in-flight ledgers until repaired (F-4) — CHANGELOG note recommended.

## Decision

Accept — findings are minor/informational with bounded impact; F-1 and F-4 are advisory follow-ups (multi-plan forecast targeting, doctor rule for stage-list drift) that do not block this workflow.

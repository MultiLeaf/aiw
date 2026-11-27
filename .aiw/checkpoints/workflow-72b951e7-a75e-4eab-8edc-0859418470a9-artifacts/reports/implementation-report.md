# Implementation Report: End-to-end idea to merge-ready PR

- Workflow ID: 72b951e7-a75e-4eab-8edc-0859418470a9
- Date: 2026-11-27
- Source: Implementation plan v1 (approved), TASK-001..TASK-006

## Changed Files

- src/types.ts — TASK-001: `HUMAN_APPROVAL_STAGES += ["product-requirements", "pr"]`; `PROCESSES.feature.stages` extended with both stages (bugfix/idea-assessment unchanged).
- src/human-approval.ts — TASK-001: `STAGE_DEFINITIONS` entries (both optional, quality-gated).
- src/artifact-paths.ts — TASK-001: legacy paths for the two new stages (drives workflow-scoped paths).
- src/workflow.ts — TASK-002: `aiw prd` command; TASK-005: `aiw pr` command (scaffold + host-side instructions), pr-gate auto-consumption of the orchestration merge forecast; TASK-004: ADR existence check in the technical-design gate; completion flow passes prReadiness to the report.
- src/quality-gates.ts — TASK-002: product-requirements five-section gate; TASK-003: plan TC↔REQ checks and verification executed-case checks; TASK-004: Consequential Decisions ADR-link checks; TASK-005: pr merge-ready gate (reference, CI pass, unresolved: 0, clean conflicts, fully-checked checklist).
- src/traceability.ts — TASK-003: TC-### cases from the plan's Test Plan section collected into each requirement's `tests` array.
- src/completion-report.ts — TASK-006: `prReadiness` input and PR readiness section (approved → extracted evidence; otherwise stage status line).
- src/cli.test.ts — feature walkthrough updated to the new stage order (prd gate+approve, pr skip), skip helpers for the new optional stages.
- src/human-approval.test.ts — stage graph test updated; feature ledger helper skips product-requirements.
- src/opp013-digest.test.ts, src/opp015-governance.test.ts — skip the new optional stage in setup.
- src/quality-gates.test.ts — TASK-002/003/004 gate tests (PRD sections, QA matrix, ADR links).
- src/adr-gate.test.ts — TASK-004: ADR file existence blocks/passes end-to-end.
- src/workflow-pr.test.ts — TASK-005: pr scaffold + host instructions, merge-ready gate, completion blocking, forecast auto-consumption with a real conflicting git branch.
- src/completion-report.test.ts — TASK-006: PR readiness section tests.
- resources/templates/product-requirements.md, pr-readiness.md — new templates.
- resources/templates/implementation-plan.md — Test Plan section (QA matrix).
- resources/templates/technical-design.md — Consequential Decisions section.
- resources/skills/pr-submission.md — new host-side PR skill (triage discipline, evidence, human merge decision).
- resources/skills/implementation-planning.md, verification.md, technical-design.md — TC matrix and ADR guidance.

## Tests

- TASK-001: stage graph, optionality, process lists, artifact paths (updated human-approval/cli/artifact-paths tests).
- TASK-002: PRD gate positive/negative (quality-gates.test.ts) + full-stage-run walkthrough gate/approve (cli.test.ts).
- TASK-003: plan TC↔REQ failures, verification executed-case failures, ratchet cases (quality-gates.test.ts); TC entries in the trace graph (traceability tests, full walkthrough).
- TASK-004: gate blocks missing ADR file, passes with a real `aiw adr`-created file (adr-gate.test.ts) + syntax checks (quality-gates.test.ts).
- TASK-005: pr scaffold prints host instructions; gate blocks on placeholder/incomplete reports and passes ready reports; completion blocked until pr resolved; orchestration forecast auto-consumption blocks on real merge conflicts (workflow-pr.test.ts).
- TASK-006: PR readiness completion section present (approved), status line (skipped), absent (no pr stage) (completion-report.test.ts).
- Regression: full suite 797 tests passing, including all pre-existing suites updated only where the feature stage list legitimately changed (documented risk).

## Validation

- TASK-001: Validation: `npx vitest run src/human-approval.test.ts src/artifact-paths.test.ts` → exit 0
- TASK-002: Validation: `npx vitest run src/cli.test.ts` → exit 0
- TASK-003: Validation: `npx vitest run src/quality-gates.test.ts src/cli.test.ts` → exit 0
- TASK-004: Validation: `npx vitest run src/quality-gates.test.ts` → exit 0
- TASK-005: Validation: `npx vitest run src/workflow-pr.test.ts src/cli.test.ts` → exit 0
- TASK-006: Validation: `npx vitest run src/completion-report.test.ts src/command-evidence.test.ts` → exit 0
- Full project quality: `npm run check` (format:check + lint + typecheck + build + vitest 797 + security:check) → exit 0.

## Deviations

- REQ-001 forecast auto-consumption: reuses the first `checkpoints/orchestration-*.yml` with a matching `orchestration.yml` plan; when the repo is not a git repository or the plan drifted, it falls back to recorded report evidence (try/catch) — the design's "recorded evidence remains the fallback".
- REQ-002: PRD digest citation into specification is covered by the digest mechanism automatically (specification digest freshness follows artifact content); no additional wiring was needed beyond the stage itself.
- REQ-003: TC traceability is plan-based (the plan's Test Plan section is the single source of TC↔REQ links collected into the trace graph); the verification report's Test Results are gate-checked but not re-parsed into the graph.
- New blocking codes: none added; PR/ADR/TC findings flow through the existing `gate_incomplete` vocabulary (per design).

## Requirements Implemented

- REQ-001: pr stage, `aiw pr` scaffold + host-side instructions, merge-ready gate, forecast auto-consumption, completion blocking.
- REQ-002: product-requirements optional stage, `aiw prd`, template, five-section gate, skip mechanics.
- REQ-003: QA test matrix in plan and verification gates (ratchet for legacy artifacts), TC links in traceability.
- REQ-004: Consequential Decisions section with ADR existence enforcement.
- REQ-005: PR readiness section in the completion report.

# Technical Design: End-to-end flow from idea to merge-ready PR

- Workflow ID: 72b951e7-a75e-4eab-8edc-0859418470a9
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Specification v1 (approved), decisions D1..D5

## Context

The CLI's process model lives in `src/types.ts` (`HUMAN_APPROVAL_STAGES`, `PROCESSES`), stage records/gates in `src/human-approval.ts` + `src/quality-gates.ts`, scaffolding commands in `src/workflow.ts` (`brainstorm`/`spec`/`plan` pattern), and templates in `resources/templates/`. The flow ends at `traceability` + `workflow complete`. The specification adds two stages (`product-requirements`, `pr`), QA matrix wiring, ADR enforcement, and a PR-aware completion report, all additive and host-execution (D1/D4 NFR: no forge code in the CLI).

## Proposed Design

### 1. Stage model changes (REQ-001, REQ-002)

- `HUMAN_APPROVAL_STAGES` gains `product-requirements` and `pr` (append-only; both optional in `STAGE_DEFINITIONS`).
- `PROCESSES.feature.stages` becomes: brainstorming, **product-requirements**, specification, technical-design, plan, implementation, verification, review, traceability, **pr**. Bugfix and idea-assessment keep their current lists (resolves open question 1: PRD/PR are feature-process stages only).
- `LEGACY_STAGE_PATHS` (src/artifact-paths.ts) gains `product-requirements → generated/specs/product-requirements.md` and `pr → generated/reports/pr-readiness.md` (kind/name split drives the workflow-scoped path).
- New blocking reason codes: `pr_gate_unresolved` (CI/comments/conflicts unresolved) reuses `gate_incomplete` findings instead — decision: reuse `gate_incomplete` with PR-specific finding text; no new code unless parity tests require.

### 2. New commands (REQ-001, REQ-002)

- `aiw prd [--title=…]` — mirrors `aiw brainstorm`: `assertStageReady(product-requirements)`, writes the template scaffold (Problem, Users, Outcomes, Non-goals, Success signals) to the workflow-scoped path.
- `aiw pr [--title=…]` — mirrors `aiw spec`: scaffolds `pr-readiness.md` with sections PR Reference, Branch/Base, CI Evidence, Review Comments, Conflict Check, Merge-Ready Checklist; the output **prints host-side instructions** (`git push`, `gh pr create`, `gh pr checks`, `gh pr merge --merge` guidance as text) without executing anything (D1, NFR-004).
- Templates also added under `resources/templates/` (product-requirements.md, pr-readiness.md) for host-side discovery.

### 3. Gate extensions (REQ-001..REQ-004)

- **product-requirements gate:** `requireSections` over the five sections (light gate, like brainstorming).
- **pr gate:** sections required as in REQ-001; plus semantic checks: CI Evidence must contain a passed result line; Review Comments must declare unresolved = 0 with resolution evidence; Conflict Check must be "clean" — when an orchestration checkpoint exists for the workflow, the gate **auto-consumes the merge forecast** (resolves open question 2) and fails on any `conflicts > 0`; otherwise it accepts recorded evidence. Merge-Ready Checklist must have every item checked, including the human-only items (branch protection, approvals) marked as human-verified.
- **plan gate (REQ-003):** requires a Test Plan section listing `TC-###` cases, each case referencing at least one `REQ-###`; gate fails on missing/unlinked cases. The plan template gains the section.
- **verification gate (REQ-003):** requires executed-case evidence — each declared TC-### appears with a result (pass/fail) and the command that produced it; failing cases block (existing `gate_incomplete`).
- **technical-design gate (REQ-004):** requires a Consequential Decisions section; every entry lists an ADR path matching `.context/adrs/ADR-*.md` that exists on disk; an explicit `None` passes. The `aiw adr` command stays as-is.

### 4. Traceability (REQ-003)

- TC links **reuse the existing `tests` field** in traceability link entries (resolves open question 3): the `trace` command collects TC-### references from the plan/verification artifacts into each requirement's `tests` array alongside test names. No schema change; the YAML already accepts arbitrary strings.

### 5. Completion report (REQ-005)

- `buildCompletionReport` (src/completion-report.ts) gains an optional PR block: PR reference, CI result, unresolved comments, conflict status, merge-ready decision, evidence links — sourced from the approved `pr-readiness.md` artifact when present; explicit "no PR stage (skipped)" line otherwise. Additive fields; old reports unchanged.

### 6. Skills/adapter guidance

- `resources/skills/implementation-planning.md` and `verification.md` updated to require the TC matrix; `technical-design.md` (skill) updated to require ADR linking; new `pr-submission.md` skill instructing the host: create branch, push, `gh pr create`, run checks, address comments (triage: auto-fixable vs judgment-required per REQ-004 of workflow 4f3eab42), re-run the conflict forecast, fill `pr-readiness.md`, gate, present, wait.

## Alternatives

- A `pr` command that shells out to `gh` — rejected: breaks portability and trust boundaries (NFR-001/004, D1).
- PRD folded into the brainstorm template — rejected: brainstorm captures exploration, PRD captures product intent; mixing them weakens both gates, and the stage model already supports optional stages cleanly.
- A new `tc` link field in traceability — rejected: `tests` already carries arbitrary strings; a new field would touch the strict schema parser for no gain.
- New blocking-reason code for PR findings — rejected: `gate_incomplete` findings carry the specifics; fewer codes keeps the continuation-inventory parity test simple.
- CLI polling of CI (`gh run watch` equivalent) — rejected per D2: evidence recording is deterministic, offline, and trust-boundary safe.

## Interfaces

- **CLI (additive):** `aiw prd [--title=…]`, `aiw pr [--title=…]`; `aiw gate <product-requirements|pr>`; existing commands unchanged.
- **Types (additive):** `HUMAN_APPROVAL_STAGES += ["product-requirements", "pr"]`; `PROCESSES.feature.stages` extended as above.
- **Artifact paths (additive):** `generated/specs/<wf>/product-requirements.md`, `generated/reports/<wf>/pr-readiness.md` (+ legacy fixed paths).
- **Gates (additive checks):** plan (TC↔REQ), verification (executed cases), technical-design (ADR links), pr (merge-ready), product-requirements (sections).
- **Templates (new):** `resources/templates/product-requirements.md`, `resources/templates/pr-readiness.md`; plan template gains a Test Plan section.
- **Completion report (additive):** optional PR block.
- **Skills:** new `pr-submission.md`; edits to implementation-planning, verification, technical-design.

## Risks

- Adding stages to `PROCESSES.feature` changes stage sequencing for in-flight workflows — mitigation: `processStages` reads the ledger's process at start; new workflows get the new list, and `aiw doctor`/repair handles drift; version the process list change in CHANGELOG.
- PR gate could be gamed by self-reported evidence — mitigation: conflict forecast is auto-checked when a checkpoint exists; CI/comment counts are forge-verifiable by the human at merge; the checklist marks human-only items explicitly.
- TC matrix adds gate friction for small changes — mitigation: the light lane and bugfix process are unaffected; the plan gate accepts a small matrix (one case per REQ minimum).
- Two more stages lengthen the approval chain — mitigation: both new stages are optional with human-accepted skips.

## Validation

- Unit/contract tests: new-stage scaffolding (prd/pr commands); each new gate check (positive + negative cases); TC↔REQ plan check; executed-case verification check; ADR existence check; PR gate auto-consumption of the merge forecast when a checkpoint exists; completion-report PR block present/absent.
- Process regression: feature workflow walkthrough test updated to the new stage order; bugfix/idea-assessment unchanged; skip mechanics for both new stages.
- Traceability: TC entries appear in the `tests` arrays of the trace graph.
- Project quality: `npm run check` (format, lint, typecheck, build, vitest, security) exit 0.
- Acceptance mapping: every REQ-001..005 acceptance criterion has at least one named test.

## Traceability

- REQ-001 → §1, §2 (aiw pr), §3 (pr gate), §6 | REQ-002 → §1, §2, §3 | REQ-003 → §3 (plan/verification gates), §4, §6 | REQ-004 → §3, §6 | REQ-005 → §5 | NFR-001..004 → D1/D2, §2, §6, Alternatives | Open questions resolved: Q1 → §1, Q2 → §3, Q3 → §4.

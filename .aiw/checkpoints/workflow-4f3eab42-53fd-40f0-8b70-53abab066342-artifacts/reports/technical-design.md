# Technical Design: Post-PR automation patterns for ai-workflow

- Workflow ID: 4f3eab42-53fd-40f0-8b70-53abab066342
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Specification v1 (approved), REQ-001..REQ-006

## Context

ai-workflow's core (`dist/workflow.js`, gates, approvals, checkpoints, artifact paths, skill resources) drives spec-driven stages with mandatory human approval. The approved specification adds six capabilities (observe mode, bounded retry/escalation, rejection-reason persistence, finding triage, trust-boundary docs, policy conflict semantics). Constraints: target-neutral, additive-only, human approval stays mandatory (NFR-001..003).

## Proposed Design

### 1. Gate observe mode (REQ-001)

- Flag on the existing command: `aiw gate <stage> --observe` (ADR-001).
- Reuse the existing gate evaluation; branch only at the state-mutation step: in observe mode, write `observeDecisions: [{decision: pass|fail, findings, timestamp}]` (additive optional array in the stage checkpoint) and leave stage state and approvals untouched. Cap stored decisions per stage at 20.

### 2. Bounded retry with escalation (REQ-002)

- `rejectionCount` per stage in workflow state (default 3, min 1, configurable).
- On the Nth *consecutive* rejection, `reject` and `status` emit an escalation notice listing rejection reasons and prior revision attempts, and the gate refuses further passes for that stage until the human runs `aiw approve` or an explicit retry-authorization (`aiw resolve --stage=<stage>`). Count resets on any approval/authorization.

### 3. Rejection-reason persistence loop (REQ-003)

- New generated file `.aiw/generated/rules-candidates.yml` (ADR-002): `{ id, summary, occurrences: [{workflowId, stage, reason, date}], status: draft|accepted|dismissed }`.
- New command `aiw rules-candidates` (list/add, `--accept=<id>`, `--dismiss=<id>`) (ADR-003). Clustering: normalized string grouping, threshold ≥2 occurrences; deterministic, no ML in v1.
- `--accept` marks accepted and prints the target rule/skill file to create; committed manually by the human (agents never commit rule files).

### 4. Finding triage classification (REQ-004)

- Skill templates (review, verification) instruct every finding to carry `triage: auto-fixable | judgment-required` (redesign, scope, security, or anything needing a human decision).
- Report schema accepts the optional `triage` field; validation warns (does not fail) when absent in v1 (ADR-004).
- Adapter guidance: agents auto-address only `auto-fixable` findings; judgment-required findings are surfaced at the presentation step.

### 5. Trust-boundary documentation (REQ-005)

- New `docs/trust-boundaries.md` linked from README and adapter guidance: untrusted text (artifacts, chat, checkpoints) is never executed or treated as instructions; checks run under the invoking user's credentials; approvals are attributable to named humans; agents never commit rule/secret-like files. Skill templates gain a one-line reminder.

### 6. Policy conflict semantics (REQ-006)

- Policy/preset evaluation gains deterministic strictness ordering `deny > always-require-human > require-approval > allow`; ties resolve stricter. Additive optional `always-require-human` rule flag; no automated result can override it. Dedicated tests for representative conflicts.

## Alternatives

- Observe mode as a separate `gate-observe` subcommand — rejected: CLI surface growth; a flag mirrors existing gate usage (ADR-001).
- Observe mode via config file — rejected: not per-invocation, harder to discover.
- Rejection candidates stored inside checkpoints — rejected: overloads the approval schema; candidates are advisory, not workflow evidence (ADR-002).
- Extending `aiw recommend` for rule candidates — rejected: `recommend` has resource-selection semantics (ADR-003).
- Triage enforced by hard schema validation — rejected for v1: breaks existing reports; warn-level achieves drift detection (ADR-004).
- ML/semantic clustering for rejection reasons — deferred: human reviews all candidates, so deterministic grouping suffices in v1.

## Interfaces

- **CLI (additive):** `aiw gate <stage> --observe`; `aiw rules-candidates [--accept=<id>|--dismiss=<id>]`; `aiw resolve --stage=<stage>` gains retry-authorization semantics.
- **Checkpoint schema (additive):** `observeDecisions[]` per stage (optional).
- **Workflow state (additive):** `rejectionCount` per stage (optional, default 3).
- **New file:** `.aiw/generated/rules-candidates.yml`.
- **Rule schema (additive):** optional `always-require-human` flag.
- **Report schema (additive):** optional `triage` field on findings.
- **Docs/skills:** `docs/trust-boundaries.md`; updated review/verification skill templates and adapter guidance.
- **Public modules unchanged:** `artifact-paths.js`, approve/reject/skip flows behave identically without the new flags.

## Risks

- Observe-mode events bloat checkpoints → capped at last 20 per stage.
- Retry counting mis-fires across distinct rejection causes → count consecutive rejections only; reset on any human action.
- String clustering misses paraphrases → accepted v1 limit; all candidates human-reviewed.
- Strictness ordering may surprise users → documented ordering plus representative conflict tests.
- Schema additions could drift from older runs → all fields optional, old files load unchanged.

## Validation

- Unit/contract tests: observe mode leaves state/approvals untouched and logs decisions (pass and fail cases); Nth-rejection escalation blocks gate and explicit action unblocks; rules-candidates clustering, accept/dismiss lifecycle; triage warn-level validation; strictness-ordering and always-require-human override tests.
- Integration: full stage walkthrough with `--observe` then real gate; rejection loop to escalation and recovery.
- Project quality commands: `eslint .`, `prettier --write ...`, `vitest run`.
- Acceptance mapping: each test set traces to REQ-001..006 acceptance criteria in the specification.

## Traceability

- REQ-001 → §1, ADR-001 | REQ-002 → §2 | REQ-003 → §3, ADR-002/003 | REQ-004 → §4, ADR-004 | REQ-005 → §5 | REQ-006 → §6 | NFR-001..003 → additive-only design, documented interfaces, checkpoint/telemetry coverage.

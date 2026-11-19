# Technical Design: Decision Model — Findings Triage and Lane Scope-Watch

> Ticket: OPP-007 · Spec REQ-001…REQ-005

## Context

`src/decision.ts` already has request builders (`buildEvidenceTriageRequest` pattern), an Ollama provider, and config gating via `loadDecisionConfig` (`decision` section). `src/model-routing.ts` holds evidence-linked advisory categories. Adversarial review (OPP-003) is a skill package without runtime code — the doc defers runtime wiring to its runtime phase, so OPP-007 ships the deterministic check, the model builders, a CLI surface, and the lane advisories.

## Proposed Design

### 1. `src/decision.ts` — new pure builders

- `parseReviewFindings(text): ReviewFinding[]` — minimal findings model (`id`, `severity`, `claim`, `evidence` refs / `file:line`).
- `checkFindingShapes(findings): string[]` — REQ-001 deterministic shape check (severity present; proof references or `file:line` non-empty). Pure parse, zero model.
- `buildFindingsTriageRequest(findings)` — REQ-002 batched: one `DecisionRequest` whose state is the serialized findings and whose questions are one `choice` (`yes/no/unclear`) per **severe** finding id ("Does the cited evidence support the claim?"). Non-severe findings are not sent.
- `buildLaneScopeWatchRequest(changeSummary)` — REQ-004: one `choice` question ("Does the change footprint span multiple subsystems?") with the deterministic diff summary as state.

### 2. CLI surface (`src/workflow.ts`)

- `aiw decision findings-triage --findings=<path>`: runs the shape check always (printed); when the decision model is enabled, additionally calls the provider once (batched) and prints advisory `evidence_supported: yes/no/unclear` per severe finding plus "refuter still owns corroboration" note. Unconfigured → shape check only, no network, byte-stable output.

### 3. Lane advisories (REQ-003/004)

- `task start --lane=light`: when the deterministic risk assessment tier is `high` (reuse `laneAdvisory`'s assessment source), append a mismatch advisory line to the start output (never blocks, never changes lane).
- `workflow complete` (light): always append the deterministic mismatch note when the recorded assessment tier is `high`; when the decision model is enabled, additionally one `buildLaneScopeWatchRequest` call whose answer is printed as one advisory line. Unconfigured → byte-identical output.

### 4. Routing + docs (REQ-005)

- `src/model-routing.ts`: extend the built-in table with `review.findings-triage` and `workflow.lane-watch` rules, each carrying an evidence link (opportunity doc + parity runs) or `unevidenced-rule` label; inert without `decision` config.
- `docs/decision-model-evaluation.md`: document both advisory flows and the batched-call constraint.

## Interfaces

- `ReviewFinding = { id: string; severity: string; claim: string; evidence: string[] }`
- `checkFindingShapes(findings: ReviewFinding[]): string[]`
- `buildFindingsTriageRequest(findings: ReviewFinding[]): DecisionRequest`
- `buildLaneScopeWatchRequest(changeSummary: string): DecisionRequest`

## Alternatives

- Per-finding model calls — stronger isolation, n× cost; rejected for the batched single request (spec constraint).
- Embedding-based evidence matching — that is OPP-008's lane; keeps this change deterministic-parse + one choice question.

## Risks

- Provider failures must degrade silently to shape-check-only output (advisory flows never fail the command).
- Findings file format is host-agent-produced markdown/YAML; the parser must fail closed (treat unparseable as shape failure) without throwing.

## Validation

- Unit: builders, shape check (pass/fail/fail-closed), batched request shape.
- CLI: findings-triage unconfigured (byte-stable, no network), enabled (advisory flags, single call via fake provider); light-lane start/complete mismatch notes; complete byte-identical when unconfigured.
- Full `npm run check`.

# Specification: Decision Model — Findings-Evidence Triage and Lane Scope-Watch

> Ticket: OPP-007
> Version: 0.1

## Purpose

Connect the existing decision-model infrastructure (advisory-only, `decision` settings section) to two semantic blind spots: severe adversarial-review findings whose cited evidence may not support the claim, and light-lane scope abuse that deterministic tier rules cannot see. Deterministic guards always run; the model adds advisory-only signal; unconfigured means byte-identical behavior with zero network.

## Requirements

### REQ-001: Deterministic findings shape check always runs

- **Description:** Severe adversarial-review findings get a pure-parse shape check (severity present; proof references or `file:line` non-empty) independent of any model.
- **Acceptance criteria:**
  - Given a severe finding without proof references or `file:line`, when the shape check runs, then it is reported as a shape failure without any model call.
  - Given any findings set, when the decision model is unconfigured, then behavior and output are byte-identical to today and no network request is made.

### REQ-002: Model triage adds an advisory evidence-supported flag

- **Description:** When the decision model is enabled, severe findings additionally get one triage question ("does the cited evidence support the claim?") recorded as advisory `evidence_supported: yes/no/unclear` next to the finding.
- **Acceptance criteria:**
  - Given a severe finding whose cited evidence does not support the claim, when triage runs enabled, then the finding carries the advisory flag and the refuter still decides corroboration/refutation.
  - Given any model triage output, then no evidence state, gate outcome, approval, or blocking behavior changes; the flag is advisory only.

### REQ-003: Deterministic lane mismatch notice runs always

- **Description:** On light-lane `task start` with a `high` risk-assess tier, and on light-lane completion, a tier-vs-lane mismatch notice is recorded even without any model.
- **Acceptance criteria:**
  - Given a light-lane start or completion with a `high` deterministic risk signal, then a mismatch advisory note is recorded (checkpoint/ledger) and printed.
  - Given the note, then it never blocks, never changes the lane, and never lowers a tier.

### REQ-004: Model scope-watch adds the semantic dimension when enabled

- **Description:** When the decision model is enabled, light-lane completion additionally asks one scope question (multi-subsystem footprint) recorded as an advisory note.
- **Acceptance criteria:**
  - Given an enabled model and light-lane completion, then the completion output may carry one advisory scope-watch line.
  - Given the model unconfigured, when light-lane completion runs, then output is byte-identical to today.

### REQ-005: Routing categories are declared with evidence links

- **Description:** New `routing.yml` categories (`review.findings-triage`, `workflow.lane-watch`) gated by the existing `decision` settings section; unevidenced rules are labeled `unevidenced-rule`.
- **Acceptance criteria:**
  - Given a `routing.yml` with the new categories, then each rule carries an evidence link or is labeled `unevidenced-rule`.
  - Given no `decision` configuration, then the categories are inert.

## Constraints

- No new settings sections; reuse `decision` config validation (NFR-2).
- Advisory-only forever: no blocking, no tier changes, no lane changes, no evidence-state changes (NFR-3); human acceptance unchanged.
- Batched request preferred over per-finding calls when the findings set is non-trivial (open question resolved: batch per findings file, one request).

## Traceability

- Backlog item OPP-007; opportunity doc `docs/opportunities/OPP-007-decision-findings-triage-scope-watch.md`; ADR-001 Decision A.

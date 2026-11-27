# Specification: Doctor rule for stage-list drift and CHANGELOG entry

- Workflow ID: 18b9fdaa-7a62-4502-9a54-737cfafe9107
- Ticket: AIW-001
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Code-review finding F-4 (workflow 72b951e7) and the technical-design risk mitigation for the stage-list change.

## Context

When `PROCESSES` stage lists change between versions (e.g. `product-requirements` and `pr` were added to the feature process), in-flight workflows break: the ledger parses fine until a decision references a stage whose new prerequisites are unresolved, then every command fails with "Approval ledger has out-of-order decision". The only recovery today is a manual ledger edit (performed for workflow 72b951e7 with a recorded reason). Additionally, the stage-list behavior change for in-flight workflows has no CHANGELOG entry, though the design requires documenting it.

## Requirements

### REQ-001: Doctor detects stage-list drift

- **Description:** `aiw doctor` reports a diagnosis and a concrete repair when an active workflow's ledger has approved/skipped/rejected/pending stages whose prerequisites (per the current process list) are unresolved.
- **Acceptance criteria:**
  - Given an active workflow whose ledger contains a decision for a stage whose new prerequisite is unresolved (drift)
  - When `aiw doctor` runs
  - Then the output names the drifted stage(s), the unresolved prerequisite(s), and the exact repair command
  - And `aiw doctor` still exits non-zero (or reports the issue) so CI/tooling can detect the unhealthy state

### REQ-002: Doctor applies the recorded-skip repair on request

- **Description:** A `aiw doctor --fix` (or equivalent) mode inserts a `skipped` record with a recorded reason for each unresolved new prerequisite of an otherwise-decided stage, restoring the ledger to a valid state without inventing approvals.
- **Acceptance criteria:**
  - Given the drift state from REQ-001
  - When the repair command runs
  - Then each unresolved prerequisite that blocks an already-decided stage is recorded as `skipped` with `qualityGate: not-applicable`, a reason naming the drift, and a timestamp
  - And no stage that already has a decision is modified or invalidated
  - And subsequent commands (gate/status/approve) work without the out-of-order error

### REQ-003: CHANGELOG entry for the stage-list change

- **Description:** The CHANGELOG documents that the feature process gained `product-requirements` and `pr` stages and what in-flight workflows must do.
- **Acceptance criteria:**
  - Given the repository's CHANGELOG
  - When the entry is added
  - Then it states the two new feature-process stages, that existing feature workflows may need the doctor repair (or a recorded skip) for `product-requirements`, and that `workflow complete` now requires the `pr` stage to resolve
  - And the entry follows the existing CHANGELOG format and unreleased section conventions

## Non-functional Requirements

- **NFR-001 Safety:** the repair never invents approvals — only explicit `skipped` records with reasons; a stage with no decision of its own is never touched.
- **NFR-002 Backwards compatibility:** `aiw doctor` without flags behaves as today plus the new diagnosis line; no existing output contract changes.

## Constraints

- Reuse the existing skip-record semantics (`skipOptionalStage`-equivalent fields) rather than a new schema.
- The rule must work for any future stage-list change, not only the `product-requirements`/`pr` case (generic prerequisite-drift detection).

## Open Questions

None — scope is fully defined by the ticket and the F-4 finding.

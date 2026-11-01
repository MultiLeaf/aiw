# Continuation Inventory

Every blocking `aiw` exit carries a stable reason code plus either an exact runnable continuation or an explicit terminal statement. A message may name a command only when running that command resolves the block it was printed for (OPP-004, [ADR-001](../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md)).

- Codes are declared in `src/blocking-reasons.ts` (`BLOCKING_REASON_CODES`); adding a code requires a definition with a continuation producer and a test.
- With `--json`, blocking exits return `{ "reason_code": ..., "next_command" | "next_action" | "terminal": ... }`.
- The table below is generated from the registry; a test in `src/blocking-reasons.test.ts` fails CI when this page drifts from the code.

| Reason code                     | Description                                                                                   | Continuation     |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ---------------- |
| `gate_evidence_missing`         | The quality gate is blocked because the required evidence artifact is missing.                | explicit action  |
| `gate_incomplete`               | The quality gate found completeness issues in the stage artifact.                             | explicit action  |
| `stage_prerequisite_pending`    | A previous stage is awaiting human approval before this stage can start.                      | runnable command |
| `stage_prerequisite_unresolved` | Previous stages need human approval or an accepted optional skip before this stage can start. | runnable command |
| `stage_awaiting_approval`       | This stage is awaiting human approval; approve or reject it before continuing.                | runnable command |
| `stage_already_approved`        | This stage is already approved; changed evidence requires rerunning its quality gate.         | runnable command |
| `approval_evidence_missing`     | Approval cannot be recorded because the stage evidence artifact is missing.                   | explicit action  |
| `approval_stale`                | The artifact changed after review; its approval is stale and the gate must run again.         | runnable command |
| `approval_gate_missing`         | No passing quality gate is recorded for this stage; gate it before approving.                 | runnable command |
| `lane_escalation_required`      | Light-lane workflows do not author stage artifacts; escalate to the full lane to continue.    | explicit action  |
| `light_evidence_missing`        | A light-lane workflow cannot complete without at least one recorded validation entry.         | explicit action  |
| `workflow_still_active`         | A workflow is already active; finish or archive it before starting another.                   | explicit action  |
| `workflow_not_active`           | No SDD workflow is active for this command to operate on.                                     | runnable command |
| `workflow_complete`             | This workflow is already complete; start a new workflow to continue working.                  | runnable command |

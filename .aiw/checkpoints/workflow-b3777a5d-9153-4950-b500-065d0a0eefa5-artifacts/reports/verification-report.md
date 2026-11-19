# Verification Report

## Requirements Checked

- REQ-001 (deterministic shape check), REQ-002 (advisory evidence flag), REQ-003 (lane mismatch note), REQ-004 (model scope-watch), REQ-005 (routing categories)

## Checks Passed

- Validation: npx vitest run src/decision.test.ts → exit 0 (13 passed)
- Validation: npx vitest run src/cli.test.ts → exit 0 (184 passed)
- Validation: npm run check → exit 0 (90 files, 750 tests)
- `aiw verify` → Verification passed

Requirement → evidence:
- REQ-001: `decision.test.ts` pass/fail/fail-closed shape tests; CLI test prints shape results with zero provider calls when unconfigured.
- REQ-002: CLI test with a fake provider prints `evidence_supported: yes/no` for severe findings only plus the refuter-owns note; output never blocks (exit 0).
- REQ-003: light-lane completion test asserts the `advisory: risk assess reports high` line in output; the note is also written to the light checkpoint (`advisories` field).
- REQ-004: enabled-model completion test asserts exactly the advisory `scope-watch: multi_subsystem=yes (advisory-only)` line; unconfigured baseline run contains no scope-watch output.
- REQ-005: `model-routing.test.ts` resolves both categories with evidenced/unevidenced-rule/default-unset labeling.

## Missing Evidence

None.

## Residual Risks

None identified; all model paths degrade silently and are advisory-only.

## Decision

Complete.

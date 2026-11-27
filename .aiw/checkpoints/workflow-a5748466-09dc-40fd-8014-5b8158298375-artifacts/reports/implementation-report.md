# Implementation Report: Hardening follow-ups

- Workflow ID: a5748466-09dc-40fd-8014-5b8158298375
- Ticket: AIW-002
- Date: 2026-11-27
- Source: Implementation plan v1 (approved), TASK-001..TASK-005

## Changed Files

- src/workflow.ts — TASK-001: pr-gate forecast targeting (reads the report's Branch section, matches plan id to the declared `aiw/<planId>/` branch prefix, iterates checkpoints and per-id plan files, skips non-matching plans, fallback unchanged); TASK-004: observe log written as YAML (`checkpoints/workflow-<id>-observe.yml`) with lossless legacy-JSON migration and removal; TASK-005: rules-candidates scan merges prior non-clustered (manual) entries.
- src/quality-gates.ts — TASK-002: TC case entry = its line plus indented continuation lines; REQ linkage checked over the whole entry.
- src/completion-report.ts — TASK-003: fence-aware section extraction in `prReadinessSection` (``` toggles fence state; `## ` inside a fence is content).
- src/workflow-pr.test.ts — TASK-001: conflict test now declares a matching branch; new non-matching-branch fallback test (unrelated plan checkpoint present, gate passes).
- src/quality-gates.test.ts — TASK-002: wrapped-REQ case passes; unlinked still fails.
- src/completion-report.test.ts — TASK-003: fenced `## ` body is extracted; next real heading terminates.
- src/workflow-observe.test.ts — TASK-004: YAML log asserted; new legacy-JSON migration test (entries preserved, JSON removed, cap honored by existing tests).
- src/rules-candidates.test.ts — TASK-005: manual entry survives rescan; dismissed status survives cluster reappearance.

## Tests

- TASK-001: matching plan consumed and conflicts block; non-matching branch falls back to evidence (gate passes with an unrelated checkpoint present); single-plan regression covered by the updated conflict test.
- TASK-002: `TC-001: login flow
  covers REQ-001` passes; unlinked case still fails.
- TASK-003: fenced inner heading extracted as CI Evidence content; Review Comments section still terminates correctly.
- TASK-004: YAML round-trip; legacy JSON migrated losslessly (old fail entry + new pass entry, JSON deleted).
- TASK-005: manual `rc-manual-rule` entry (accepted) survives rescans; dismissed clustered candidate stays dismissed.
- Regression: full suite 805 tests passing.

## Validation

- TASK-001: Validation: `npx vitest run src/workflow-pr.test.ts` → exit 0
- TASK-002: Validation: `npx vitest run src/quality-gates.test.ts` → exit 0
- TASK-003: Validation: `npx vitest run src/completion-report.test.ts` → exit 0
- TASK-004: Validation: `npx vitest run src/workflow-observe.test.ts` → exit 0
- TASK-005: Validation: `npx vitest run src/rules-candidates.test.ts` → exit 0
- Full project quality: `npm run check` (format:check + lint + typecheck + build + vitest 805 + security:check) → exit 0.

## Deviations

- REQ-001: per-id plan files are read as `orchestration-<id>.yml` at the repo root (plus the canonical `orchestration.yml`), as designed; the declared branch must start with `aiw/<planId>/` for a plan to be consumed — a feature-named branch (not orchestration-named) falls back to recorded evidence, which is the design's intended conservative behavior.
- REQ-004: legacy JSON removal uses the optional `fs.remove`; filesystems without remove leave the JSON file in place (harmless duplicate; the YAML file is authoritative going forward).

## Requirements Implemented

- REQ-001: forecast consumed only from the plan matching the PR's declared branch; no-match falls back without failing.
- REQ-002: wrapped TC↔REQ linkage accepted; unlinked cases still fail.
- REQ-003: section extraction tolerates fenced code blocks.
- REQ-004: observe log in YAML with lossless JSON migration; cap unchanged.
- REQ-005: manual rules-candidates entries and dismissed statuses survive rescans.

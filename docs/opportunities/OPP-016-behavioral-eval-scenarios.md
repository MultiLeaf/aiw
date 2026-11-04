# OPP-016: Behavioral evaluation phase 2 — scenario registry replayed against real harness CLIs

- Status: Proposed
- Priority: P2
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A
- Source signal: external qualitative assessment scored "Behavioral evaluation 3/5 — deterministic evals; lacks real behavioral validation". Agreed: OPP-011 proves the skills **say** the right things; nothing yet proves agents **do** them.

## Problem

The shipped stage skills carry contract invariants (wait for explicit human reply, gate before approve, reasons required), and OPP-011's harness checks those invariants as text. What remains unvalidated is the behavior that emerges when a real coding agent reads them in a real repository: does the agent actually stop at the approval boundary, or does it proceed? Does a light-lane task really skip durable artifacts? Text invariants cannot answer behavior questions — only replaying scenarios against real harness CLIs can.

## Proposal

1. **Scenario registry**: declarative descriptors (YAML) per scenario — fixture repository state (files, git history), the harness command to run (`claude -p "…"` with `--permission-mode` bounded, `codex exec …`, `gemini -p …`), a bounded prompt driving one workflow action, and the **deterministic expected outcomes**: exit code, `.aiw/` state files (workflow.yml fields, approvals ledger statuses, checkpoint existence), and typed output envelopes (reason codes, digests). No prose assertions — state asserts only.
2. **Runner**: `aiw eval run --scenarios` executes each scenario in an isolated fixture copy, enforces wall-clock and token-usage ceilings per scenario, and asserts state outcomes exactly as the e2e suite does today. Missing harness CLI → the scenario is **skipped with an explicit marker** in results (never a silent pass). Retry policy: one retry on harness transport failure; a retry-passing scenario is reported as `flaky-suspect`, not green.
3. **CI shape**: a bounded smoke set (one scenario per stage family) runs on PRs touching `resources/` or templates; the full registry runs nightly. Both are advisory-first (report-only) for two release cycles before becoming gates — behavioral flakiness must be characterized before it can block.
4. **Determinism floor unchanged**: OPP-011 textual invariants and OPP-006's command ratchet remain the fast deterministic layer; scenarios are the behavioral layer on top.

## Affected areas

- New `src/eval/scenarios.ts` (registry parser, runner, result schema `aiw.scenario-results/v1`)
- `scenarios/*.yml` (initial registry: approval boundary, light-lane skip, escalation, bugfix process, rejection → re-gate)
- `.github/workflows/` (nightly behavioral job; advisory mode first)
- `docs/quality.md`, OPP-011 cross-link

## Acceptance criteria

- Given a scenario run twice on unchanged inputs, when results compare, then outcomes are identical (determinism), with token counts recorded per run via the usage sidecar.
- Given a harness CLI missing from the machine, when its scenarios are evaluated, then results mark them `skipped-harness-unavailable` and CI does not count them as passing.
- Given a fixture where the agent must stop at the approval boundary, when the scenario runs, then `.aiw/approvals.yml` shows `pending-human` and no later stage is started; an agent that proceeded fails the scenario.
- Given two consecutive release cycles, when the advisory period elapses, then at least the approval-boundary scenarios become CI gates (ratchet declared up front).
- Given no harness installed at all, when `aiw eval run --scenarios` runs, then it exits 0 with every scenario marked skipped and a summary naming what is missing.

## Non-goals

- No LLM-as-judge in CI; no free-form prose assertions; no behavioral guarantees for arbitrary user projects (fixtures only).
- No long-horizon scenarios (multi-hour sessions) — bounded, single-action scenarios first.

## Open questions

- Which harness CLIs are CI-available vs local-only, and how is availability detected robustly?
- Token ceiling per scenario run (real harness calls cost money) — pooled nightly budget vs per-scenario?
- Should scenario fixtures double as documentation examples?

# OPP-005: Friction benchmark — measure how users get stuck

- Status: Proposed
- Priority: P3
- Added: 2026-10-30
- Decision: [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md), Decision A

## Problem

AI Workflow measures token efficiency (`src/context-benchmark.ts`, `docs/token-efficiency.md`) but not **friction**: how often the workflow stops a user, and — more importantly — _how_ it stops them. Without that measurement, ceremony changes (like OPP-001) can't be evaluated, and blocking regressions (a gate that strands the user with no way out) are only discovered by users.

## Source concept (RDD)

Gentle-AI ships a reproducible benchmark that classifies every block into:

- **In band** — it stops you and tells you what to run;
- **Out of band** — it stops you and tells you nothing;
- **Dead end** — it stops you and there is nothing you can do.

Key design points worth copying:

- It measures friction, not speed ("speed depends on the provider and the day; friction is yours").
- It drives the **real packaged binary**, not a mock ("a number I publish and you cannot reproduce is a claim about my honesty; a number you can run yourself is evidence").
- The journey corpus includes adversarial states, not just the happy guide paths: bare repositories, half-finished migrations, empty files, mode flips mid-operation.
- Its own history shows why: first measurement was "six blocks, every one out of band"; after fixes, blocks stayed at the same _count_ but all moved in band, with zero dead ends — the tool didn't stop users less, it started telling them how to get out.
- The instrument must itself be suspect: one round measured a stale binary after a silent build failure; another counted the kill switch _working_ as tool-caused friction. Rule: point the instrument at itself first.

References:

- Gentle-AI `docs/architecture/the-organic-rdd-story.md`, section "The benchmark" and "The loop"

## Proposal

1. **Journey corpus**: scripted end-to-end journeys against the packaged CLI (`node dist/cli.js`), starting with the happy paths (install → scan → recommend → workflow start → task → gates → complete) and, critically, adversarial states: missing profile, stale approval, conflicting root context file, interrupted migration, empty repository, pre-existing `.aiw` state, gate failure mid-workflow.
2. **Block classification**: every non-success exit is classified in-band / out-of-band / dead-end by the harness, using OPP-004's reason codes and `next_command` as the in-band contract (a block with a `next_command` that resolves it, when executed, is in-band; a block with no continuation information is out-of-band; a block whose named continuation does not resolve it is a dead end).
3. **Reporting**: per-journey and aggregate counts; stored as a benchmark artifact so runs are comparable over time. CI budget: **zero dead ends allowed**; out-of-band count may not increase without an explicit waiver.
4. **Reproducibility**: the harness runs the same way locally and in CI against the packaged output, no internal APIs.

## Affected areas

- New `scripts/bench`-style harness (pattern: `src/context-benchmark.ts`, `scripts/*.node-test.mjs`)
- Depends on OPP-004 reason codes for classification (sequence OPP-004 → OPP-005)
- CI workflow wiring (`.github/`)
- `docs/quality.md` (completion criteria reference the friction budget)

## Acceptance criteria

- Given the journey corpus, when the benchmark runs against the packaged CLI, then every non-success exit is classified and counted.
- Given a block whose printed continuation resolves it when executed, when classified, then it counts as in-band (the harness actually executes continuations).
- Given a dead end, when detected, then CI fails with the journey name, reason code, and reproduction steps.
- Given two runs on unchanged code, when compared, then results are deterministic (no flaky classification).
- Given the happy-path journeys only, when run today, then the result is recorded as the baseline (expected: some out-of-band blocks; dead ends zero or explicitly waived).

## Non-goals

- No speed/latency benchmarking (explicitly excluded by the source concept; token efficiency is already covered).
- No telemetry dependency: the benchmark is local and reproducible; it does not phone home.

## Open questions

- Corpus growth policy: should each new OPP/blocking feature be required to add its adversarial journeys (ratchet)?
- Where do results live — `.aiw/` local state, CI artifacts, or a versioned `docs/benchmarks/` record?

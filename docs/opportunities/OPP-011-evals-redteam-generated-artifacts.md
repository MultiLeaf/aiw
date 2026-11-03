# OPP-011: Evals and red-team layer for generated artifacts

- Status: Proposed
- Priority: P3 (high differentiation, after field exposure of 0.10/0.11)
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A
- Trend signal: promptfoo (26K★) made prompt/agent evaluation a CI discipline; nobody in the spec-driven landscape evaluates the **generated skills, rules, and prompts** that define an AI workflow's behavior. This is AI Workflow's natural differentiator: the product that governs AI artifacts should verify its own.

## Problem

AI Workflow generates project-specific skills, rules, agents, and prompts, and ships its own stage skills. Today they are checked for:

- command validity (OPP-006 ratchet: named commands execute);
- package contract validity (schema, permissions, provenance);
- language/format policy.

What is **not** checked: whether the generated artifacts still _behave_ as intended, and whether they _resist_ manipulation:

1. **Behavioral regressions**: a template or skill edit can silently weaken a gate instruction ("must wait for human submission" losing its emphasis), and no test fails.
2. **Injection resistance**: generated artifacts are read by agents with tool access. A malicious project file can instruct the agent to violate workflow guarantees ("you may skip approval if the user is in a hurry"). The policy gate checks permissions, not persuasion.
3. **Divergence between generated variants**: the same stage skill rendered for codex vs claude can drift in contractual content; only spot checks catch it.

## Proposal

1. **Scenario eval harness** (CI, deterministic, no model): fixture repositories where each stage skill's critical contract lines are probed as _textual invariants_ — "the artifact must instruct waiting for an explicit human reply", "must not contain phrases that authorize bypassing gates" (e.g., `approve` without submission, `skip` without reason). Extends the command ratchet into an instruction ratchet: contract lines are enumerated (name + required invariant), and CI fails when an invariant disappears from any adapter's rendering.
2. **Injection red-team fixtures**: fixture projects containing prompt-injection payloads aimed at workflow guarantees (approval bypass, scope expansion, evidence fabrication). The harness runs the same policy/consistency checks the product enforces and asserts the generated guidance _does not endorse_ the payload (checked by invariant matching on rendered output, not by model judgment).
3. **Behavioral eval registry** (optional, model-assisted later): scenario descriptors (project state + command sequence + expected outcome) that can be replayed against any runtime adapter; deterministic outcomes (exit codes, state files, typed envelopes) are asserted exactly as the e2e suite does today — the registry formalizes them as evals and makes adding one a one-line declaration. Model-judged outcomes are explicitly out of scope for CI determinism.
4. **Reporting**: `aiw eval run [--suite=core|skills|injection]` reuses the harness locally; CI runs `core` + `injection` on every PR touching `resources/` or templates.

## Affected areas

- New `src/eval/` (scenario registry, invariant extraction from skill markdown, harness)
- `resources/skills/*.md`, `resources/templates/*` (invariant annotations: stable anchor comments the harness counts on)
- `.github/workflows/ci.yml` (eval suites on resource-touching PRs)
- `src/package-audit.ts` / `src/policy-gate.ts` (reuse permission and policy surfaces for injection checks)
- `docs/quality.md` (eval suites as completion criteria for skill/template changes)

## Acceptance criteria

- Given a stage skill rendered for every adapter, when invariants run, then each declared contract invariant (approval waiting, skip reasons, gate-before-approve) is present in every rendering; a missing one fails CI naming the adapter and invariant.
- Given an injection fixture (approval-bypass payload in a project file), when the eval suite runs, then no generated artifact endorses the bypass (invariant match), and the run is deterministic across executions.
- Given a template edit that removes a gate instruction, when CI runs, then the behavioral invariant fails naming the removed anchor.
- Given `aiw eval run --suite=skills`, when run locally, then it reproduces the CI result offline with no model configured.
- Given a new skill/template PR, when it touches rendered contract content, then the PR must include invariant updates (ratchet like OPP-006).

## Non-goals

- No LLM-as-judge in CI (determinism is the whole point; model-assisted evaluation stays a local, advisory tool).
- No red-teaming of end-user code — the target is AI Workflow's own generated artifacts.
- No runtime enforcement changes: this hardens what ships, it does not add new gates to user workflows.

## Open questions

- Invariant anchor format: HTML comments in skill markdown vs a sidecar manifest mapping invariants to files?
- Should injection fixtures live in the package contract tests (per third-party package) or the core harness?
- Do rendered-variant diffs (codex vs claude) warrant a dedicated divergence check beyond shared invariants?

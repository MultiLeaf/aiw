# Workflow Proportionality Opportunities

Improvement opportunities derived from the analysis of Gentle-AI's ODD/RDD methodology (Organic Driven Development and Receipt-Driven Development), recorded in [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md). Each document is self-contained: problem, source concept with references, proposal, affected areas, acceptance criteria, non-goals, and open questions — so any single opportunity can be picked up without reconstructing the original analysis.

The guiding principle: **ceremony should scale with the consequence of the change, not be constant.**

| ID                                                           | Opportunity                                                                          | Priority | Depends on                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------- | --------------------------------------- |
| [OPP-001](OPP-001-proportional-ceremony-light-lane.md)       | Proportional ceremony — light lane for small, understood work                        | P2       | OPP-002 (advisory signal, optional)     |
| [OPP-002](OPP-002-risk-assess-command.md)                    | `aiw risk assess` — content-based risk classification with exact next command        | P2       | —                                       |
| [OPP-003](OPP-003-adversarial-review-package.md)             | Adversarial review package — blind judges and proof-carrying findings                | P3       | —                                       |
| [OPP-004](OPP-004-exact-continuation-commands.md)            | Exact continuation commands — every block names a runnable way out                   | P1       | —                                       |
| [OPP-005](OPP-005-friction-benchmark.md)                     | Friction benchmark — measure how users get stuck (in-band / out-of-band / dead-end)  | P3       | OPP-004                                 |
| [OPP-006](OPP-006-emission-usability-test-policy.md)         | Emission ≠ usability — test that named commands actually work                        | P2       | OPP-004 (shared contract)               |
| [OPP-007](OPP-007-decision-findings-triage-scope-watch.md)   | Decision model — findings-evidence triage and lane scope-watch (advisory-only)       | P3       | OPP-001, OPP-003 (integration points)   |
| [OPP-008](OPP-008-embedding-covering-tests-judge-context.md) | Embedding retrieval — covering-test detection and judge context scoping              | P3       | OPP-002, OPP-003 (integration points)   |
| [OPP-009](OPP-009-process-entry-points.md)                   | Processes as entry points — bug-fixing and idea assessment alongside SDD             | P2       | OPP-001 (lanes), OPP-004 (reason codes) |
| [OPP-010](OPP-010-orchestration-worktree-isolation.md)       | Worktree isolation for orchestrated execution                                        | P2       | orchestration (ENT-007)                 |
| [OPP-011](OPP-011-evals-redteam-generated-artifacts.md)      | Evals + red-team layer for generated artifacts                                       | P3       | OPP-006 (ratchet)                       |
| [OPP-012](OPP-012-standards-discovery.md)                    | Standards discovery — codebase conventions into versioned standards                  | P3       | OPP-008 (retrieval)                     |
| [OPP-013](OPP-013-read-optimized-artifacts-digest-layer.md)  | Read-Optimized Artifacts — fingerprint-bound digest layer for downstream reads       | P1       | OPP-004 (typed blocks), CTX-002/004     |
| [OPP-014](OPP-014-paired-verification-contract.md)           | Paired Verification Contract — expected vs observed, mechanically compared           | P2       | OPP-004 (reason codes)                  |
| [OPP-015](OPP-015-token-recovery-governance.md)              | Token & Recovery Governance — enforced budgets, recovery block, advisory suggestions | P2       | CTX-004, OPP-002 (advisory signal)      |
| [OPP-016](OPP-016-behavioral-eval-scenarios.md)              | Behavioral evaluation phase 2 — scenario registry replayed against real harness CLIs | P2       | OPP-011 (deterministic floor)           |
| [OPP-017](OPP-017-orchestration-depth.md)                    | Orchestration depth — integration forecast, leak reporting, honor matrix             | P2       | OPP-010 (isolation)                     |
| [OPP-018](OPP-018-legacy-migration.md)                       | Supported migration path for legacy installations                                    | P1       | — (field-verified pain)                 |

Suggested starting order: **OPP-004 → OPP-002 → OPP-006 → OPP-001 → OPP-005 → OPP-003** (smallest/least invasive first; OPP-004's reason codes feed OPP-005 and OPP-006).

OPP-007 and OPP-008 are **model-integration addenda**: deliberately left for after field exposure — their priority should be set by real usage pain, not speculation. All model features respect the spec's NFR contracts: deterministic floor first, models advisory-only, unconfigured = byte-identical offline behavior.

## Trend-sourced addendum (2026-11)

OPP-009 through OPP-012 derive from a November 2026 landscape scan (spec-kit 145K★ shipping independent entry points; Spec Kitty / Conductor normalizing isolated-worktree parallel agents; promptfoo 26K★ establishing artifact evals; Agent OS 5.5K★ on standards discovery). The scan also **validated** the existing positioning: spec-driven development and human-in-the-loop governance are growing markets where AI Workflow's evidence ledger is the differentiator. Deliberately not chased: generic memory layers (audit-first philosophy), cloud-agent infrastructure (harness territory), commercial AI-review feature parity.

### Evaluation-sourced addendum (OPP-016..018)

An external qualitative assessment (Nov 2026) scored the release: specification-driven engineering, token governance, and workflow governance at 5/5; multi-agent orchestration and behavioral evaluation at 3/5; provider portability 4/5. The scores match the internal read — the 5s are the differentiators, the 3s are the frontier. OPP-016 (behavioral scenarios against real harness CLIs), OPP-017 (orchestration integration forecast, leak reporting, honor matrix) and OPP-018 (supported legacy migration, field-verified pain during inception) are the levers on those scores. The assessment also missed two documented strengths: the honest threat-model boundary and the friction benchmark as a quality instrument.

### Token-analysis addendum (OPP-013..015)

Measured on this repository's own full-lane artifacts (~2.2K-token specification, ~4.1K-token plan): downstream re-reads cost ~25-30K tokens per feature — roughly 80% of an artifact's lifetime token cost is re-reading, not writing. OPP-013 (digests), OPP-014 (paired verification) and OPP-015 (governance) attack that multiplier and make observed proof mechanically checkable, synthesizing the shared insight across spec-kit, ODD and HDAE: the full artifact is for humans; agents need a derived, verifiable view.

## Planning

The implementation is planned as six waves in the project's own SDD format:

- Specification: [`.aiw/generated/specs/odd-rdd-proportionality.md`](../../.aiw/generated/specs/odd-rdd-proportionality.md) (requirements REQ-OPP-001…006 with Given/When/Then criteria)
- Implementation plan: [`.aiw/generated/plans/odd-rdd-proportionality.md`](../../.aiw/generated/plans/odd-rdd-proportionality.md) (TASK-001…010 with code, tests, validation, and evidence per task)

## Source material

- Gentle-AI repository: `Gentleman-Programming/gentle-ai` (v4, ODD mandatory protocol)
- Key upstream docs: `docs/usage.md` (ODD protocol), `docs/review-integration.md` (RDD contract, `review assess`, stop reason codes, refuter probe), `docs/architecture/organic-rdd.md` (atomic review lifecycle), `docs/architecture/the-organic-rdd-story.md` (audit lessons, benchmark), `docs/review-authority-threat-model.md`
- What was deliberately **not** adopted and why: see ADR-001, Decision B

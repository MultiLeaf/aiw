# Workflow Proportionality Opportunities

Improvement opportunities derived from the analysis of Gentle-AI's ODD/RDD methodology (Organic Driven Development and Receipt-Driven Development), recorded in [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md). Each document is self-contained: problem, source concept with references, proposal, affected areas, acceptance criteria, non-goals, and open questions — so any single opportunity can be picked up without reconstructing the original analysis.

The guiding principle: **ceremony should scale with the consequence of the change, not be constant.**

| ID                                                                                              | Opportunity                                                                         | Priority | Depends on                            |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------- | ------------------------------------- |
| [OPP-001](OPP-001-proportional-ceremony-light-lane.md)                                          | Proportional ceremony — light lane for small, understood work                       | P2       | OPP-002 (advisory signal, optional)   |
| [OPP-002](OPP-002-risk-assess-command.md)                                                       | `aiw risk assess` — content-based risk classification with exact next command       | P2       | —                                     |
| [OPP-003](OPP-003-adversarial-review-package.md)                                                | Adversarial review package — blind judges and proof-carrying findings               | P3       | —                                     |
| [OPP-004](OPP-004-exact-continuation-commands.md)                                               | Exact continuation commands — every block names a runnable way out                  | P1       | —                                     |
| [OPP-005](OPP-005-friction-benchmark.md)                                                        | Friction benchmark — measure how users get stuck (in-band / out-of-band / dead-end) | P3       | OPP-004                               |
| [OPP-006](OPP-006-emission-usability-test-policy.md)                                            | Emission ≠ usability — test that named commands actually work                       | P2       | OPP-004 (shared contract)             |
| [007-decision-findings-triage-scope-watch](OPP-007-decision-findings-triage-scope-watch.md)     | Decision model — findings-evidence triage and lane scope-watch (advisory-only)      | P3       | OPP-001, OPP-003 (integration points) |
| [008-embedding-covering-tests-judge-context](OPP-008-embedding-covering-tests-judge-context.md) | Embedding retrieval — covering-test detection and judge context scoping             | P3       | OPP-002, OPP-003 (integration points) |

Suggested starting order: **OPP-004 → OPP-002 → OPP-006 → OPP-001 → OPP-005 → OPP-003** (smallest/least invasive first; OPP-004's reason codes feed OPP-005 and OPP-006).

OPP-007 and OPP-008 are **model-integration addenda**: deliberately left for after field exposure — their priority should be set by real usage pain, not speculation. All model features respect the spec's NFR contracts: deterministic floor first, models advisory-only, unconfigured = byte-identical offline behavior.

## Trend-sourced addendum (2026-11)

### Token-analysis addendum (OPP-013..015)

Measured on this repository's own full-lane artifacts (~2.2K-token specification, ~4.1K-token plan): downstream re-reads cost ~25-30K tokens per feature — roughly 80% of an artifact's lifetime token cost is re-reading, not writing. OPP-013 (digests), OPP-014 (paired verification) and OPP-015 (governance) attack that multiplier and make observed proof mechanically checkable, synthesizing the shared insight across spec-kit, ODD and HDAE: the full artifact is for humans; agents need a derived, verifiable view.

OPP-009 through OPP-012 derive from a November 2026 landscape scan (spec-kit 145K★ shipping independent entry points; Spec Kitty / Conductor normalizing isolated-worktree parallel agents; promptfoo 26K★ establishing artifact evals; Agent OS 5.5K★ on standards discovery). The scan also **validated** the existing positioning: spec-driven development and human-in-the-loop governance are growing markets where AI Workflow's evidence ledger is the differentiator. Deliberately not chased: generic memory layers (audit-first philosophy), cloud-agent infrastructure (harness territory), commercial AI-review feature parity.

## Planning

The implementation is planned as six waves in the project's own SDD format:

- Specification: [`.aiw/generated/specs/odd-rdd-proportionality.md`](../../.aiw/generated/specs/odd-rdd-proportionality.md) (requirements REQ-OPP-001…006 with Given/When/Then criteria)
- Implementation plan: [`.aiw/generated/plans/odd-rdd-proportionality.md`](../../.aiw/generated/plans/odd-rdd-proportionality.md) (TASK-001…010 with code, tests, validation, and evidence per task)

## Source material

- Gentle-AI repository: `Gentleman-Programming/gentle-ai` (v4, ODD mandatory protocol)
- Key upstream docs: `docs/usage.md` (ODD protocol), `docs/review-integration.md` (RDD contract, `review assess`, stop reason codes, refuter probe), `docs/architecture/organic-rdd.md` (atomic review lifecycle), `docs/architecture/the-organic-rdd-story.md` (audit lessons, benchmark), `docs/review-authority-threat-model.md`
- What was deliberately **not** adopted and why: see ADR-001, Decision B

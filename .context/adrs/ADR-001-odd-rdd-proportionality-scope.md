# ADR-001: Adopt ODD/RDD proportionality principles without abandoning the SDD model

- Status: Accepted
- Date: 2026-10-30
- Scope: Workflow design, CLI, quality gates, resource packages
- Source analysis: Gentle-AI `gentle-ai` v4 (Organic Driven Development and Receipt-Driven Development), documented in [docs/opportunities/README.md](../../docs/opportunities/README.md)

## Context

Gentleman Programming's Gentle-AI v4.0.0 retired Spec-Driven Development in favor of **Organic Driven Development (ODD)**: a workflow that scales ceremony to task size instead of routing every request through a fixed specification → design → plan → implementation pipeline. Its companion, **Receipt-Driven Development (RDD)**, adds a risk-based, atomic review lifecycle over frozen candidates.

AI Workflow is a spec-driven system by design: staged artifacts, automated quality gates, explicit human approval per stage, and a requirement → decision → task → code → test → evidence traceability graph. The two projects make opposite default choices, but the RDD/ODD analysis showed:

1. The **trust layer already converges**: human-owned delivery, approvals bound to exact content fingerprints, evidence over narration, opaque adapters, TDD by default, self-hosting.
2. The **open gap is ceremony proportionality**: AI Workflow applies uniform ceremony regardless of change size or risk, while ODD/RDD scale it ("a README edit gets zero ceremony; two lines of auth code get four reviewers").
3. Some RDD mechanisms are deliberately **not a fit** for AI Workflow's audit-oriented positioning (see Decision B).

Market signal: Gentle-AI retiring SDD indicates that uniform ceremony causes abandonment in daily individual use. AI Workflow's differentiators (portability, traceability, team policy, auditability) remain valuable, but they are only credible if the lightweight path also exists.

## Decision

### A. Adopt: proportionality and verifiable UX (six tracked opportunities)

Each item below is documented as a self-contained opportunity under `docs/opportunities/` and tracked in the backlog. They can be implemented independently and in any order.

| ID      | Opportunity                                                                                                | Core principle adopted                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| OPP-001 | [Proportional ceremony — light lane](../../docs/opportunities/OPP-001-proportional-ceremony-light-lane.md) | Ceremony scales with the consequence of the change, not constant (ODD "resume test")                                 |
| OPP-002 | [`aiw risk assess` command](../../docs/opportunities/OPP-002-risk-assess-command.md)                       | Risk is classified by what changed, not how much; read-only assessment with exact next command (RDD `review assess`) |
| OPP-003 | [Adversarial review package](../../docs/opportunities/OPP-003-adversarial-review-package.md)               | Severe findings require reproducible proof or degrade to advisory (RDD refuter + Judgment Day blind judges)          |
| OPP-004 | [Exact continuation commands](../../docs/opportunities/OPP-004-exact-continuation-commands.md)             | "A message may name a command only if running that command resolves the block" (RDD stop reason codes)               |
| OPP-005 | [Friction benchmark](../../docs/opportunities/OPP-005-friction-benchmark.md)                               | Measure how users get stuck: in-band / out-of-band / dead-end (RDD benchmark)                                        |
| OPP-006 | [Emission ≠ usability test policy](../../docs/opportunities/OPP-006-emission-usability-test-policy.md)     | A test that verifies a message was emitted does not verify it is usable (RDD audit lesson)                           |

### B. Deliberately do not adopt

| RDD/ODD mechanism                                           | Why AI Workflow keeps its current behavior                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Burn-after-acknowledge (no receipt survives review closure) | `.aiw/approvals.yml` is team audit history; the historical ledger is the product. Approvals already cannot be reused because they are fingerprint-bound and go stale on change. |
| Global kill switch (`review mode disable`)                  | AI Workflow's "skip with human-accepted reason" is more auditable. Extend skip semantics per task (OPP-001) rather than adding a global off switch.                             |
| Single-file feature document (Specs/Tasks/Log in one file)  | AI Workflow's separated spec/plan/report artifacts feed the traceability graph; collapsing them loses the differentiating audit surface.                                        |
| Frozen synthetic Git trees for review evidence              | Artifact SHA-256 fingerprints achieve the same integrity goal without synthetic object management.                                                                              |

## Consequences

- Workflow intensity becomes a spectrum (light lane → full SDD) instead of binary; the full SDD path remains the default for substantial work.
- Risk classification (OPP-002) must stay deterministic-by-default and advisory: model-driven ranking never changes evidence states or bypasses human approval, consistent with the existing decision-model contract.
- The six opportunities carry no dependency on each other; OPP-004 is the smallest and OPP-001 the largest.
- This decision does not rename or reposition AI Workflow: it stays spec-driven; proportionality reduces friction inside that model.

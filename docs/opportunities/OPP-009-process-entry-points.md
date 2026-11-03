# OPP-009: Processes as entry points — bug-fixing and idea assessment alongside SDD

- Status: Implemented (2026-11-01): feature/bugfix/idea-assessment processes with per-process stage lists, gates, and typed stage_not_in_process blocks
- Priority: P2
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A (lane architecture)
- Trend signal: `github/spec-kit` (145K★) ships bug-fixing and idea-assessment as **independent entry points, not mandatory phases** — the market confirmed the proportionality direction ADR-001 adopted; this opportunity matches its breadth.

## Problem

AI Workflow's staged pipeline is feature-centric. Real work arrives in at least two other shapes that today are force-fitted into the full lane (generating unread artifacts) or bypass the workflow entirely (generating no evidence):

1. **Bug reports** — nobody brainstorms a bug. The honest process is: reproduce/diagnose → scoped fix → verification that the reproduction now passes and the original behavior holds.
2. **Idea evaluation** — before any spec exists, the question is "is this worth building?" — an evidence-backed go / clarify / stop decision, not an implementation plan.

spec-kit's model validates the shape: processes are independent entry points assembled from shared primitives, some bundled as extensions. AI Workflow's lanes, reason codes, gates, and approval ledger are exactly such primitives — this opportunity composes them into first-class processes.

## Proposal

1. **Process definitions** (data, not code paths): each process declares its ordered stages and optional stages, extending the lane concept (OPP-001) from two lanes of one process to a small process registry:
   - `feature` (default, current 8 stages, unchanged);
   - `bugfix`: `diagnosis` (reproduction evidence is the artifact — observed behavior vs expected, environment) → scoped fix implementation (TDD: the failing reproduction test is the RED test) → verification → review. Brainstorming/specification/technical-design do not exist in this process; requirements are the reproduction itself.
   - `idea-assessment`: evidence gathering (read-only research with attributed sources) → assessment artifact with a single outcome (`go` / `clarify` / `stop`) + human decision; `go` may chain into a `feature` workflow carrying the evidence forward.
2. **CLI**: `aiw task start --ticket=X --process=bugfix` (feature stays the default; the process choice is human-made like the lane). Process names validate against the registry; `--process` composes with `--lane=light` where the process supports it (bugfix supports light; idea-assessment is inherently its own artifact shape).
3. **Ledger**: `ApprovalLedger` gains a `process` field (default `feature`); stage validation (`assertStageReady`, `getUnresolvedPrerequisites`) reads the process's stage list instead of the fixed `APPROVAL_STAGES`. Gates and fingerprint binding are reused as-is — every stage keeps the same "automated gate ≠ human approval" contract.
4. **Templates/skills**: `resources/templates/` gains diagnosis and assessment templates; a `bug-fixing` skill guides the diagnosis artifact (reproduction command, observed/expected, root cause with evidence, scope statement); an `idea-assessment` skill guides evidence-backed go/clarify/stop with attributed sources.
5. **Traceability**: `aiw trace` accepts diagnosis artifacts as evidence sources for bugfix workflows (requirement = the reproduction statement).

## Affected areas

- `src/types.ts` + `src/human-approval.ts` (process registry, per-process stage lists, ledger `process` field, validation per process)
- `src/workflow.ts` (`task start --process`, stage command routing per process, `workflow complete` per-process stage set)
- `src/quality-gates.ts` (diagnosis and assessment completeness validators)
- `src/traceability.ts` (diagnosis as evidence source)
- `resources/templates/`, `resources/skills/bug-fixing.md`, `resources/skills/idea-assessment.md`, `resources/package.yaml`
- `docs/architecture.md` (process registry section), `README.md`

## Acceptance criteria

- Given a bugfix task, when the workflow runs, then only diagnosis → implementation → verification → review stages exist; `aiw spec` blocks with a typed reason (`stage_not_in_process`); the diagnosis artifact requires a reproduction command and observed/expected behavior to pass its gate.
- Given an idea-assessment task, when it completes, then the assessment artifact records an outcome (`go`/`clarify`/`stop`) with attributed evidence, and a human decision on the outcome is required before the workflow closes; `go` records a forward link to the created feature workflow.
- Given the default no-`--process` invocation, when any stage command runs, then behavior is byte-identical to the feature process today.
- Given an archived ledger from ≤0.10.0, when 0.11+ reads it, then it is treated as `process: feature` (backward compatible, no migration).
- Given any process, when a stage blocks, then the blocking exit carries a reason code and exact continuation per the OPP-004 contract.

## Non-goals

- No user-defined custom processes in this iteration (the registry is code-defined; arbitrary composition is a later extension).
- No changes to the feature process's stage order, gates, or approvals.
- No automatic process inference from the ticket — the human picks; automation may suggest.

## Open questions

- Should `idea-assessment` outcomes feed recommendations (a `stop` recorded against a capability suppresses re-suggestion)?
- Does the bugfix process need a `regression-test` gate item distinct from verification evidence?
- Naming: `bugfix` vs `fix`; `idea-assessment` vs `assessment`.

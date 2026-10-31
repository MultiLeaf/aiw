# OPP-001: Proportional ceremony — light lane for small, understood work

- Status: Implemented (2026-10-30, plan Wave 4)
- Priority: P2
- Added: 2026-10-30
- Decision: [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md), Decision A

## Problem

Every AI Workflow task, regardless of size or risk, traverses the same staged pipeline (brainstorm → specification → ADR → plan → implementation → verification → review → traceability), each stage producing durable artifacts under `.aiw/generated/`. For small, well-understood changes this generates artifacts nobody reads, and users bypass the workflow manually — which then produces no evidence at all. Gentle-AI retired SDD for exactly this reason; the market signal is that uniform ceremony causes abandonment in daily use.

## Source concept (ODD)

ODD classifies task size with the **resume test**: work is _small_ when it is understood, risk is contained, and the work could be resumed from the original request plus `git diff`. Small work creates **no durable task artifacts**; substantial work creates exactly one feature document before the first source write. ODD also holds that findings never silently expand authorization, and scope growth is an explicit event.

References:

- Gentle-AI `docs/usage.md`, section "Organic Driven Development (ODD)" — protocol steps 4 (Classify) and 5 (Track before the first write)
- Gentle-AI `docs/intended-usage.md` — "Small, understood changes need no persistent task artifact"

## Proposal

Add a **light lane** alongside the existing full SDD lane:

1. New flag `aiw task start --lane=light` (full lane remains the default).
2. Entry criteria, evaluated and recorded at start — all must hold:
   - the change is understood well enough to resume from the request plus `git diff` (the ODD resume test, stated verbatim in the command output so the human makes the call);
   - expected blast radius is contained (no new requirement IDs, no architecture decision needed);
   - TDD applies or an exception is recorded with reason.
3. Light-lane behavior:
   - No durable spec/plan/report artifacts are scaffolded.
   - Evidence is still required: task validation commands run and completion evidence is recorded in `.aiw/checkpoints/` (compact form, linked to the ticket if present).
   - The lane decision and its entry criteria are persisted, so audits can see why the light lane was used.
4. Escalation: if scope grows beyond the entry criteria (new requirement, ADR needed, risk found), the task must escalate to the full lane; the escalation is an explicit recorded event, never a silent expansion. Escalation preserves already-recorded evidence.

## Affected areas

- `src/workflow.ts`, `src/types.ts` (lane state, escalation event)
- CLI: task/workflow commands (`src/cli.ts`)
- Stage skills and templates rendered through adapters (resources that describe the SDD sequence)
- `docs/README.md` (main README workflow section), `docs/architecture.md` (approval contract description)
- Checkpoint/evidence recording (`src/evidence.ts`, `src/human-approval.ts` interactions)

## Acceptance criteria

- Given a task started with `--lane=light`, when no scope growth occurs, then completion requires no `specification.md`/`implementation-plan.md` artifacts and records validation evidence plus the lane rationale in checkpoints.
- Given a light-lane task, when scope growth is detected (or declared), then escalation to the full lane is required before further stage commands run, and prior evidence is preserved and linked.
- Given the full lane (default), when a task starts, then behavior is unchanged from today.
- Given a light-lane completion, when `.aiw/approvals.yml` is inspected, then the ledger shows the light-lane rationale, not a missing approval.
- Non-interactive runs without an explicit lane default to the full lane.

## Non-goals

- No global "workflow off" switch (see ADR-001 Decision B).
- No change to full-lane stage order, gates, or approval semantics.
- No automatic lane detection that overrides the human's classification; automation may only suggest.

## Open questions

- Should the light lane allow skipping the brainstorm/spec stages only, or also merge implementation + verification evidence into a single checkpoint artifact?
- Should escalation be self-declared by the agent, human-confirmed, or both (recommend both: agent proposes, human confirms)?
- Does the lane need representation in `traceability` output (e.g., a light-lane marker on the ticket)?

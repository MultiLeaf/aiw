---
name: research
description: Run a bounded, evidence-first investigation from a single question — logs, errors, code, or external sources — and record a durable research artifact.
---

# Research (bounded, evidence-first)

Use this skill when work starts from a concrete question that needs context gathered before anything is decided or designed: an unexplained error, a log signature, a migration implication, a library behavior. This skill collects and sharpens context; it never decides, designs, or replaces diagnosis/brainstorming.

## Scope gate (before any work)

1. Restate the request as **one investigable question**. If the request bundles several questions or is vague, ask the human to confirm a single question and stop until they do.
2. List the **explicit sources**: file paths, log locations, a reproduction command, or external documentation areas. No source list, no start.
3. If the question turns out to need a fix or a decision rather than facts, stop and suggest the right lane: `aiw task start --process=bugfix` (diagnosis) or a brainstorm/specification workflow.

## Budget and stop conditions

- Cap the investigation at a fixed budget: at most ~10 investigation steps or 3 turns, whichever comes first.
- Stop and converge when either: two independent sources confirm the answer, or the budget is exhausted.
- On stop, report what was verified, what remains open, and the budget usage. Never continue "just a bit more" past the cap.
- If scope grows beyond the question mid-flight, stop and escalate (`aiw task escalate --reason=...` in a light-lane session, or suggest a full workflow) instead of widening the investigation.

## Evidence rules (every finding)

- Every finding cites a **verifiable source**: `file:line`, a log line with its timestamp, or a URL with the consultation date.
- Mark each finding's state: **fact** (source directly states it), **hypothesis** (inferred, cited basis named), or **unverified** (no source yet — belongs in open questions, not findings).
- A claim without a verifiable citation is an **open question**, never a finding.
- Prefer the repository's own evidence first: `aiw semantic query <terms>` when semantic mapping is enabled, exact `grep`/`rg` for literals, logs and reproduction commands before external sources.

## External research (host-side)

- You (the host agent) perform any web or documentation searches; AIW does no network calls.
- **Redact secrets before querying or persisting**: tokens, credentials, internal hostnames, and anything the interpreter guardrails would exclude must not appear in queries, excerpts, or the artifact.
- Record each external source as URL + consultation date in the artifact's source list.

## Artifact

Write the result to `.aiw/generated/reports/<workflowId>/research.md` with exactly these sections:

```markdown
# Research: <question>

## Question
<the single confirmed question>

## Sources
- <file:line / log location / reproduction command / URL + consultation date>

## Findings
- <finding> — state: fact|hypothesis — source: <citation> — confidence: high|medium|low

## Budget
steps used: <n> / cap · stop reason: <confirmed|budget>

## Open questions
- <unresolved items, next most-likely source>
```

Confidence uses the scan evidence vocabulary (high/medium/low). Then record completion in the session:

- Light-lane session: `npx --yes --package=@multileaf/ai-workflow -- aiw task evidence --validation="research artifact: .aiw/generated/reports/<workflowId>/research.md (<findings count> findings, <open count> open)"`.
- No active workflow: start one first — `aiw task start --no-ticket --lane=light --lane-reason="bounded research, resumable from request plus artifact"` — artifact paths are workflow-scoped.

The artifact feeds later stages (brainstorm, specification, diagnosis); cite it rather than re-reading sources.

# ADR-002: Workflow-Scoped Generated Artifact Paths

- **Status:** accepted
- **Related artifacts:**
  - .aiw/generated/specs/9fd618d1-b576-44f7-bff3-57680034b6b8/specification.md

## Context

Stage artifacts are written to fixed shared paths (`generated/specs/specification.md`, `generated/plans/implementation-plan.md`, `generated/reports/*.md`, `generated/artifacts/traceability.yml`). Starting a new workflow overwrites the previous workflow's artifacts, and readers (gates, approval fingerprints, traceability, context retrieval) cannot tell which workflow an artifact belongs to. This loses evidence, contaminates context recovery, and breaks auditability (FRIC-005).

## Alternatives

1. **Timestamped artifact names** — e.g., `specification-20260101.md`. Rejected: readers must guess the newest; no isolation guarantee.
2. **Copy-on-start archive of legacy paths** — archive old fixed-path artifacts when a workflow starts. Rejected: still shared mutable paths during the workflow; archives without ownership semantics.
3. **Workflow-scoped directories** (chosen) — `generated/<kind>/<workflowId>/<name>.md`, resolved through the active workflow id everywhere; legacy fixed paths remain readable with an advisory.

## Decision

Introduce a single path-resolution module (`src/artifact-paths.ts`): writers emit workflow-scoped paths when a workflow id is known; resolvers prefer the scoped path and fall back to the legacy fixed path (advisory) so existing installations keep working. Completion archives the workflow's scoped artifact trees alongside the session in `checkpoints/workflow-<id>-artifacts/`.

## Rationale

Workflow ids are UUIDs, so paths are collision-free without coordination. One resolution module prevents the current drift of ~15 hardcoded path sites. Legacy fallback keeps upgrades non-destructive and observable (advisory) instead of a blocking migration.

## Consequences

- Every artifact read/write must flow through the resolver; new hardcoded paths fail review.
- Emitted instructions (skills, blocking reasons) must reference the resolution rule or the CLI-printed path, not fixed paths, and remain covered by emission-usability tests.
- Archiving adds a copy at completion; artifacts are small (markdown/YAML), so cost is negligible.

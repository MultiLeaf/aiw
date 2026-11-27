# Technical Design: Resource Update Command

> Ticket: UPD-001 · Spec REQ-001…REQ-004

## Context

`ownership.yml` stores a `sha256-<checksum>` per owned file captured at render time — this is the drift oracle update needs. `loadBundledResources(target)` yields the current catalog (personalized per profile at render). `sync` re-renders the recorded selection with a preview/approve fingerprint flow; `recommend --select` regenerates everything. Nothing diffs installed vs catalog.

## Proposed Design

### 1. Update plan (`src/update.ts`, new module)

`computeUpdatePlan(fs, root, aiw, target, addIds)` → pure-ish plan:

- **Installed set**: ownership entries with `resourceType`/`resourceId` metadata (neutral + target renders of each selected resource).
- **Diff per installed resource**: `checksum(installed bytes) ≠ ownership.checksum` → **conflict** (user drift; preserve). Else `desired catalog bytes ≠ installed bytes` → **updated**. Else **unchanged**.
- **New**: catalog resource ids (mapped from the capability catalog via `resourcesForCapabilities`) not in the installed set.
- `--add=ids` validated against the catalog; unknown id → error listing available ids; valid ids append to the plan's install set and to the `recommendations.yml` selection (additive, never removing).

### 2. Apply (`aiw update [--dry-run] [--add=id,id]` in `src/workflow.ts`)

- `--dry-run`: print the plan (updated/new/unchanged/conflict + exact `--add=` continuation), write nothing.
- Apply: `updated` files replaced atomically, ownership checksums refreshed, lock untouched (package identity unchanged); `--add` renders new resources through the existing `addOwned`/atomic-write path and gains ownership entries.
- Conflicts: preserved files listed; command exits 1 with a new typed blocking reason `update_conflict` (detail names the paths; `Next:` points to manual resolution then re-run). Follows the blocking-reason convention and gets the standard continuation-inventory coverage.
- Idempotent: a second run with everything current reports `unchanged`, exit 0.
- No prompts; output deterministic for identical state (REQ-004).

### 3. Help/wiring

- Usage string gains `update [--dry-run] [--add=id,id]`; `update --package=` (local package flow) keeps its own branch — the new flag-less form serves bundled resources; conflict between the two usages resolved by `--package` presence.
- README/docs: update path documented in the upgrade steps.

## Interfaces

- `computeUpdatePlan(fs, root, aiw, target, add: string[]): UpdatePlan` where `UpdatePlan = { updated: string[]; conflicts: string[]; newIds: string[]; unchanged: number; install: ResourceReference[] }`
- Blocking reason `update_conflict` (code, description, continuation).

## Alternatives

- Reuse `sync`'s fingerprint flow — rejected: it re-renders the old selection, has an approval round-trip, and cannot diff versions; update is a different operation (drift oracle = ownership checksum, not expected-content compare).
- Store rendered-content snapshots per version — rejected: ownership checksums already provide the drift oracle without new state.

## Risks

- Ownership metadata without `resourceType` (legacy or supporting files) — those are skipped by the diff and reported as `unchanged` (never touched).
- Personalization: desired bytes depend on the profile; the plan computes desired content through the same personalization path as sync, so byte comparison stays apples-to-apples.

## Validation

- Unit: plan computation (updated/new/unchanged/conflict), `--add` validation and additive selection.
- CLI: full lifecycle — install, simulate catalog change (fixture bundle), update replaces; manual edit → conflict exit 1 with typed reason; `--dry-run` writes nothing; idempotent second run; `--add=research` installs without touching the rest.
- Full `npm run check`.

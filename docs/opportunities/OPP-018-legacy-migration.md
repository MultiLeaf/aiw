# OPP-018: Supported migration path for legacy installations

- Status: Implemented (2026-11-03): aiw migrate with dry-run/rollback, doctor and install detection, deterministic-floor classification
- Priority: P1 (field-verified pain; cheapest large-value gap in the backlog)
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A
- Source signal: **field-verified during inception** — this repository itself ran an ancient (pre-ownership) installation and had to be migrated by hand: install preserves, uninstall refuses (ownership unverifiable), repair ignores, sync demands ownership. A controlled backup → fresh install → selective restore worked but is undiscoverable for a normal user. An external evaluation separately scored provider portability 4/5 citing "variable depth per harness" — migration depth is part of that.

## Problem

Installations created before the ownership inventory (roughly ≤0.9.x) enter a **closed loop** under 0.12+:

- `doctor` reports missing `ownership.yml` and stops;
- `install` sees existing state and preserves it without rebuilding the inventory;
- `uninstall` refuses to remove resources it cannot verify ownership of (fail-closed — correct);
- `sync` refuses to apply plans without the inventory;
- `repair` does not cover the gap.

Result: the only paths are hand-crafted file surgery (undiscoverable, undocumented) or staying on a broken state. Every user who installed before the inventory is stranded on upgrade.

## Proposal

1. **`aiw migrate`** (with `--dry-run` first): detects legacy state (`manifest.yml`/`lock.yml` present, `ownership.yml` absent) and performs a transactional, rollback-protected migration:
   - snapshot legacy machine state (`lock.yml`, `recommendations.yml`) into `.aiw/checkpoints/migration-<timestamp>/` for history, but leave the live files in place — their owning commands (`aiw recommend`, `aiw skills install`, `aiw sync`) rewrite them in the modern format;
   - rebuild the ownership inventory by scanning current AI-Workflow-managed paths and classifying each file: `managed-unchanged` (matches known content), `legacy-user-modified` (preserved as user-owned, listed for manual review), `unknown` (listed as manual action);
   - preserve byte-identical user configuration (`decision.yml`, `semantic.yml`, `organization.yml`, `heartbeats.yml`, `settings.yml`) and all checkpoints/generated artifacts;
   - produce a migration report: what was archived, rebuilt, preserved, and what needs manual review.
2. **Detection and guidance**: `doctor` detects the legacy signature and reports it with the typed continuation `aiw migrate --dry-run`; `install` on legacy state suggests the same (instead of the bare "already installed" message).
3. **Rollback**: apply writes a rollback checkpoint (the archived originals); `aiw migrate --rollback` restores them atomically — mirroring the target-migration rollback contract (MIG-002).
4. **Fail-closed on ambiguity**: non-standard files that cannot be classified are listed as manual actions and never silently adopted or deleted.

## Affected areas

- New `src/legacy-migration.ts` (detection, classification, transactional apply, rollback)
- `src/workflow.ts` (command wiring; doctor legacy detection; install legacy suggestion)
- `src/ownership.ts` (inventory builder for legacy layouts)
- Tests with fixture legacy layouts (0.7-era and 0.9-era shapes: no ownership, old lock format, old ai-init skill)
- `docs/` (migration guide; release-process note that v0.12+ environments also trust `main` for the release chain)

## Acceptance criteria

- Given a 0.7-era layout fixture (no ownership, old lock, old ai-init skill), when `aiw migrate --dry-run` runs, then it lists exactly: archived files, rebuilt files, preserved files, and manual actions — without writing anything.
- Given `aiw migrate` applied, when `aiw doctor` runs, then health passes; when `aiw sync --dry-run` runs, then it produces a plan (ownership present); and user config files are byte-identical to before.
- Given migration applied, when `aiw migrate --rollback` runs, then the original legacy state is restored atomically and doctor reports the legacy condition again.
- Given a fixture with a hand-modified generated rule, when migration runs, then the file is classified `legacy-user-modified`, preserved as user-owned, and listed for manual review — never overwritten.
- Given ambiguous non-standard files, when migration runs, then it refuses to complete and names them as manual actions (fail-closed).
- Given an installation already on the modern inventory, when `aiw migrate` runs, then it reports nothing to do and changes nothing.

## Non-goals

- No automatic schema upgrades beyond recreating the base state (schema 1 is forward-compatible; legacy artifacts are archived, not transformed).
- No adoption of ambiguous files without explicit human action.
- No deletion of any user data at any point (archival, never removal).

## Open questions

- Version heuristic: absence of `ownership.yml` + presence of `lock.yml` is the signature — is any additional fingerprint needed to distinguish 0.7-era from hand-rolled directories?
- Should `migrate` offer to re-run `scan`+`recommend` at the end (guided continuation), or stop after the transactional state move?
- Does the ownership rebuild need to recognize resources from known historical package versions to classify `managed-unchanged` accurately, or is content-hash matching against current bundled resources sufficient?

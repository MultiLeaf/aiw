# Specification: Resource Update Command

> Ticket: UPD-001
> Version: 0.1

## Purpose

A first-class `aiw update` action that brings installed bundled resources to the current package version drift-safely and lets users add catalog resources additively — without re-running the recommendation wizard.

## Requirements

### REQ-001: Update diffs the catalog against the installation

- **Description:** `aiw update [--dry-run]` compares installed bundled resources (from ownership/lock) against the CLI's bundled catalog and reports `updated`, `new`, `unchanged`, and `conflict` per resource.
- **Acceptance criteria:**
  - Given an installation with resources whose catalog version differs, when `aiw update --dry-run` runs, then it lists them as `updated` without writing anything.
  - Given catalog resources not installed, when update runs, then they are listed as `new` with the exact `--add=` continuation.
  - Given all resources current, when update runs, then it reports `unchanged` and exits 0.

### REQ-002: Replacement is drift-safe

- **Description:** A resource is replaced only when the installed bytes are unmodified relative to its previously rendered content; manually edited files are preserved and reported as conflicts.
- **Acceptance criteria:**
  - Given an installed resource identical to its rendered version but newer in the catalog, when update applies, then the file is replaced and ownership/lock stay consistent.
  - Given a manually edited resource, when update applies, then the file is untouched, listed as a conflict, and the command exits 1 with a typed reason and `Next:` continuation.
  - Given `--dry-run`, when conflicts exist, then they are reported and nothing is written.

### REQ-003: `--add` installs catalog resources additively

- **Description:** `aiw update --add=<id,id>` installs listed catalog resources (skills/rules/etc.) into the active target, adding to the existing selection without removing anything.
- **Acceptance criteria:**
  - Given valid catalog ids, when `--add` runs, then the resources render to the active target, ownership/lock gain entries, and previously installed resources remain.
  - Given an unknown id, when `--add` runs, then the command fails with the available ids and nothing is written.
  - Given `--add` combined with `--dry-run`, when it runs, then a preview lists the planned writes without mutating.

### REQ-004: Non-interactive and deterministic by default

- **Description:** No prompts without a TTY; behavior depends only on local state.
- **Acceptance criteria:**
  - Given a non-TTY environment, when update runs, then it completes without prompting and its output is deterministic for the same state.
  - Given identical installations, when update runs twice, then the second run reports `unchanged` (idempotent).

## Constraints

- The catalog is the CLI's own bundled package; `--version=` is accepted only as documentation of intent, never fetching other versions.
- Exit codes follow the blocking-reason convention (conflicts exit 1 with a typed reason and exact continuation).
- Lock entries, ownership metadata, and atomic write paths are reused, not duplicated.

## Traceability

- Brainstorm artifact (this workflow); gap analysis preceding ticket UPD-001.

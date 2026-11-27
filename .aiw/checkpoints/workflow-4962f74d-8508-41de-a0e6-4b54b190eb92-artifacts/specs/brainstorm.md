# Resource Update Command

## Goal

Give existing installations a first-class `aiw update` action: bring installed bundled resources (skills, rules, agents, hooks, templates) to the current package version drift-safely, and let users add new catalog resources without re-running the installation wizard — closing the gap where `sync` only re-renders the previous selection and `recommend --select` re-asks from scratch (with an empty `--select=` even deselecting everything).

## Users

- Maintainers of projects with older AIW installations upgrading to a new CLI release.
- Users who see a new skill in a release (e.g., `research` in 0.16.0) and want to add it to an existing installation in one step.
- CI/automation that needs a non-interactive, deterministic update path.

## Facts

- `lock.yml` records package versions; each resource in `resources/package.yaml` is individually versioned.
- `sync` re-renders the resources selected in `recommendations.yml`; manual edits are preserved as conflicts, never overwritten.
- `recommend --select=id,id` regenerates recommendations and re-asks; `--select=` (empty) declines everything.
- Ownership inventory (`ownership.yml`) proves which files AIW owns — the safety base for any in-place update.
- Nothing today diffs installed resource versions against the current catalog.

## Assumptions

- The catalog to update from is always the package bundled with the CLI in use (no cross-version fetching).
- Byte-identical-to-installed-version is a sufficient proxy for "no user drift" when deciding safe replacement.

## Hypotheses

- A catalog-vs-installed diff (updated / new / unchanged / conflict) removes the guesswork that forces users through recommend again.
- `--add` as an additive operation (never deselecting) is the UX users expect when a release ships new skills.

## Constraints

- Drift-safe forever: manually edited files are preserved and reported, never overwritten.
- Non-interactive by default (automation-friendly); interactive confirmation only when a TTY exists.
- No network: the catalog is local to the CLI package.
- Approval gates, lock entries, and ownership metadata stay consistent after update.

## Risks

- Misjudging user drift (edited file replaced) — mitigated by byte comparison plus conflict preservation.
- State inconsistency between lock, ownership, and rendered files — mitigated by reusing the existing atomic write + ownership paths.
- Scope creep into Vercel/registry updates — out of scope; those keep their own commands.

## Non-goals

- Cross-version fetching or pinning to arbitrary old versions (`--version` only documents intent; the catalog is the CLI's own).
- Updating external skills (`skills update` keeps owning Vercel).
- Interactive wizards.

## Open Questions

1. Should `update` also refresh generated project resources (context/rules regenerated from profile), or only bundled catalog resources?
2. Should conflicts block with exit 1 (CI-friendly) or exit 0 with a conflict list (script-friendly)? 
3. Does `--add` require a permission review like install (audit-package flow) for bundled resources, or is the local catalog pre-trusted?

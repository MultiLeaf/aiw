# Adapter Model

Adapters translate the neutral resource model into a target agent's conventions.

```text
Neutral skill → Codex SKILL.md
Neutral rule  → Cursor .mdc / Claude instruction / AGENTS.md
Neutral agent → Target agent declaration or best-effort prompt
Neutral hook  → Native hook, command, or documented fallback
```

Each adapter must declare supported resource types and lifecycle events. Adapters must never silently discard unsupported resources. They must emit warnings and retain the neutral source.

## Migration

`aiw target <target>` performs a dry-run analysis and reports additions, removals, conflicts, and malformed or unsupported neutral resources. Migration keeps the neutral source, renders the destination target, updates `.aiw/ownership.yml` and the active target in `.aiw/manifest.yml`, and removes obsolete target files only when the ownership inventory proves AIW created them and their bytes still match the recorded digest. Modified or unowned files are preserved and block migration when they occupy a required destination or obsolete owned path.

Before applying changes, migration writes `.aiw/checkpoints/migration-backup.yml` with exact prior bytes and expected post-migration bytes for every changed path. A failed mutation restores those bytes and the previous ownership inventory and active target. `aiw rollback` restores only files that still match the recorded post-migration state, preserving and reporting user edits while safely rolling back untouched paths. The checkpoint remains for unresolved conflicts and is removed when rollback completes or AIW is uninstalled. Older installations without ownership records cannot safely clean up legacy target files; migrate only after reviewing the dry-run and resolving any reported conflicts.

# Adapter Model

Adapters translate the neutral resource model into a target agent's conventions.

```text
Neutral skill → Codex SKILL.md
Neutral rule  → Cursor .mdc / Claude instruction / AGENTS.md
Neutral agent → Target agent declaration or best-effort prompt
Neutral hook  → Native hook, command, or documented fallback
```

Each adapter must declare supported resource types and lifecycle events. Adapters must never silently discard unsupported resources. They must emit warnings and retain the neutral source.

## Target path matrix

| Target        | Alias | Skills                                           | Rules                                                | Agents                                          | Context                                          |
| ------------- | ----- | ------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `codex`       | —     | `.agents/skills/<id>/SKILL.md` (native)          | `.agents/rules/<id>/<id>.md` (compat)                | `.agents/agents/<id>/<id>.md` (compat)          | `AGENTS.md` (native)                             |
| `claude`      | —     | `.claude/skills/<id>/SKILL.md` (native)          | `.claude/rules/<id>.md` (native)                     | `.claude/agents/<id>.md` (native)               | `CLAUDE.md` (native)                             |
| `cursor`      | —     | `.cursor/skills/<id>/SKILL.md` (compat)          | `.cursor/rules/<id>.mdc` (native)                    | `.cursor/aiw/agents/<id>.md` (compat)           | `AGENTS.md` (native)                             |
| `gemini`      | —     | `.gemini/skills/<id>/SKILL.md` (native)          | `.gemini/aiw/rules/<id>.md` (compat)                 | `.gemini/agents/<id>.md` (native)               | `GEMINI.md` (native)                             |
| `antigravity` | `agy` | `.agents/skills/<id>/SKILL.md` (native)          | `.agents/rules/<id>.md` (native)                     | `.agents/agents/<id>.md` (compat)               | `GEMINI.md` (native)                             |
| `copilot`     | —     | `.github/skills/<id>/SKILL.md` (native)          | `.github/instructions/<id>.instructions.md` (native) | `.github/agents/<id>.md` (native)               | `.github/copilot-instructions.md` (native)       |
| `universal`   | —     | `.aiw/resources/skills/<id>/SKILL.md` (fallback) | `.aiw/resources/rules/<id>/<id>.md` (fallback)       | `.aiw/resources/agents/<id>/<id>.md` (fallback) | `.aiw/resources/context/<id>/<id>.md` (fallback) |

## Migration

`aiw target <target>` performs a dry-run analysis and reports additions, removals, conflicts, and malformed or unsupported neutral resources. Migration keeps the neutral source, renders the destination target, updates `.aiw/ownership.yml` and the active target in `.aiw/manifest.yml`, and removes obsolete target files only when the ownership inventory proves AIW created them and their bytes still match the recorded digest. Modified or unowned files are preserved and block migration when they occupy a required destination or obsolete owned path.

Before applying changes, migration writes `.aiw/checkpoints/migration-backup.yml` with exact prior bytes and expected post-migration bytes for every changed path. A failed mutation restores those bytes and the previous ownership inventory and active target. `aiw rollback` restores only files that still match the recorded post-migration state, preserving and reporting user edits while safely rolling back untouched paths. The checkpoint remains for unresolved conflicts and is removed when rollback completes or AIW is uninstalled. Older installations without ownership records cannot safely clean up legacy target files; migrate only after reviewing the dry-run and resolving any reported conflicts.

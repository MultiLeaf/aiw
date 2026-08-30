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

`aiw target <target>` performs a dry-run analysis, reports additions, removals, conflicts, fallbacks, and unsupported features, then renders the new target after confirmation. User-modified generated files require explicit conflict handling.

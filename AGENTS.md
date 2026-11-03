# AI Workflow Project Context

This repository is managed by AI Workflow (`.aiw/` holds the neutral project state).

- Languages: javascript, typescript
- Frameworks: none detected
- Package manager: npm
- Lint: `eslint .`
- Format: `prettier --write "src/**/*.{ts,js}" "docs/**/*.md" "*.{json,js}"`
- Tests (project): `vitest run`

Before completing changes, run the project quality commands listed above. Follow installed AI Workflow skills, rules, and agents; the confirmed profile lives in `.aiw/profile.yml` and workflow evidence in `.aiw/checkpoints/`.

## Context recovery (managed by AI Workflow)

After any context compaction, reset, resume, or handoff: run `aiw task status`, read the stage artifacts this workflow declares under `.aiw/generated/`, and do not rely on compacted chat as the source of project state.

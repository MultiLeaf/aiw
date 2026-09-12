# Product Requirements

## Functional requirements

### Installation

- The CLI must install with `npx @multileaf/ai-workflow install`.
- Initial installation must add only the target-specific `ai-init` bootstrap and neutral state; optional skills, rules, agents, hooks, and templates must not be activated before project analysis and user selection.
- Installation must support Codex, Claude Code, Cursor, Gemini CLI, GitHub Copilot, and a universal target over time.
- Installation must be idempotent and preserve user overrides.
- Installation must create a neutral `.aiw/` source of truth.
- Generated specifications, plans, docs, and artifacts must live under `.aiw/generated/` and be ignored by Git.
- Checkpoints must live under `.aiw/checkpoints/` and remain versioned.

### Initialization

- `/ai-init` must scan a repository safely.
- The scanner must identify languages, frameworks, package managers, commands, tests, linters, formatters, CI, and project structure.
- The analysis pipeline must combine deterministic detectors with a scoped AI interpreter.
- Facts and inferences must be stored separately with evidence, confidence, method, and confirmation state.
- The interpreter must receive filtered context and exclude secrets, dependencies, generated files, Git internals, and checkpoints by default.
- Recommendations must explain their evidence, capabilities, permissions, and conflicts.
- The user must select which capabilities to install.
- Selected resources must be customized using confirmed project facts.
- `/ai-init` must orchestrate scan → recommendations → user selection → selected-resource sync and summarize what it added.
- The bootstrap must invoke CLI operations through the package runner; it cannot assume `aiw` is installed globally or in the consuming project's dependencies.
- The complete onboarding behavior and acceptance criteria are defined in [`ai-init-workflow-spec.md`](./ai-init-workflow-spec.md).

### Development workflow

- The product must support brainstorming, specification, design, planning, implementation, and verification stages.
- Requirements, decisions, tasks, code changes, tests, and evidence must be traceable.
- A task must not be considered complete without configured validation evidence.

### Portability

- `aiw target <target>` must migrate generated resources to another target.
- Unsupported features must be reported and preserved in neutral form.
- Migration must support dry-run, conflict detection, backups, and rollback.

### Governance

- Packages must declare versions, dependencies, permissions, supported targets, and provenance.
- Generated files must be distinguishable from user-owned files.
- Lockfiles must make installations reproducible.

### Local dashboard

- `aiw ui` must expose project profile, recommendations, traceability, and target migration from a loopback-only web interface.
- The dashboard must render project data safely without external assets, third-party scripts, telemetry, or a separate source of truth.
- Target migration must require explicit confirmation and use the same workflow service as the CLI.
- Read-only dashboard requests must not mutate project state.

## Non-functional requirements

- TypeScript code must pass formatting, linting, type checking, and tests.
- Core services must be independently unit-testable.
- Scanner access must exclude secrets and ignored paths by default.
- The runtime must provide useful behavior when an adapter has reduced capabilities.
- Token budgets and context usage must be observable.
- Changes must be validated against the AI Workflow repository itself when the relevant capability exists.

# AI Workflow

AI Workflow is a portable, spec-driven development system for AI coding agents. It gives a repository a repeatable path from discovery and brainstorming to requirements, implementation plans, code, and verification evidence without coupling the project to one AI provider.

It can configure Codex, Claude Code, Cursor, Gemini CLI, GitHub Copilot, or a provider-neutral layout from the same canonical project state.

## Why AI Workflow

AI-assisted development often relies on implicit prompts, duplicated configuration, and tool-specific files that drift over time. AI Workflow makes that process explicit and reviewable:

- project facts are detected before recommendations are made;
- inferred conventions require confirmation before they drive generation;
- specifications and decisions remain the source of truth;
- skills, rules, agents, hooks, and templates are versioned resources;
- target-specific files are generated through adapters;
- quality gates and checkpoints provide completion evidence;
- context is filtered and loaded only when needed to reduce token usage;
- sensitive or networked capabilities require explicit permission.

## Installation

Requirements: Node.js 18 or newer.

```bash
npx @multileaf/ai-workflow install --target codex
```

Supported targets are `codex`, `claude`, `cursor`, `gemini`, `copilot`, and `universal`. Every command uses the same entry point:

```bash
npx @multileaf/ai-workflow <command> <options>
```

The initial installation creates the neutral workflow state and the target-specific `ai-init` skill. Existing project files and user edits are preserved.

## What gets created

For a Codex installation, the base layout is:

```text
.agents/
└── skills/
    └── ai-init/
        └── SKILL.md
.context/
└── adrs/
    └── INDEX.md
.aiw/
├── checkpoints/
├── generated/
│   ├── artifacts/
│   ├── docs/
│   ├── plans/
│   ├── rules/
│   └── specs/
├── lock.yml
├── manifest.yml
└── profile.yml
```

`.aiw/` is the provider-neutral source of truth. Adapter outputs such as `.claude/skills`, `.cursor/rules`, or `.github/copilot-instructions.md` are derived from it. Generated working artifacts live under `.aiw/generated/` and are ignored by default; versioned checkpoints remain reviewable project history.

## The SDD workflow

AI Workflow supports an end-to-end specification-driven development cycle:

```text
Scan → Recommend → Brainstorm → Specify → Decide → Plan → Implement → Verify → Trace
```

```bash
# Detect the repository stack, tools, scripts, and conventions.
npx @multileaf/ai-workflow scan

# Review recommended skills, rules, agents, hooks, and templates.
npx @multileaf/ai-workflow recommend

# Create structured product artifacts.
npx @multileaf/ai-workflow brainstorm --title="Feature name"
npx @multileaf/ai-workflow spec --title="Feature requirements"
npx @multileaf/ai-workflow adr --id=ADR-001 --title="Technical decision"
npx @multileaf/ai-workflow plan --title="Implementation plan"

# Enforce stage completeness and generate evidence.
npx @multileaf/ai-workflow gate specification
npx @multileaf/ai-workflow verify
npx @multileaf/ai-workflow trace
```

Requirements use stable identifiers and Given/When/Then acceptance criteria. Plans link tasks to requirements, tests, risks, dependencies, and expected evidence. Traceability connects requirements, decisions, tasks, code, tests, and validation output.

## Project intelligence

Analysis uses two complementary layers:

1. Deterministic detectors identify observable facts such as languages, package managers, workspaces, frameworks, scripts, tests, linters, CI, and configuration files.
2. An optional provider-neutral AI interpreter examines a filtered context to suggest architecture conventions and capabilities.

Detected facts cannot be replaced by conflicting AI output. Inferred facts remain unconfirmed until the user accepts, rejects, or edits them. Secrets, binaries, dependencies, Git internals, generated output, and checkpoints are excluded from AI context by default.

## Resource packages and recommendations

Resources are distributed as versioned packages that may contain:

- skills for repeatable workflows;
- rules for project and organization policy;
- specialist agent definitions;
- lifecycle hooks;
- artifact templates;
- dependencies, permissions, target support, and provenance metadata.

```bash
npx @multileaf/ai-workflow registry
npx @multileaf/ai-workflow skills search --query=react
npx @multileaf/ai-workflow audit-package --package=resources/package.yaml
npx @multileaf/ai-workflow resolve --package=resources/package.yaml
```

The registry can combine local packages, private registries, and Vercel Skills metadata. Package locks preserve exact provider, version, integrity, source, and permission information.

## Switching AI targets

The neutral state can be rendered for another supported agent:

```bash
npx @multileaf/ai-workflow target claude --dry-run
npx @multileaf/ai-workflow target claude
```

Migration performs conflict detection before writing, creates a rollback checkpoint, removes obsolete source-target artifacts, and preserves unrelated files. If needed:

```bash
npx @multileaf/ai-workflow rollback
```

Use `capabilities --target=<target>` to inspect which resource types and lifecycle events an adapter supports natively or through compatibility files.

## Health, recovery, and visibility

```bash
npx @multileaf/ai-workflow status
npx @multileaf/ai-workflow doctor
npx @multileaf/ai-workflow repair
npx @multileaf/ai-workflow ui
```

The local dashboard binds only to `127.0.0.1`, reads project state from `.aiw/`, and requires the exact `MIGRATE` confirmation before changing targets. `doctor` diagnoses invalid or missing state, while `repair` recreates required AI Workflow structures without replacing user content.

## Multi-agent orchestration

AI Workflow can preview and execute a strict, versioned task graph:

```bash
npx @multileaf/ai-workflow orchestrate --plan=orchestration.yml
npx @multileaf/ai-workflow orchestrate --plan=orchestration.yml --execute --max-parallel=4
```

Preview is deterministic and read-only. Execution is opt-in and requires a host-provided agent adapter. Dependencies, bounded concurrency, failure propagation, replay protection, and checkpoint evidence are handled by the orchestration domain. The typed contract is exported from `@multileaf/ai-workflow/orchestration`.

## Plugins and SDK

Create portable extensions without coupling them to the CLI implementation:

```bash
npx @multileaf/ai-workflow plugin create \
  --directory=plugins/plugin-name \
  --id=owner/plugin-name \
  --version=1.0.0 \
  --description="Provide a portable workflow."
npx @multileaf/ai-workflow plugin validate --directory=plugins/plugin-name
```

The typed SDK is available from `@multileaf/ai-workflow/plugin-sdk`. Plugins declare resources and receive a guarded filesystem interface that validates paths and preflights writes before mutation. See [Plugin Authoring](docs/plugin-authoring.md).

## Privacy and security

Telemetry is disabled by default and requires explicit consent. It records only approved aggregate fields through an injectable transport.

```bash
npx @multileaf/ai-workflow telemetry status
npx @multileaf/ai-workflow telemetry enable
npx @multileaf/ai-workflow telemetry disable
```

Package sources, network access, filesystem permissions, and organization policy are validated before side effects. Published releases include npm registry signatures and SLSA provenance. See [Security and Trust](docs/security.md) and [Telemetry and Privacy](docs/telemetry.md).

## Developing this repository

This project uses itself to validate its own workflow. Product changes follow TDD, pass the complete quality pipeline, run against this repository, and produce ticket-specific checkpoint evidence.

```bash
npm ci
npm run check
node dist/cli.js self-validate --ticket=TYPE-000
```

Release candidates additionally require:

```bash
npm run release:check
```

## Documentation

- [Documentation index](docs/README.md)
- [Product vision](docs/product-vision.md)
- [Product requirements](docs/product-requirements.md)
- [Architecture](docs/architecture.md)
- [Project intelligence](docs/project-intelligence.md)
- [Package and resource model](docs/package-model.md)
- [Adapter model](docs/adapter-model.md)
- [Quality and testing](docs/quality.md)
- [Token efficiency](docs/token-efficiency.md)
- [Multi-agent orchestration](docs/orchestration.md)
- [Release process](docs/release-process.md)

## License

[MIT](LICENSE) © 2026 MultiLeaf

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
- package-declared sensitive capabilities are evaluated by policy boundaries.

## Installation

The published package declares Node.js 18 or newer. Development uses Node.js 24 because the current lint toolchain requires a newer runtime; the oldest declared runtime is not part of this repository's release validation matrix yet.

```bash
npx @multileaf/ai-workflow install --target codex
```

Supported targets are `codex`, `claude`, `cursor`, `gemini`, `copilot`, and `universal`. Every command uses the same entry point:

```bash
npx @multileaf/ai-workflow <command> <options>
```

The initial installation creates workflow state and a target-specific `ai-init` skill. Run it in a repository that does not already use the reserved paths shown below: first installation currently writes the base ADR index and target `ai-init` file at those paths. Reinstallation detects existing AI Workflow state and preserves it.

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
├── context/
├── generated/
│   ├── artifacts/
│   ├── docs/
│   ├── plans/
│   └── specs/
├── lock.yml
├── manifest.yml
└── profile.yml
```

`.aiw/` stores the provider-neutral manifest, profile, lockfile, checkpoints, and generated working artifacts. ADRs are stored under `.context/adrs/`. The initial `ai-init` resource is rendered directly to the selected target; installed neutral package resources can be rendered through adapters to paths such as `.claude/skills`, `.cursor/rules`, or `.github/copilot-instructions.md`.

The installer does not modify `.gitignore`. Add `.aiw/generated/` yourself if generated specifications, plans, and artifacts should remain local. Versioned files under `.aiw/checkpoints/` are designed to remain reviewable project history.

## The SDD workflow

AI Workflow supports an end-to-end specification-driven development cycle:

```text
Scan → Recommend → Brainstorm → Specify → Decide → Plan → Implement → Verify → Trace
```

```bash
# Detect the repository stack, tools, scripts, and conventions.
npx @multileaf/ai-workflow scan

# Review recommendations interactively in a TTY.
npx @multileaf/ai-workflow recommend

# In CI, provide comma-separated recommendation IDs detected for that project.
npx @multileaf/ai-workflow recommend --select=typescript-quality,vitest-testing

# Create structured product artifacts.
npx @multileaf/ai-workflow brainstorm --title="Feature name"
npx @multileaf/ai-workflow spec --title="Feature requirements"
npx @multileaf/ai-workflow adr --id=001 --title="Technical decision"
npx @multileaf/ai-workflow plan --title="Implementation plan"

# Fill the generated scaffold sections before running their quality gates.
npx @multileaf/ai-workflow gate specification
npx @multileaf/ai-workflow verify
npx @multileaf/ai-workflow trace
```

Scaffold commands write deterministic files at fixed paths and a repeated invocation replaces that scaffold. Complete and review each artifact before advancing. Requirements use stable identifiers and Given/When/Then acceptance criteria. Plans link tasks to requirements, tests, risks, dependencies, and expected evidence. `gate` performs textual completeness checks, `verify` validates the expected verification fields rather than running a test command, and `trace` records declared links between requirements, decisions, tasks, code, tests, and evidence.

## Project intelligence

Analysis uses two complementary layers:

1. Deterministic detectors identify observable facts such as languages, package managers, workspaces, frameworks, scripts, tests, linters, CI, and configuration files.
2. An optional provider-neutral AI interpreter examines a filtered context to suggest architecture conventions and capabilities.

Detected facts cannot be replaced by conflicting AI output. Inferred facts remain unconfirmed until the user accepts, rejects, or edits them. Context selection excludes known sensitive filenames, binaries, dependencies, Git internals, generated output, and checkpoints, then applies pattern-based redaction. This is a defense-in-depth filter, not a general secret scanner; review eligible text before enabling an external AI provider.

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
npx @multileaf/ai-workflow audit-package \
  --package=node_modules/@multileaf/ai-workflow/resources/package.yaml
npx @multileaf/ai-workflow resolve \
  --package=node_modules/@multileaf/ai-workflow/resources/package.yaml
```

The registry can combine local packages, configured private registries, and Vercel Skills metadata. Vercel operations invoke the external `npx skills` CLI and therefore require network access outside AI Workflow's package-permission gate. Lock entries record the provider, reported version, source, permissions, and available integrity metadata. Local entries may use a synthetic identity value, while an upstream provider may report `latest` or unknown integrity.

## Switching AI targets

The neutral state can be rendered for another supported agent:

```bash
npx @multileaf/ai-workflow target claude --dry-run
npx @multileaf/ai-workflow target claude
```

Migration provides a deterministic dry-run, writes a rollback checkpoint, and handles the active `ai-init` transition. Neutral package resources are rendered to the destination adapter. Review the dry-run and back up custom target files first: conflict detection and cleanup do not yet cover every custom destination or every obsolete compatibility file. If needed:

```bash
npx @multileaf/ai-workflow rollback
```

Use `capabilities --target=<target>` to inspect aggregate supported resource types, lifecycle events, and whether the target uses fallback compatibility. See [Adapter Model](docs/adapter-model.md) for the native and compatibility path matrix.

## Health, recovery, and visibility

```bash
npx @multileaf/ai-workflow status
npx @multileaf/ai-workflow doctor
npx @multileaf/ai-workflow repair
npx @multileaf/ai-workflow ui
```

The local dashboard binds only to `127.0.0.1`, reads project state from `.aiw/`, and requires the exact `MIGRATE` confirmation before changing targets. `doctor` checks the required installation structure, manifest schema, and active target. `repair` recreates a defined subset of required directories and files; it does not repair arbitrary malformed profile or lock content, and a missing profile may still require reinstallation or regeneration.

## Multi-agent orchestration

AI Workflow can preview and execute a strict, versioned task graph:

Create `orchestration.yml` using the schema in [Multi-agent Orchestration](docs/orchestration.md), then preview it:

```bash
npx @multileaf/ai-workflow orchestrate --plan=orchestration.yml
npx @multileaf/ai-workflow orchestrate --plan=orchestration.yml --execute --max-parallel=4
```

Preview is deterministic and read-only. Execution is opt-in and requires an application host to inject an `AgentOrchestrator`; the standalone CLI does not configure one, so its `--execute` form fails clearly until integrated by a host. Dependencies, bounded concurrency, failure propagation, replay protection, and checkpoint evidence are handled by the orchestration domain. The typed contract is exported from `@multileaf/ai-workflow/orchestration`.

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

The typed SDK is available from `@multileaf/ai-workflow/plugin-sdk`. It exports scaffold and validation helpers that accept an injected filesystem boundary. Those helpers validate project-relative paths and preflight scaffold conflicts; AI Workflow does not currently host arbitrary plugin runtime code or inject a filesystem into executing plugins. See [Plugin Authoring](docs/plugin-authoring.md).

## Privacy and security

Telemetry is disabled by default and requires explicit consent. It records only approved aggregate fields through an injectable transport.

```bash
npx @multileaf/ai-workflow telemetry status
npx @multileaf/ai-workflow telemetry enable
npx @multileaf/ai-workflow telemetry disable
```

Package contracts, declared permissions, and organization policy are validated at documented workflow boundaries, but not every external subprocess is covered by one global preflight. In particular, Vercel Skills delegates to `npx skills`, and Git sources may be checked out before their package manifest can be inspected. Treat third-party sources as untrusted and review dry-runs and package audits. Published npm releases include registry signatures and SLSA provenance that consumers can verify with `npm audit signatures`. See [Security and Trust](docs/security.md) and [Telemetry and Privacy](docs/telemetry.md).

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

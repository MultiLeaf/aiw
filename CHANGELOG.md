# Changelog

All notable changes to this project are documented in this file. The format follows Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

## [0.1.3] - 2026-09-12

### Fixed

- Invoke AI Workflow through `npx` in the generated `ai-init` instructions so fresh projects do not need a globally installed `aiw` binary.

## [0.1.2] - 2026-09-12

### Fixed

- Keep first install limited to the `ai-init` bootstrap and neutral AI Workflow state; install optional capabilities only after the project scan and explicit user selection.
- Materialize only selected skills, rules, agents, hooks, and templates, and personalize supported rules with detected project commands.
- Allow non-interactive recommendation previews without silently selecting or installing capabilities.

## [0.1.1] - 2026-09-12

### Fixed

- Activate the complete bundled workflow package during installation instead of installing only `ai-init`.
- Preserve user edits during migration rollback and remove migration checkpoints during uninstall.
- Match Git ignore rules consistently when scanning projects.

### Security

- Validate package manifests and resource paths, verify local package integrity, and redact credentials from scanned context.
- Track installed-file ownership so uninstall and migration only remove unchanged AI Workflow files.
- Require organization approval and explicit consent before loading remote package sources.

### Changed

- Update runtime and development dependencies and expand install, migration, rollback, and security coverage.

## [0.1.0] - 2026-09-04

### Added

- Portable installation and migration across Codex, Claude Code, Cursor, Gemini CLI, GitHub Copilot, and a universal target.
- Hybrid deterministic and AI-assisted project scanning, recommendations, personalization, and confirmation workflows.
- Spec-driven brainstorming, requirements, decisions, implementation planning, verification, quality gates, and traceability.
- Versioned packages, registries, Vercel Skills integration, policy enforcement, integrity verification, and update workflows.
- Layered context, token budgets, opt-in telemetry, plugin SDK, local dashboard, and provider-neutral multi-agent orchestration.

### Security

- Path confinement, symlink protection, explicit permission gates, secret redaction, strict parsers, atomic migrations, and immutable execution checkpoints.

[Unreleased]: https://github.com/MultiLeaf/aiw/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/MultiLeaf/aiw/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/MultiLeaf/aiw/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/MultiLeaf/aiw/releases/tag/v0.1.1
[0.1.0]: https://github.com/MultiLeaf/aiw/releases/tag/v0.1.0

# Changelog

All notable changes to this project are documented in this file. The format follows Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

## [0.8.0] - 2026-10-20

### Added

- Standing-context benchmark: `aiw context-bench` measures the persistent context AI Workflow renders into every agent session (root context file, neutral resources under `.aiw/resources/`, `.aiw/context/` layers) per category, offline and deterministically. Byte and file counts are measured; tokens are estimated (characters/4) and labeled as such; a content hash pins the fixture and the report contains no timestamps. `--save` records a checkpoint under `.aiw/checkpoints/` and `--baseline=<path>` exits nonzero on any token regression, giving context changes a cost gate.
- Task parity suite: `aiw parity [--tasks=directory]` runs YAML parity tasks (`.aiw/parity/` by default) that pin quality constraints on context assembly. Each task compares the full composed context against the just-in-time task-retrieval assembler and fails, naming the exact fact, when a critical fact or completion marker does not survive retrieval. Exit nonzero on any failure makes it a CI gate for context changes; estimated token cost is reported but never gates here. Inter-stage tasks load real artifacts via `sources` (project-relative paths into any layer) and enforce `required_patterns` — every extracted identifier (e.g. `REQ-\d+` from the approved specification) must survive assembly, guarding the identifiers traceability links depend on.
- Usage sidecar: `aiw usage-sidecar record/report` maintains a versioned ledger at `.aiw/checkpoints/usage-sidecar.yml` with per-run tokens split into billing tiers (cache-read, fresh-input, cache-write, output), a `measured`/`estimated` label that propagates pessimistically to aggregates, and attribution by model and harness (with version). The report exposes `cache_hit_rate` (cache-read over billable input); dollar conversion is intentionally left out. `aiw scan` auto-records interpreter and embedding usage into the ledger with their real measurement label.
- Cost attribution: `aiw cost-report` joins the usage sidecar with the traceability graph (`aiw trace`) to report tokens per verified requirement — the outcome-denominated cost metric — with attributed and unattributed tokens shown side by side. Sidecar entries accept `--requirement=REQ-###`, and `parseTraceabilityGraph` round-trips the serialized graph.
- Model routing table: `aiw routing init|show|resolve --category=name` maintains a static, evidence-linked table at `.aiw/routing.yml`. Rules map task categories to models deterministically; each rule names its evidence, and the resolver reports its advisory level (`evidenced`, `unevidenced-rule`, `default-fallback`, `default-unset`). Routing is advisory only and never invokes a model.
- Task-lifecycle token usage: `aiw task-usage [--workflow=id-or-ticket]` aggregates sidecar entries correlated by `--workflow` into one task's totals — input tokens (all billing tiers), output tokens, cache hit rate, per-stage breakdown with models, requirements touched, and harness attribution. Tokens are the model-invariant metric, so lifecycle totals stay comparable across model routing changes; `usage-sidecar record` accepts `--workflow` for correlation.

## [0.7.0] - 2026-10-13

### Added

- Ticket-driven task entry point: `aiw task start --ticket=TEAM-123 [--title=text]` starts an SDD session that records the ticket, and `aiw task status` reports the ticket, stage statuses, and the next pending step with ticket-aware guidance. `aiw spec --ticket=TEAM-123` links the specification scaffold to the ticket. A new `ticket` skill (recommended as the `ticket-driven-development` capability) drives the flow in the host agent, keeping the brainstorming skip an explicit human decision.
- `aiw telemetry show` summarizes buffered events by command and outcome (fill level against the retention cap, per-command success/failure counts); `--verbose` adds each event verbatim. `telemetry status` keeps reporting configuration only.
- Per-model token usage: `usage.yml` records carry model attribution (`stage|budget|used|model`; legacy three-column rows still parse) and `aiw token-usage` summarizes total consumption by model. The OpenAI-compatible provider reports the response usage block, so interpreter usage is measured (marked `(measured)`) when the endpoint provides it and estimated otherwise; `scan.embedding`, `scan.interpreter`, and `recommend.decision` all record their model.

## [0.6.1] - 2026-10-13

### Added

- Root context rendering: syncing a non-empty resource selection now writes the generated project context to the active target's root file (`AGENTS.md` for Codex/Cursor, `CLAUDE.md` for Claude Code, `GEMINI.md` for Gemini CLI), and `aiw target` migrates it between targets. The file is owned by AI Workflow, listed in the sync preview, and an existing hand-written root context is reported as a conflict instead of being overwritten.
- Decision-model usage in `aiw recommend` is now recorded in `.aiw/usage.yml` (`recommend.decision`) alongside the scan stages.

### Changed

- Release workflows require a single protected-environment approval: the `github-release` job no longer declares the `npm` environment it did not need.

### Added

- Root context rendering: syncing a non-empty resource selection now writes the generated project context to the active target's root file (`AGENTS.md` for Codex/Cursor, `CLAUDE.md` for Claude Code, `GEMINI.md` for Gemini CLI), and `aiw target` migrates it between targets. The file is owned by AI Workflow, listed in the sync preview, and an existing hand-written root context is reported as a conflict instead of being overwritten.

## [0.6.0] - 2026-10-13

### Added

- Guided provider onboarding during interactive `aiw install`: each capability (semantic embedding, then decision triage) asks whether to configure it, offers Ollama or an external OpenAI-compatible provider (external only when Ollama is unreachable), lists the locally available models (embedding-only filtering for semantic), asks permission to run `ollama pull embeddinggemma-2` when no embedding models exist, collects endpoint URL, model name, and an optional token environment variable for external providers, and validates the setup with a live request before saving — with retry or skip on failure.
- External provider support: `semantic` and `decision` settings accept `apiKeyEnv` (an uppercase environment variable name); the token is read from the environment at call time and never stored. Semantic requests go to `<baseUrl>/v1/embeddings` with bearer authentication and decision requests send `Authorization` headers.
- Model usage reporting: every `aiw scan` states which models were actually used — embedding (chunks indexed or retrieval queries, batch request count, estimated tokens) and interpreter (model, facts inferred, scoped files, estimated tokens) — or reports `Models used: none (deterministic scan).`
- Per-stage token estimates recorded in `.aiw/usage.yml` (`scan.embedding`, `scan.interpreter`) and inspectable with `aiw token-usage`. Token counts are local project state; telemetry never carries them.

### Fixed

- Interactive onboarding messages shortened to single-line prompts.
- Embedding-model classification during onboarding now requires positive evidence (model name contains "embed" or Ollama family "embedding"); the previous heuristic misclassified `gpt-oss:20b` as an embedding model.

## [0.5.0] - 2026-10-08

### Added

- Batched semantic indexing: embedding requests now use the Ollama batch endpoint (`POST /api/embed`) with up to 64 chunks per request instead of one request per chunk, and lockfiles and generated vendor manifests (`package-lock.json`, `yarn.lock`, `go.sum`, and others) are excluded from the index by default (`semantic.excludeLockfiles` overrides).
- Optional decision-model re-ranking for `aiw semantic query --rerank`: when a decision model is enabled, each retrieved candidate is scored 0-1 for query relevance and the output is reordered with a reported ranking influence; cosine recall without a decision model is unchanged.
- Semantic interpreter scoping during `aiw scan`: when semantic mapping is enabled and an index exists, the AI interpreter receives deterministic key files plus the top semantically relevant files for a profile-derived query instead of the alphabetically ordered file list, reducing token usage.
- Built-in OpenAI-compatible `AiProvider` configured through an `ai` section in `.aiw/settings.yml` (for example Ollama `gpt-oss:20b`), so the scoped interpreter works without a host-injected provider; secrets redaction, token ceilings, and scoped-context validation apply unchanged, and missing configuration keeps scans deterministic and offline.
- Advisory decision-model ranking for `aiw recommend`: when a decision model is enabled, recommendations are ordered by relevance to the confirmed profile and serialized with `decision_relevance` / `decision_confidence`; evidence states never change.
- Telemetry consent during interactive `aiw install`, asked after the optional model questions with an explicit default of No, stating the exact event payload (command name and outcome only); the decision is recorded in `.aiw/settings.yml` and reversible through `aiw telemetry enable/disable`. Non-interactive installs skip the prompt.
- Local telemetry buffer: when telemetry is enabled and no host client is present, events accumulate in a rotated `.aiw/telemetry-buffer.jsonl` (retention cap of 200 events); `aiw telemetry status --verbose` displays buffered events and `aiw telemetry disable` purges the buffer. No network transport was added.
- Local model detection during interactive install: the installer probes the configured Ollama endpoint (`/api/tags`), lists the embedding and decision models actually available, and records the user's selection in `.aiw/settings.yml`; when no server or models are found it continues with defaults.

### Changed

- GitHub Actions now use Node 24-native `actions/checkout@v5` and `actions/setup-node@v5`, and CI runs on Node 24.

## [0.4.1] - 2026-10-08

### Fixed

- Approving an SDD stage that never passed its quality gate now reports an actionable `Run aiw gate <stage> before approving` error instead of a misleading stale-approval message.
- `aiw semantic status` and `aiw decision status` now point to the `.aiw/settings.yml` sections instead of the legacy standalone files.

## [0.4.0] - 2026-10-08

### Changed

- Unified user-local settings into a single `.aiw/settings.yml` with `semantic`, `decision`, `telemetry`, and `overrides` sections. The file is local user state, not committed project state. Interactive onboarding and the `telemetry`/`confirm` commands write to it, and legacy `.aiw/semantic.yml`, `.aiw/decision.yml`, `.aiw/telemetry.yml`, and `.aiw/overrides.yml` files are still read for backward compatibility. `uninstall` removes `settings.yml` and all four legacy files.

## [0.3.1] - 2026-10-08

### Added

- Interactive optional-model onboarding during `aiw install`: in an interactive terminal, the installer asks whether to enable semantic mapping and advisory decision triage and writes `.aiw/semantic.yml` / `.aiw/decision.yml` with defaults before `/ai-init` runs. Non-interactive installs skip the prompts, and existing configuration files are never overwritten.

## [0.3.0] - 2026-10-08

### Added

- Optional semantic mapping in `aiw scan`: when `.aiw/semantic.yml` enables a local embedding model (for example Ollama `embeddinggemma-2`), the scan verifies model availability, embeds line-aligned file chunks, and writes a versioned index to `.aiw/semantic/index.json`.
- `aiw semantic query` and `aiw semantic status` commands for cosine-similarity retrieval over the semantic index, gated by the same configuration flag.
- Advisory decision triage via a local decision model (`jev/clef-flash` through Ollama `/v1/systemone`): flag-gated by `.aiw/decision.yml`, `aiw decision status` and `aiw decision triage --artifact=<path>` return advisory evidence-completeness and gate decisions with confidence, never replacing human approval.
- Documentation for semantic mapping and an evaluation of the `jev/clef` decision model for advisory flow decisions.

### Fixed

- Removed high-severity transitive vulnerabilities (`brace-expansion`, `source-map-js`) reported by `npm audit`.

## [0.2.1] - 2026-09-13

### Changed

- Require host-native blocking question widgets for onboarding decisions and every SDD approval gate when available, with explicit unselected choices and a safe chat fallback.
- Clarify that the CLI persists approval state but cannot prove that a host widget was used or verify respondent identity.

## [0.2.0] - 2026-09-13

### Added

- Persisted human approval gates for every SDD stage, with explicit optional-stage skips and invalidation when reviewed evidence changes.
- Reviewable, fingerprint-bound installation previews with conflict detection and rollback on failed syncs.
- Reusable implementation evidence and code review templates, plus completeness checks for every workflow stage.

### Changed

- Require an active workflow, ordered stage evidence, a passing quality gate, and explicit human approval before advancing SDD work.
- Align generated bootstrap and stage skills with the enforced approval and installation flows.

## [0.1.5] - 2026-09-12

### Fixed

- Connect SDD capability recommendations through explicit prerequisites so custom selections include required earlier workflow stages.
- Recommend verification for supported project profiles and test runners, including test commands discovered in monorepo workspaces.
- Align brainstorming, specification, planning, and verification gates with their matching artifacts; remove references to a nonexistent review gate command.
- Clarify skill handoffs across brainstorming, requirements, design, planning, implementation, verification, and code review.
- Correct the project profile path referenced by the project initialization skill.

## [0.1.4] - 2026-09-12

### Added

- Guided `/ai-init` onboarding with model-cost guidance, parallel project analysis, monorepo-aware profiles, selectable resource blocks, and project-specific resource personalization.
- NestJS, Prisma, and Vite capability recommendations with matching skills, agents, and data-access guidance.

### Changed

- Allow recommendation selection by individual resource, including an explicit select-all option.
- Expand project profiles with workspace-level technologies, quality tools, test runners, architecture, patterns, and evidence.

### Documentation

- Specify onboarding flow, host capabilities, MCP recommendations, safety expectations, and acceptance criteria.

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

[Unreleased]: https://github.com/MultiLeaf/aiw/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/MultiLeaf/aiw/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/MultiLeaf/aiw/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/MultiLeaf/aiw/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/MultiLeaf/aiw/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/MultiLeaf/aiw/releases/tag/v0.1.1
[0.1.0]: https://github.com/MultiLeaf/aiw/releases/tag/v0.1.0

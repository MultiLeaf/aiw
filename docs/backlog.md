# Product Backlog

Priority levels: **P0** blocks the product or makes it unsafe; **P1** is required for a usable product; **P2** improves scale, quality, or portability; **P3** is an advanced or ecosystem feature.

## Foundation — P0

- [x] **FND-001** Define and validate the neutral `manifest.yaml` schema. _Acceptance:_ invalid manifests produce actionable errors; schema is versioned and tested.
- [x] **FND-002** Define `package.yaml` and resource contracts. _Acceptance:_ skills, rules, agents, hooks, templates, policies, dependencies, permissions, and provenance are representable.
- [x] **FND-003** Define adapter contract and capability matrix. _Acceptance:_ adapters report supported resources and lifecycle events.
- [x] **FND-004** Introduce structured domain types and service interfaces. _Acceptance:_ CLI contains no business logic; services are dependency-injected and unit-testable.
- [x] **FND-005** Add complete TDD quality pipeline. _Acceptance:_ `check` runs format, lint, typecheck, tests, and security checks.
- [x] **FND-006** Add CI workflow. _Acceptance:_ every pull request runs all required checks.

## Installation and lifecycle — P0/P1

- [x] **INS-001** Make installation idempotent and non-destructive. _Acceptance:_ repeated installation preserves overrides and reports state.
- [x] **INS-002** Implement target selection and detection. _Acceptance:_ supported installed agents are detected and user can override detection.
- [x] **INS-003** Install and register the base `ai-init` skill. _Acceptance:_ generated artifact is valid for every supported target.
- [x] **INS-004** Implement `status`, `doctor`, and actionable diagnostics. _Acceptance:_ missing, stale, conflicting, and unsupported state is explained.
- [x] **INS-005** Implement package resolution and lockfile generation. _Acceptance:_ same lockfile produces the same resources.
- [x] **INS-006** Implement uninstall and repair safely. _Acceptance:_ an install-time path/content-hash inventory proves ownership; uninstall removes unchanged resources, preserves and reports modified or unsafe paths, and its dry-run is read-only.

## Project intelligence — P1

- [x] **SCAN-001** Build ignore-aware repository scanner. _Acceptance:_ matches Git ignore behavior for root and nested `.gitignore` rules, including anchoring, globstar, escaping, directory rules, and negation; mandatory sensitive-file exclusions cannot be negated; output is deterministic.
- [x] **SCAN-002** Detect languages, frameworks, package managers, scripts, tests, linters, formatters, CI, and workspace structure. _Acceptance:_ fixtures cover common project types.
- [x] **SCAN-003** Store confidence and evidence for detected facts. _Acceptance:_ each inferred fact points to a source and confidence score.
- [x] **SCAN-005** Define the hybrid intelligence contract. _Acceptance:_ detected, inferred, and confirmed states are represented and AI inference cannot silently replace deterministic facts.
- [x] **SCAN-006** Implement scoped AI project interpreter. _Acceptance:_ interpreter receives filtered context and produces structured insights requiring confirmation when uncertain.
- [x] **SCAN-007** Add interpreter privacy and token guardrails. _Acceptance:_ secrets, dependencies, generated files, Git internals, and checkpoints are excluded and token usage is measured.
- [x] **SCAN-004** Add interactive confirmation and overrides. _Acceptance:_ users can accept, reject, or edit inferred facts.
- [ ] **INT-001** Ship a built-in OpenAI-compatible `AiProvider`. _Acceptance:_ an `aiw` settings section configures a local or remote OpenAI-compatible endpoint (for example Ollama `gpt-oss:20b`) so the scoped AI interpreter works without a host-injected provider; secrets redaction, token ceilings, and scoped-context validation still apply; missing configuration keeps scans deterministic and offline.
- [x] **REC-001** Build capability recommendation engine. _Acceptance:_ recommendations include rationale, evidence, permissions, conflicts, and confidence.
- [x] **REC-002** Add interactive capability selection. _Acceptance:_ users select packages and individual resources before installation.
- [ ] **REC-003** Rank capability recommendations with a decision model. _Acceptance:_ when a decision model is enabled in settings, recommendations are ordered by decision-model relevance to the confirmed profile with confidence and rationale; ranking is advisory and never changes evidence states. See `docs/decision-model-evaluation.md`.
- [x] **GEN-001** Generate project-specific rules, agents, hooks, and context. _Acceptance:_ generated content uses confirmed profile data and English artifacts.
- [x] **GEN-002** Preserve manual overrides and detect drift. _Acceptance:_ regeneration never silently overwrites user changes.

## SDD workflow — P1

- [x] **SDD-001** Implement brainstorming artifact and facilitator skill. _Acceptance:_ goals, users, assumptions, constraints, and open questions are captured.
- [x] **SDD-002** Implement specification skill and template. _Acceptance:_ requirements have stable IDs and acceptance criteria.
- [x] **SDD-003** Implement design and architecture decision records. _Acceptance:_ alternatives, decisions, and rationale are linked.
- [x] **SDD-004** Implement implementation planning. _Acceptance:_ tasks link to requirements and validation commands.
- [x] **SDD-005** Implement verification skill. _Acceptance:_ missing evidence and untested requirements are reported.
- [x] **SDD-006** Implement requirement-to-evidence traceability graph. _Acceptance:_ requirement → decision → task → code → test → evidence is queryable.
- [x] **SDD-007** Add quality gates between workflow stages. _Acceptance:_ incomplete artifacts block progression with actionable feedback.
- [x] **SDD-008** Connect workflow recommendations and quality gates to the SDD sequence. _Acceptance:_ selected later stages include declared prerequisites; verification is recommended for supported project profiles and test runners; each gate checks the matching artifact; review instructions do not refer to a nonexistent CLI gate.

## Adapters and migration — P1/P2

- [x] **ADP-001** Complete Codex adapter. _Acceptance:_ skills, rules, agents, hooks, and context render correctly where supported.
- [x] **ADP-002** Implement Claude Code adapter.
- [x] **ADP-003** Implement Cursor adapter.
- [x] **ADP-004** Implement Gemini CLI adapter.
- [x] **ADP-005** Implement GitHub Copilot adapter.
- [x] **ADP-006** Implement universal fallback adapter.
- [x] **MIG-001** Implement `aiw target <target>` migration. _Acceptance:_ neutral resources are rendered to the new target and manifest is updated.
- [x] **MIG-002** Add migration dry-run, conflict report, backup, and rollback. _Acceptance:_ failed migration leaves the previous target intact.
- [x] **MIG-003** Add adapter contract and fixture tests. _Acceptance:_ each adapter passes common rendering and degradation scenarios.

## External ecosystem — P2

- [x] **PKG-001** Implement local and Git package providers.
- [x] **PKG-002** Integrate Vercel Skills as an external provider. _Acceptance:_ search, inspect, install, lock, and update are represented in AIW state.
- [x] **PKG-003** Add package audit and permission review before installation.
- [x] **PKG-004** Add update, compatibility, and dependency conflict workflows.
- [x] **PKG-005** Create a curated Multileaf package registry.
- [x] **PKG-006** Add package signing, checksums, and provenance verification.

## Context and cost — P2

- [x] **SEM-001** Add flag-gated semantic mapping to scan and retrieval. _Acceptance:_ `.aiw/semantic.yml` with `enabled: true` verifies model availability before indexing, builds a versioned chunk index during `aiw scan`, and `aiw semantic query` returns ranked matches; missing or disabled configuration keeps scans fully deterministic and offline; semantic results are retrieval aids, never confirmed facts.
- [x] **SEM-002** Integrate a decision model (jev/clef-flash via Ollama `/v1/systemone`) for advisory gate triage. _Acceptance:_ `.aiw/decision.yml` with `enabled: true` verifies model availability before use; `aiw decision triage` returns advisory `evidence_complete` and `gate` decisions with confidence; disabled or missing configuration makes no network request; advisory output never replaces human approval. See `docs/decision-model-evaluation.md`.
- [ ] **SEM-003** Embed chunks in batches. _Acceptance:_ indexing uses the batch embeddings endpoint (for example Ollama `/api/embed`) instead of one request per chunk, measurably reducing scan time on this repository (baseline: ~34s for 824 chunks) with identical index output.
- [ ] **SEM-004** Exclude lockfiles and generated vendor manifests from the semantic index. _Acceptance:_ files such as `package-lock.json` (observed contributing 75 noise chunks) are skipped during indexing by default with an explicit, documented override.
- [ ] **SEM-005** Re-rank semantic recall with a decision model. _Acceptance:_ when both semantic mapping and a decision model are enabled, `aiw semantic query` optionally re-ranks embedding matches with the decision model, reporting the ranking influence; recall without a decision model is unchanged.
- [ ] **SEM-006** Scope AI interpreter context with semantic retrieval. _Acceptance:_ when semantic mapping is enabled and an index exists, the interpreter receives deterministic key files plus the top semantically relevant chunks for the active analysis question instead of alphabetically ordered files up to the token ceiling; measured token usage decreases and inferred-fact quality does not regress against the current baseline; scans without semantic mapping are unchanged.

## Onboarding — P1

- [ ] **TEL-001** Offer telemetry consent during installation. _Acceptance:_ interactive install asks about telemetry after the model questions with an explicit default of No, states the exact event payload (command name and outcome only, no arguments, paths, or contents), records the decision in `.aiw/settings.yml`, and remains reversible through `aiw telemetry enable/disable`; non-interactive installs skip the prompt; the prompt itself never emits an event.

## Telemetry — P2

- [ ] **TEL-002** Add an inspectable local telemetry buffer. _Acceptance:_ when telemetry is enabled and a host client is absent, events accumulate in a rotated local buffer under `.aiw/` with a documented retention cap; `aiw telemetry status --verbose` displays buffered events; `aiw telemetry disable` purges the buffer; no network transport is introduced by this item.

- [ ] **ONB-001** Detect and offer real local models during installation. _Acceptance:_ interactive install probes the configured Ollama endpoint (`/api/tags`), lists the embedding and decision models actually available, and records the user's selection in `.aiw/settings.yml`; when no server or models are found, the installer reports the optional capability and continues without network assumptions; non-interactive installs are unchanged.

## Context and cost — P2 (continued)

- [x] **CTX-001** Build layered project context store.
- [x] **CTX-002** Add task-scoped context retrieval and delta loading.
- [x] **CTX-003** Add summary cache and freshness invalidation.
- [x] **CTX-004** Add per-stage token budgets and usage reporting.
- [x] **CTX-005** Add context quality metrics and regression tests.

## Enterprise and ecosystem — P3

- [x] **ENT-001** Add organization policies and approved package sources.
- [x] **ENT-002** Add team-shared presets and private registries.
- [x] **ENT-003** Add policy enforcement in CI and pull requests.
- [x] **ENT-004** Add telemetry opt-in with privacy controls. _Acceptance:_ telemetry is disabled by default, users independently control aggregate command/outcome fields, sensitive execution data is never serialized, and collector failures cannot affect workflow results.
- [x] **ENT-005** Add plugin SDK and package authoring tooling. _Acceptance:_ authors can deterministically scaffold and validate portable packages through the CLI and typed SDK, unsafe paths and overwrites fail atomically, and generated resources are English and contract-valid.
- [x] **ENT-006** Add web UI for project profile, recommendations, traceability, and migrations. _Acceptance:_ `aiw ui` serves a local-only, responsive and accessible dashboard from packaged project state; profile, recommendations, and requirement evidence are visible; migrations require explicit confirmation and delegate to the existing workflow.
- [x] **ENT-007** Add multi-agent orchestration and parallel task execution. _Acceptance:_ strict versioned task graphs support deterministic preview, explicit adapter-backed execution, bounded parallelism, dependency-aware failure isolation, and immutable checkpoint evidence.

## Engineering — P2

- [ ] **ENG-001** Update GitHub Actions to Node 24-native versions. _Acceptance:_ `actions/checkout` and `actions/setup-node` upgraded past v4 so release workflows no longer emit Node.js 20 deprecation warnings; CI and Release workflows pass on `ubuntu-latest` before and after the October 19, 2026 Ubuntu 26 runner migration.

## Backlog rules

- [x] **FND-009** Add self-validation workflow. _Acceptance:_ changes affecting AIW behavior execute against this repository and record generated-output evidence.
- Every item must have tests or explicit validation evidence before completion.
- Every item must validate all affected layers; domain tests alone cannot mark an externally visible feature as complete.
- New work must identify its affected contract and dependencies.
- P0 work takes precedence over feature expansion.
- A task may move to Done only when implementation, tests, documentation, and quality checks pass.

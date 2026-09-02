# Product Backlog

Priority levels: **P0** blocks the product or makes it unsafe; **P1** is required for a usable product; **P2** improves scale, quality, or portability; **P3** is an advanced or ecosystem feature.

## Foundation — P0

- [ ] **FND-001** Define and validate the neutral `manifest.yaml` schema. _Acceptance:_ invalid manifests produce actionable errors; schema is versioned and tested.
- [ ] **FND-002** Define `package.yaml` and resource contracts. _Acceptance:_ skills, rules, agents, hooks, templates, policies, dependencies, permissions, and provenance are representable.
- [ ] **FND-003** Define adapter contract and capability matrix. _Acceptance:_ adapters report supported resources and lifecycle events.
- [ ] **FND-004** Introduce structured domain types and service interfaces. _Acceptance:_ CLI contains no business logic; services are dependency-injected and unit-testable.
- [ ] **FND-005** Add complete TDD quality pipeline. _Acceptance:_ `check` runs format, lint, typecheck, tests, and security checks.
- [ ] **FND-006** Add CI workflow. _Acceptance:_ every pull request runs all required checks.

## Installation and lifecycle — P0/P1

- [ ] **INS-001** Make installation idempotent and non-destructive. _Acceptance:_ repeated installation preserves overrides and reports state.
- [ ] **INS-002** Implement target selection and detection. _Acceptance:_ supported installed agents are detected and user can override detection.
- [ ] **INS-003** Install and register the base `ai-init` skill. _Acceptance:_ generated artifact is valid for every supported target.
- [ ] **INS-004** Implement `status`, `doctor`, and actionable diagnostics. _Acceptance:_ missing, stale, conflicting, and unsupported state is explained.
- [ ] **INS-005** Implement package resolution and lockfile generation. _Acceptance:_ same lockfile produces the same resources.
- [ ] **INS-006** Implement uninstall and repair safely. _Acceptance:_ only AIW-owned generated files are removed or restored.

## Project intelligence — P1

- [ ] **SCAN-001** Build ignore-aware repository scanner. _Acceptance:_ respects `.gitignore`, excludes secrets, and has deterministic output.
- [ ] **SCAN-002** Detect languages, frameworks, package managers, scripts, tests, linters, formatters, CI, and workspace structure. _Acceptance:_ fixtures cover common project types.
- [ ] **SCAN-003** Store confidence and evidence for detected facts. _Acceptance:_ each inferred fact points to a source and confidence score.
- [ ] **SCAN-005** Define the hybrid intelligence contract. _Acceptance:_ detected, inferred, and confirmed states are represented and AI inference cannot silently replace deterministic facts.
- [x] **SCAN-006** Implement scoped AI project interpreter. _Acceptance:_ interpreter receives filtered context and produces structured insights requiring confirmation when uncertain.
- [ ] **SCAN-007** Add interpreter privacy and token guardrails. _Acceptance:_ secrets, dependencies, generated files, Git internals, and checkpoints are excluded and token usage is measured.
- [ ] **SCAN-004** Add interactive confirmation and overrides. _Acceptance:_ users can accept, reject, or edit inferred facts.
- [ ] **REC-001** Build capability recommendation engine. _Acceptance:_ recommendations include rationale, evidence, permissions, conflicts, and confidence.
- [ ] **REC-002** Add interactive capability selection. _Acceptance:_ users select packages and individual resources before installation.
- [ ] **GEN-001** Generate project-specific rules, agents, hooks, and context. _Acceptance:_ generated content uses confirmed profile data and English artifacts.
- [ ] **GEN-002** Preserve manual overrides and detect drift. _Acceptance:_ regeneration never silently overwrites user changes.

## SDD workflow — P1

- [ ] **SDD-001** Implement brainstorming artifact and facilitator skill. _Acceptance:_ goals, users, assumptions, constraints, and open questions are captured.
- [ ] **SDD-002** Implement specification skill and template. _Acceptance:_ requirements have stable IDs and acceptance criteria.
- [ ] **SDD-003** Implement design and architecture decision records. _Acceptance:_ alternatives, decisions, and rationale are linked.
- [ ] **SDD-004** Implement implementation planning. _Acceptance:_ tasks link to requirements and validation commands.
- [ ] **SDD-005** Implement verification skill. _Acceptance:_ missing evidence and untested requirements are reported.
- [ ] **SDD-006** Implement requirement-to-evidence traceability graph. _Acceptance:_ requirement → decision → task → code → test → evidence is queryable.
- [ ] **SDD-007** Add quality gates between workflow stages. _Acceptance:_ incomplete artifacts block progression with actionable feedback.

## Adapters and migration — P1/P2

- [ ] **ADP-001** Complete Codex adapter. _Acceptance:_ skills, rules, agents, hooks, and context render correctly where supported.
- [ ] **ADP-002** Implement Claude Code adapter.
- [ ] **ADP-003** Implement Cursor adapter.
- [ ] **ADP-004** Implement Gemini CLI adapter.
- [ ] **ADP-005** Implement GitHub Copilot adapter.
- [ ] **ADP-006** Implement universal fallback adapter.
- [ ] **MIG-001** Implement `aiw target <target>` migration. _Acceptance:_ neutral resources are rendered to the new target and manifest is updated.
- [ ] **MIG-002** Add migration dry-run, conflict report, backup, and rollback. _Acceptance:_ failed migration leaves the previous target intact.
- [ ] **MIG-003** Add adapter contract and fixture tests. _Acceptance:_ each adapter passes common rendering and degradation scenarios.

## External ecosystem — P2

- [ ] **PKG-001** Implement local and Git package providers.
- [ ] **PKG-002** Integrate Vercel Skills as an external provider. _Acceptance:_ search, inspect, install, lock, and update are represented in AIW state.
- [ ] **PKG-003** Add package audit and permission review before installation.
- [x] **PKG-004** Add update, compatibility, and dependency conflict workflows.
- [ ] **PKG-005** Create a curated Multileaf package registry.
- [ ] **PKG-006** Add package signing, checksums, and provenance verification.

## Context and cost — P2

- [ ] **CTX-001** Build layered project context store.
- [ ] **CTX-002** Add task-scoped context retrieval and delta loading.
- [ ] **CTX-003** Add summary cache and freshness invalidation.
- [ ] **CTX-004** Add per-stage token budgets and usage reporting.
- [ ] **CTX-005** Add context quality metrics and regression tests.

## Enterprise and ecosystem — P3

- [ ] **ENT-001** Add organization policies and approved package sources.
- [ ] **ENT-002** Add team-shared presets and private registries.
- [ ] **ENT-003** Add policy enforcement in CI and pull requests.
- [ ] **ENT-004** Add telemetry opt-in with privacy controls.
- [ ] **ENT-005** Add plugin SDK and package authoring tooling.
- [ ] **ENT-006** Add web UI for project profile, recommendations, traceability, and migrations.
- [ ] **ENT-007** Add multi-agent orchestration and parallel task execution.

## Backlog rules

- [ ] **FND-009** Add self-validation workflow. _Acceptance:_ changes affecting AIW behavior execute against this repository and record generated-output evidence.
- Every item must have tests or explicit validation evidence before completion.
- Every item must validate all affected layers; domain tests alone cannot mark an externally visible feature as complete.
- New work must identify its affected contract and dependencies.
- P0 work takes precedence over feature expansion.
- A task may move to Done only when implementation, tests, documentation, and quality checks pass.

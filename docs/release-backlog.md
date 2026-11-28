# Release Backlog

## Version 0.1.0

- [x] **REL-001** Prepare a reproducible release candidate. _Acceptance:_ metadata, changelog, package allowlist, clean compilation, automated release checks, exact-tarball smoke tests, and provenance-ready CI are present and validated.
- [x] **REL-002** Approve the public package license and configure secure npm publishing for `MultiLeaf/aiw`. _Acceptance:_ MIT is approved, the granular bootstrap token is stored only as an environment secret, and the protected GitHub `npm` environment requires review, rejects administrative bypass, and accepts only version tags.
- [x] **REL-003** Publish and verify version `0.1.0`. _Acceptance:_ the signed Git tag, GitHub release, npm package, provenance statement, clean `npx` installation, and post-publication smoke tests all agree on the immutable version.

## Next (Post-0.21.0 Flow & Architecture Improvements)

### 1. Local Models Resilience & Incremental Semantic Indexing

- [x] **FLOW-001** Make local decision and embedding models resilient, incremental, and integrated into SDD stages.
  - Graceful fallback with a clear warning when Ollama is offline during `aiw recommend` or `aiw semantic` (instead of hard-failing with exit code 1).
  - Configurable `fetch` timeouts for `decision` and `semantic` providers, plus clearer default model guidance during onboarding.
  - Incremental semantic indexing (`aiw semantic index`) keyed by per-file content hash so unchanged files are not re-embedded on every run.
  - Optional semantic context injection into `technical-design`, `plan`, and `diagnosis` scaffolding, plus advisory pre-triage in `aiw gate review` / `aiw risk`.
  - _Acceptance:_ offline Ollama degrades cleanly with deterministic fallback and warning; unchanged files skip re-embedding; timeouts and fallback paths are covered by unit tests.

### 2. Telemetry Hygiene & Local Insights

- [ ] **FLOW-002** Eliminate telemetry Git noise, keep the command whitelist complete, and add local summary reporting.
  - Ensure `.aiw/telemetry-buffer.jsonl` is ignored or stored cleanly so read-only commands (`status`, `doctor`) never dirty tracked Git state.
  - Sync `TELEMETRY_COMMANDS` with all registered CLI commands (including `prd`, `pr`, `orchestrate`, `usage-sidecar`) with a parity test so new commands never fall back to `"unknown"`.
  - Add `aiw telemetry summary` to report local command frequency and failure rates without external transmission.
  - _Acceptance:_ running `aiw status`/`aiw doctor` leaves `git status` clean; telemetry command parity test passes; `aiw telemetry summary` renders deterministic local metrics.

### 3. Artifact & Checkpoint Lifecycle Hygiene

- [ ] **FLOW-003** Add checkpoint pruning and a unified active-workflow status view.
  - Add `aiw workflow prune` (with `--dry-run` and `--keep=<N>`) to archive or remove old closed `task-light-*.yml` and `workflow-*-approvals.yml` checkpoints under `.aiw/checkpoints/`.
  - Add `aiw workflow summary` (and enrich `aiw status`) to show the active workflow's stage tree, artifact paths, gate states, and next required action in one screen.
  - _Acceptance:_ `aiw workflow prune --dry-run` previews without mutating state and never touches active workflow checkpoints; `aiw workflow summary` accurately reflects ledger and artifact state.

### 4. Skills, Agents, Rules & Hooks Coverage

- [ ] **FLOW-004** Close resource gaps across workflow stages, common stacks, and hook validation.
  - Add dedicated bundled skills for uncovered workflow stages: `product-requirements`, `bugfix-diagnosis`, and `release-management` (aligned with `resources/hooks/pre-release.md`).
  - Broaden bundled agent/skill coverage beyond NestJS/Prisma/Vite with stack-agnostic or high-demand roles (e.g., `bugfix-investigator`, Python/Go/React-Next.js specialists).
  - Extend `aiw doctor` to verify installed project hooks remain in sync with bundled hook contracts.
  - _Acceptance:_ new skills and agents pass `validatePackageContract`, adapter rendering across all 7 targets, and `npm run release:check`.

### 5. SDD Workflow Ergonomics & Plan-to-Orchestrate Bridge

- [ ] **FLOW-005** Reduce stage-to-stage friction and connect `plan` directly to multi-agent orchestration.
  - Add `aiw next` to inspect the active workflow and print (or guide) the exact next command: missing artifact, pending gate, or required human approval.
  - Support `aiw workflow start --skip=<stage1,stage2> --skip-reason=<reason>` to batch-skip optional stages (`brainstorming`, `product-requirements`, `technical-design`, `pr`) up front.
  - Add `aiw orchestrate --from-plan` to generate a draft `orchestration.yml` task graph from the active implementation plan's tasks and dependencies.
  - _Acceptance:_ `aiw next` deterministically identifies the next action across `feature`, `bugfix`, and `refactor` processes; batch `--skip` rejects required stages; `--from-plan` produces a valid schema-1 orchestration plan.

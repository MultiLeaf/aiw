# Token Efficiency

Token efficiency is a runtime concern, not only a prompt-writing concern.

## Strategies

- Store facts, decisions, and conversation summaries separately.
- Load context by task and dependency rather than sending the whole repository.
- Use stable identifiers for requirements and decisions.
- Send deltas after the first context load.
- Cache project profiles and generated summaries.
- Track context freshness and invalidate stale summaries.
- Apply budgets by workflow stage.
- Measure tokens per agent, package, task, and verification cycle.

The runtime should prefer references such as `AUTH-REQ-04` and retrieve their content only when needed.

## Standing-context benchmark

`aiw context-bench` measures the persistent context AI Workflow renders into every agent session — deterministically, offline, and with zero API cost. It reports, per category (root context file, skills, rules, agents, hooks, templates, context layers): file count, measured characters, and estimated tokens (characters/4, always labeled `estimated`). A content hash pins the exact fixture behind every number, and the output contains no timestamps, so unchanged projects produce byte-identical reports.

```bash
aiw context-bench --save                      # record a checkpoint under .aiw/checkpoints/
aiw context-bench --baseline=<checkpoint.yml> # exit 1 on any token regression
```

Any token increase against the baseline is a regression and fails the command (the parity-harness rule). This is the quality gate for context changes: optimize freely, but standing context may not silently grow.

## Task parity suite

`aiw parity` pins quality constraints on context assembly. Each parity task is one YAML file under `.aiw/parity/` (or `--tasks=directory`, relative to the project root) describing a scenario and its expectations:

```yaml
schema: 1
id: deploy-guardrails
description: Deployment constraints must survive just-in-time retrieval
layers:
  global: "Team conventions: trunk-based development."
  project: "Never deploy on Fridays. Staging endpoint is db-staging.internal."
  task: "Ship the migration with a rollback plan."
critical_facts:
  - Never deploy on Fridays
  - db-staging.internal
completion_markers:
  - rollback plan
```

Every task runs twice against the same layers: the full composed context (baseline) and the just-in-time task-retrieval assembler. A task passes only when every critical fact and completion marker survives retrieval — exact containment checks, not similarity. If a fact lives only in a layer that retrieval drops (for example, `session`), the task fails and names the fact: that is a detected context loss, not a benchmark artifact. The command exits nonzero on any failure, so it can gate CI.

### Inter-stage parity tasks

Two optional fields turn a parity task into a check on the real handoff between SDD stages:

```yaml
schema: 1
id: spec-to-plan
description: Every requirement id from the approved specification must reach the planning context
layers:
  task: "Break the specification into ordered implementation tasks."
sources:
  project: .aiw/generated/specs/specification.md
required_patterns:
  - 'REQ-\d+'
```

`sources` loads a project-relative artifact into a layer (project, task, global, or session) before assembly, and `required_patterns` extracts every literal match from the loaded sources — each extracted identifier must survive assembly, or the task fails naming the exact loss (`missing_pattern: REQ-\d+ -> REQ-003`). This guards the identifiers traceability depends on: if a stage's context assembly drops a `REQ-###` or `TASK-###`, `aiw trace` cannot link it later. A missing source artifact is an explicit error, not a silent pass.

Cost is reported (estimated tokens, baseline vs assembled) but never gates here — this suite is the quality gate; `aiw context-bench` is the cost gate. The two compose: optimize context freely, but neither standing cost nor critical facts may regress silently.

## Usage sidecar

`aiw usage-sidecar` records per-run token usage with billing tiers, measurement labels, and harness attribution, stored as a versioned ledger at `.aiw/checkpoints/usage-sidecar.yml` (sequence-ordered, no timestamps, capped at 500 entries). Four tiers are kept separate because naive `tokens x price` accounting overstates savings on cache-heavy agents:

```bash
# record a run (measured by default; pass --estimated when values are derived)
aiw usage-sidecar record --command=session.plan --model=sonnet --harness=claude-code \
  --cache-read=48000 --fresh-input=6000 --cache-write=2000 --output=3100

aiw usage-sidecar report   # tier totals, cache hit rate, attribution by model and harness
```

Every entry carries `measured` or `estimated`, and aggregates propagate the label pessimistically: one estimated entry makes the reported total estimated. The report's `cache_hit_rate` (cache-read over billable input) is the single most economically meaningful ratio, since cached reads bill at a fraction of fresh input. Dollar conversion is deliberately not built in — provider prices rot, and unlabeled dollars would be dishonest by default.

`aiw scan` auto-records sidecar entries for interpreter and embedding usage with their real measurement label, so the ledger fills without manual effort.

## Cost per verified requirement

`aiw cost-report` joins the usage sidecar with the traceability graph to produce the outcome-denominated cost metric — tokens per verified requirement, where verified means the graph links the requirement to evidence:

```bash
aiw usage-sidecar record --command=session.verification --requirement=REQ-004 --fresh-input=9000 --output=2100
aiw trace          # builds .aiw/generated/artifacts/traceability.yml
aiw cost-report
```

Attributed and unattributed tokens are reported side by side so the ratio cannot be gamed by leaving expensive work unattributed, and the denominator counts only requirements with linked evidence — the same discipline as cost-per-merged-PR metrics, on AI Workflow's unit of value.

## Model routing table

`aiw routing` maintains a static, evidence-linked routing table at `.aiw/routing.yml`. Research consensus is that optimal routing is usually static — per-request dynamism mostly adds failure modes — so the table maps task categories (dot-separated kebab-case, e.g. `scan.interpreter`) to models deterministically:

```bash
aiw routing init                              # scaffold the table
aiw routing resolve --category=scan.interpreter
aiw routing show
```

Every rule carries an `evidence` field naming the benchmark, parity run, or ADR behind it, and the resolver states its advisory level honestly: `evidenced`, `unevidenced-rule` (benchmark it before trusting), `default-fallback`, or `default-unset` (a human must choose). Routing never invokes a model and humans can always override — the same advisory discipline as ModelFit.

## Task-lifecycle token usage

`aiw task-usage` measures the full life of one task — from `aiw task start` to the merged PR — in tokens, not dollars. Tokens are the model-invariant metric: routing part of a task to a frontier model and part to an entry-level model changes the price per token but not the input/output consumption, so lifecycle token totals stay comparable across model routing changes and harness migrations.

```bash
aiw usage-sidecar record --workflow=TEAM-123 --command=session.plan --model=sonnet \
  --requirement=REQ-001 --cache-read=6000 --fresh-input=3000 --output=800
aiw task-usage --workflow=TEAM-123   # or omit --workflow to use the active SDD task
```

All input tiers count as input tokens processed (cached reads still consume tokens; they just bill less), with the tier split and `cache_hit_rate` kept visible for cache-behavior analysis. The report shows totals, per-stage breakdown with the models each stage used, requirements touched, and harness attribution.

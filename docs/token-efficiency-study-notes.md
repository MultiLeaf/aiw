# Token Efficiency Study Notes

Deep-dive notes from studying the five reference repositories recommended in [token-efficiency-research.md](token-efficiency-research.md). Local clones live outside the repository at `../token-research/` (sibling of this repo, not committed).

| Repository                       | Role in the plan                             | Maturity                                                                    |
| -------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `awesome-llm-token-optimization` | Complete map of levers, tools, and papers    | Curated list; strong curation discipline                                    |
| `jettison-ai/jettison-parity`    | Cost/quality experiment design               | Small but rigorous: offline, deterministic, 29 tests, honest-labeling rules |
| `HumphreySun98/repoagentbench`   | How to build a benchmark from real work      | Published on PyPI, real leaderboards (~$11 API spend for 12 runs)           |
| `pulsemcp/switchboard`           | Cross-harness telemetry architecture         | Early (docs-first repo); architecture doc is the value                      |
| `DeepAgentLabs/agenticlens`      | Evaluation, diagnosis, and model-fit scoring | Large active codebase (400+ files), versioned releases, research program    |

## 1. awesome-llm-token-optimization — the map

Beyond the levers already captured in the research doc, the full read surfaced:

- **GitHub's own engineering result** ([github.blog](https://github.blog/ai-and-ml/github-copilot/improving-token-efficiency-in-github-agentic-workflows/)): pruning unused MCP tool schemas and swapping MCP calls for the `gh` CLI cut agentic-CI token spend **43–62%** across real workflows. This independently replicates Uber's CLI-resolved MCP lever.
- **Cockroach Labs**: re-sent context can be **62% of agent inference bills** — quantifies why per-turn context, not generation, is the dominant cost.
- **ProjectDiscovery**: raising cache hit rate from 7% to 84% across 9.8B cached tokens — the single largest documented saving, achieved purely by prompt-structure discipline (stable prefix).
- **Anthropic tool search**: 85% token reduction for large tool libraries; token-efficient tool use: 70% output reduction. Both are official provider features, not middleware.
- **Browser tool efficiency**: accessibility-tree approaches are 10–50x smaller than raw HTML; AI-summarized fetch ~20x better than Playwright MCP (1.5 KB vs 10–33 KB per page). Relevant to any web-driven skill.
- **Lossless rule-based compression achieves 3–4:1** with no model: strip prose/hedging, preserve numbers/entities/constraints/risks, dense bullets, self-contained 3–5K token sections. This is essentially AI Workflow's existing context strategy, externally validated.
- **Tokenizer warning**: newer Anthropic tokenizers produce ~30% more tokens for identical text at unchanged per-token prices — model upgrades can silently raise cost without any price change. Any cost attribution must be tokenizer-aware (Uber's "hold the model constant" rule exists for the same reason).
- **Router research caveat**: a 2026 game-theoretic analysis (arxiv:2602.09902) argues optimal routing is usually _static_ — dynamism mostly adds failure modes. Prefer a small fixed routing table per task category over clever per-request routing.

## 2. jettison-parity — the experiment design

The most directly transferable artifact. It answers cost and quality **together**, deterministically and offline.

### Four benchmark families

| Family           | Measures                                                                                                                                                                     | Transferable idea                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Standing context | Tokens per turn of persistent context (tool schemas, skill bodies, instruction files), per category, byte-reproducible                                                       | Measure AIW's rendered context (AGENTS.md/CLAUDE.md, skills, rules) the same way — before/after any resource change |
| Task parity      | Same task run baseline vs optimized; scores completion, correct tool + params, **critical-fact retention**, rounds, tokens. **Exits nonzero on any regression**              | The quality gate: `critical_facts` containment checks that facts which must survive compression actually survive    |
| Session cost     | Dollars of an N-turn session pricing cache-read / fresh-input / cache-write **separately**, in cache-hit and cache-miss regimes                                              | Naive `tokens_saved × price` overstates savings ~10x on cache-heavy agents — AIW cost math must be tier-aware       |
| Holdout RCT      | Randomized trial over recorded request logs: sha256 arm assignment, mean tokens/request, 95% CI. Synthetic output is always labeled "synthetic demonstration — not evidence" | The standard for claiming a real-world saving once logs exist                                                       |

### Honest-measurement rules (adopt verbatim)

1. Every number carries a label: `measured` (exact tokenizer / provider price) vs `estimated`; labels propagate pessimistically.
2. Synthetic is never evidence.
3. Disclose the config alongside any number (content hash).
4. Cache-aware dollars (per billing tier).
5. No network, no clocks — byte-identical reruns.

### Adapter surface

A single method makes any optimizer scoreable: `optimize_request(body, provider) -> body`. AIW's equivalent boundary is the context assembly that produces a session's initial payload.

### Task file schema (quality pin)

```json
"expected": {
  "tool": "pg_describe_table",
  "arguments": {"table": "orders"},
  "critical_facts": ["Never run a migration", "db-staging.internal.example.com"],
  "final_answer_contains": "DONE"
}
```

Six shipped scenarios cover: tool selection among 20 tools, search→load→call chains, numeric constraints, security rules, output-format requirements, mixed turns.

## 3. repoagentbench — building the benchmark

### Mining pipeline (PR → task)

1. PR title/body/base SHA/diff via `gh`.
2. Clone at base commit.
3. Split diff into `solution_tests.patch` + `solution_source.patch`; apply **tests only**, so the starting state is "post-PR tests vs pre-PR source".
4. Auto-generate `verify.sh` for the detected framework.

### Run protocol (the part to copy)

- Fresh workdir + per-task venv per run.
- `pre_verify` must **FAIL** (proves the task is broken), agent runs, `post_verify` must **PASS** (proves the fix).
- Artifacts: `diff.patch`, `agent.log`, `events.jsonl` — replayable and diffable.
- `mock-fix` oracle agent (applies the known PR diff) validates the harness itself: 3/3 pass.

### Findings that matter

- **The harness is part of the system under test**: same Anthropic model via aider (no-op fix, FAIL) vs native Claude Code (canonical fix, PASS) on the identical PR. Portability claims must be measured per-harness, not assumed.
- Contamination control: mine PRs post-dating the model's training cutoff (cites arxiv:2512.10218 — frontier models score 3x better on potentially-contaminated benchmarks).
- Cheap: ~$11 for 12 real-agent runs. A self-benchmark is not expensive.

**AIW translation**: our unit is not a PR but an SDD task — spec → plan → implementation → verification. The analog of "PR tests" is the AIW quality gate / verification evidence; the analog of `pre_verify` is "the requirement has no passing evidence yet".

## 4. switchboard — cross-harness telemetry architecture

Early-stage, docs-first. The architectural pattern is the takeaway:

- **Canonical format ("OpenTranscripts")**: every agent's transcript is converted by a deterministic, versioned, per-source converter into one schema. New agent → new converter; spec change → version bump.
- **One hard determinism boundary**: raw → canonical is deterministic ETL; only segmentation and outcome scoring are LLM-driven, downstream and optional (MVP makes zero LLM calls).
- **Hooks, not interception**: a small separately-distributed package per agent pipes sessions to user-owned storage (S3/GCS/local/HTTP behind one interface). The platform never owns the ingestion edge.
- Sidecar metadata per session: who ran it, trigger, model, token usage, harness + version. Deterministic rollups over the canonical table feed org-level dashboards.

**AIW translation**: AIW checkpoints are already a deterministic, versioned artifact per harness-agnostic run. The missing piece is per-session token/cost sidecar metadata recorded at checkpoint time (model, harness, tokens in/out/cached), which turns existing checkpoints into the `open_transcripts` equivalent without any new ingestion machinery.

## 5. agenticlens — evaluation and model-fit

Large active project (v0.10.0). Most relevant constructs:

- **Evaluator versioning**: every score carries its evaluator's version; evidence audits tie recommendations to the step they concern.
- **Experiments**: pass@k, pass^k, confidence intervals, significance tests, factor comparison — statistics done properly for agent evals.
- **Failure taxonomy + attribution**: deterministic diagnosis rules attribute failures to faulty step/agent, validated on controlled failures.
- **ModelFit**: task taxonomy, **hard constraints on quality/cost/latency/safety**, weighted scoring, per-category **Pareto frontiers with cost-per-success rankings**, recommendation confidence + explanations.
- **Advisory routing**: turns saved ModelFit evidence into explainable runtime decisions — advisory by default, execution requires explicit opt-in, with a local audit journal. Aligns with the static-routing finding from §1.

**AIW translation**: ModelFit's constraint-then-Pareto structure is exactly step 1–3 of our recommended path; "cost per success" is the outcome-denominated metric from the Uber post, productized.

## Synthesis: implementation blueprint for steps 1–2

Combining the five sources, the sequence with concrete designs:

1. **Standing-context benchmark** (jettison-parity, family 1): a command that renders AIW context for a fixture project and reports tokens per category (root context file, skills, rules, tool schemas) with a content hash. Deterministic, offline, zero API cost. First deliverable.
2. **Task parity suite** (jettison-parity, family 2 + repoagentbench protocol): SDD tasks from `src/fixtures` with `expected` blocks (required artifacts, `critical_facts` that must survive context filtering, completion markers). Baseline vs optimized context; **exit nonzero on regression**. `pre_verify must fail / post_verify must pass` discipline via existing quality gates.
3. **Checkpoint sidecar metadata** (switchboard pattern): record model, harness+version, token tiers (cache read / fresh input / cache write / output) into every `.aiw/checkpoints/` entry. Tier-aware, `measured` vs `estimated` labeled.
4. **Cost-per-verified-requirement** (Uber + agenticlens ModelFit): join step-3 metadata with `evidence.ts`/`traceability.ts` to report cost per unit of value, per SDD stage and per skill.
5. **Static routing table** (research consensus): a small per-task-category model matrix with hard quality constraints from step 2's benchmark; advisory with manual override, audit-logged.
6. **Holdout RCT** (jettison-parity, family 4): once real session logs accumulate, upgrade claims from "benchmark delta" to CI-backed RCT evidence.

### Guardrails to adopt wholesale

- Honest labeling (`measured`/`estimated`, pessimistic propagation).
- Synthetic results are never evidence.
- Config hash disclosed with every published number.
- Model (and tokenizer) held constant when attributing savings.
- Oracle baseline (mock-fix equivalent) to validate the harness itself.

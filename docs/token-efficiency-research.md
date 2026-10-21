# Token Efficiency Research

Research notes and external references for the open problem: **guaranteeing low token consumption without sacrificing output quality**. This document consolidates published methodologies, open-source implementations, and a recommended path for AI Workflow.

> Methodology note: sources were collected via GitHub Search API and web search. Descriptions and savings figures come from the projects' own READMEs and blog posts and have not been independently validated. Last reviewed: October 2026.

## The core problem

Token optimization without a quality constraint is indistinguishable from degradation. Every credible source converges on the same inversion of the problem:

1. **Fix quality first** as a measurable constraint (benchmark of real work).
2. **Then minimize cost subject to that constraint.**

"Guaranteeing" low consumption is only possible once quality is pinned to a benchmark that an optimization cannot silently regress.

## Reference publications

| Publication                                                                                                                                                                       | Key contribution                                                                                                                                                                                                 | Relevance to AI Workflow                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Uber Engineering — [Running a Software Factory Efficiently at Uber Scale](https://www.uber.com/blog/efficient-software-factory/)                                                  | Cost equation decomposed into six multiplicative, independently measurable terms; sequential driver decomposition with no unexplained residual; outcome-denominated cost (cost per merged PR, per triaged alert) | The measurement model to adopt: decompose, attribute, and denominate cost by unit of value |
| Anthropic — [Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) and [Token-Saving Updates](https://www.anthropic.com/news/token-saving-updates) | Cache reads at ~0.1x input price; TTL economics (5 min at 1.25x write, 1 h at 2x); thinking blocks cached in tool-use loops                                                                                      | Cache-friendly ordering of system prompt, rules, and project profile                       |
| Microsoft Azure — [The Economics of Agent Optimization](https://azure.microsoft.com/en-us/blog/the-economics-of-agent-optimization-context-engineering-for-enterprise-ai-agents/) | Context engineering framed as the primary economic lever for enterprise agents                                                                                                                                   | Aligns with product principle 6 (just-in-time context)                                     |
| LMSYS — [RouteLLM](https://www.lmsys.org/blog/2024-07-01-routellm/)                                                                                                               | Formal cost/quality trade-off for model routing; 2x+ cost reduction with quality held                                                                                                                            | Routing strategy for the provider-neutral `AiProvider` interface                           |
| GetBeam — [AI Agent Token Cost Optimization](https://getbeam.dev/blog/ai-agent-token-cost-optimization.html)                                                                      | Practical case study with spend decomposition                                                                                                                                                                    | Cross-check on decomposition methodology                                                   |

### Common pattern across publications

Savings never come from a single technique. The pattern is:

1. Measure per task, not per aggregate.
2. Pin quality with a benchmark built from real work.
3. Optimize each cost term separately (price/token, tokens/request, requests/turn).
4. Hold the model constant when attributing savings (behavior shifts with every upgrade).

## Repositories by category

### Context engineering and token reduction

| Repository                                                                                                          | Stars | Notes                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [microsoft/LLMLingua](https://github.com/microsoft/LLMLingua)                                                       | ~6.8k | Prompt compression (EMNLP'23, ACL'24); 5–20x compression. `gladehq/claude-shorthand` applies it to Claude Code (~55% claimed). Last-resort layer due to quality risk. |
| [ratel-ai/ratel](https://github.com/ratel-ai/ratel)                                                                 | ~484  | Context engineering for agents: ~80% fewer tokens via fixing tool overload; in-process BM25 skills and memory. Architecturally the closest peer.                      |
| [jia-gao/leanctx](https://github.com/jia-gao/leanctx)                                                               | ~323  | Drop-in prompt compression, 40–60% claimed without app changes.                                                                                                       |
| [rossoclt/context-guru](https://github.com/rossoclt/context-guru)                                                   | ~70   | Context optimization for coding agents: lower cost and latency "without sacrificing accuracy".                                                                        |
| [pleasedodisturb/awesome-llm-token-optimization](https://github.com/pleasedodisturb/awesome-llm-token-optimization) | ~99   | **The reference map.** Quick-wins table (cache 90% input, routing 60–95%, batch 50%, compression 5–20x), papers, and tools by category. Read first.                   |
| [wai-21/llm-token-optimization](https://github.com/wai-21/llm-token-optimization)                                   | ~2    | Decision Distillation, skill routing; 60–99% claimed. Unvalidated.                                                                                                    |
| [8b-is/smart-tree](https://github.com/8b-is/smart-tree)                                                             | ~271  | Context-aware filesystem tooling replacing 20+ tools; token reduction via tool design.                                                                                |

### Telemetry across harnesses

| Repository                                                                        | Stars | Notes                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [pulsemcp/switchboard](https://github.com/pulsemcp/switchboard)                   | new   | Self-hosted capture of agent transcripts (Claude Code, Codex, others). Cross-harness data source without vendor lock-in — the piece Uber gets from its gateway but a portable system must build. |
| [DeepAgentLabs/agenticlens](https://github.com/DeepAgentLabs/agenticlens)         | ~58   | Open-source profiler: token usage, cost, latency, and optimization opportunities per session.                                                                                                    |
| [traceloop/openllmetry](https://github.com/traceloop/openllmetry)                 | ~7.5k | GenAI observability on OpenTelemetry. The interoperable schema to adopt if telemetry grows beyond local use.                                                                                     |
| [gocenalper/agent-optimization](https://github.com/gocenalper/agent-optimization) | ~12   | Live token monitor for Claude Code / Codex: cost tracking, analysis, LLM-powered suggestions.                                                                                                    |
| [BerriAI/litellm](https://github.com/BerriAI/litellm)                             | high  | Proxy with routing and cost tracking for 100+ providers; candidate neutral measurement layer.                                                                                                    |
| [timharris707/modeldeck](https://github.com/timharris707/modeldeck)               | ~116  | Usage/quota tracking across Claude Code and Codex accounts.                                                                                                                                      |

### Harnesses, workflows, and SDD

| Repository                                                                          | Stars | Notes                                                                                                           |
| ----------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| [github/spec-kit](https://github.com/github/spec-kit)                               | ~142k | De-facto standard for spec-driven development; direct philosophical competitor.                                 |
| [cisco-open/ai-harness-toolkit](https://github.com/cisco-open/ai-harness-toolkit)   | ~15   | Skills for assessing AI-native engineering workflows in repositories.                                           |
| [Zoria-Lind/dsh-token-optimizer](https://github.com/Zoria-Lind/dsh-token-optimizer) | ~20   | Layered pipeline: output ladder, MCP lazy loading, compaction driver. Small but architecturally interesting.    |
| [ComposioHQ/composio](https://github.com/ComposioHQ/composio)                       | ~30k  | 1000+ toolkits with tool search and context management — the "tool search" pattern Uber describes, productized. |

### Benchmarks with quality data (fix quality before optimizing)

| Repository                                                                      | Stars | Notes                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [HumphreySun98/repoagentbench](https://github.com/HumphreySun98/repoagentbench) | ~27   | Mines merged PRs into a local, contamination-free coding-agent benchmark. This is Uber's uReview methodology, open-sourced.                                                                                      |
| [mupt-ai/self-bench](https://github.com/mupt-ai/self-bench)                     | ~33   | Benchmarks agents on your own repository, Harbor-formatted evals.                                                                                                                                                |
| [jettison-ai/jettison-parity](https://github.com/jettison-ai/jettison-parity)   | new   | Benchmark harness for context-optimization middleware: task parity, session cost, harness-agnostic. Defines exactly the experiment needed: same task, different context configuration, measure cost and quality. |

## Savings reference table

From the awesome-list and Uber's post, ordered by effort-to-savings ratio:

| Lever                                        | Claimed savings        | Quality risk               | Applies at              |
| -------------------------------------------- | ---------------------- | -------------------------- | ----------------------- |
| Prompt prefix caching                        | ~90% of cached input   | None (transparent)         | Provider layer          |
| Tool schema lazy loading / tool search       | 50–70K tokens/session  | Low                        | Harness / MCP layer     |
| Model routing (cheap model for simple tasks) | 60–95% on routed calls | Medium — needs benchmark   | Provider / orchestrator |
| Batch APIs for non-urgent work               | ~50%                   | None (same output)         | Provider layer          |
| Code-mode / batched tool calls               | 55–100% per workflow   | Low                        | Harness layer           |
| Compaction budget                            | Context-dependent      | Medium                     | Harness layer           |
| Prompt compression (LLMLingua)               | 5–20x                  | High — degrades edge cases | Last resort, middleware |

Combined pipelines claim 95–99% versus a naive baseline, but every high-risk row requires the quality gate below.

## Recommended path for AI Workflow

A four-step guarantee pipeline, reusing existing pieces:

### Step 1 — Fix quality with a self-benchmark

Mine real SDD tasks (specs, plans, verification results from `.aiw/checkpoints/` and `.aiw/generated/`) into an evaluable set, following the `repoagentbench` / `self-bench` pattern. Define the acceptance rule: **an optimization ships only if outcome does not fall below threshold X% on the benchmark.** AI Workflow already has the ingredients: `evidence.ts`, `traceability.ts`, quality gates, and `src/fixtures`.

### Step 2 — Decompose cost per term

Extend `token-usage.ts` toward Uber-style decomposition, per SDD stage and per skill:

- input vs output vs cached tokens per request;
- requests per turn and turns per task;
- cost per **verified requirement** (outcome-denominated), not per session.

Data sources: agent JSONL logs (Claude Code, Codex — the `switchboard` approach) plus AIW checkpoints. Deliver through the existing `dashboard.ts`, evolving it toward anti-pattern detection (Uber reports 16 distinct session anti-patterns; the traces to detect them are already captured).

### Step 3 — Apply levers in ROI order

1. Stable cacheable prefix: system prompt + confirmed profile + rules first; dynamic context last.
2. Routing: subagents and mechanical skills to cheaper models, manual override preserved (AIW's provider neutrality makes this a configuration, not a rewrite).
3. Tool overload: lazy loading / on-demand tool schemas for MCP surfaces.
4. Stage-budgeted compaction (already designed in `token-efficiency.md`).
5. Prompt compression only behind the quality gate.

### Step 4 — Continuous guardrail

A CI gate that reruns the self-benchmark on changes to models, skills, or configuration and reports Δcost and Δquality. This is the "model held constant" discipline from Uber: savings claims are only attributed when the model is fixed. Fail the gate when quality regresses or cost exceeds threshold.

### Suggested study order

1. `pleasedodisturb/awesome-llm-token-optimization` — full map.
2. `jettison-ai/jettison-parity` — how to design the cost/quality experiment.
3. `HumphreySun98/repoagentbench` — how to build the benchmark.
4. `pulsemcp/switchboard` and `DeepAgentLabs/agenticlens` — cross-harness telemetry layer.

## Gaps and open questions

- **Absolute cost data:** none of the sources publish per-task absolute costs in a form transferable to another codebase; only relative deltas. The self-benchmark must establish its own baseline.
- **Quality drift across model upgrades:** Uber acknowledges behavior shifts with every upgrade; savings measured against one model do not transfer. The CI guardrail (step 4) is the only mitigation found.
- **Compression safety:** no source provides a formal guarantee that prompt compression preserves behavior on edge cases; treat it as untrusted until benchmarked.
- **Telemetry privacy:** most third-party trackers are local-first, but AI Workflow's telemetry consent model (opt-in, minimal payload) should gate any integration with observability backends.

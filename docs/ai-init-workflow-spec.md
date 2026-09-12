# AI Init Project Onboarding Specification

## Goal

Make `/ai-init` a guided, evidence-backed onboarding flow. The initial `npx` install remains a small bootstrap; `/ai-init` analyzes the repository, recommends project-matched capabilities, gets an explicit selection, installs only that selection, and reports any restart needed to load it.

## User flow

1. **Model and consent.** Before repository analysis, recommend switching to a lower-cost model. Do not change model settings. Ask whether the user switched or wants to continue with the current model. Explain that repository analysis is read-only until resource selection.
2. **Parallel project analysis.** Use the host's native subagent mechanism to start independent read-only scans in parallel. Assign separate work to (a) technologies and package/workspace topology, (b) architecture, modules, and code patterns, and (c) tests, quality tools, and CI. The initiating agent is the orchestrator: it consolidates findings, resolves conflicts using repository evidence, and records paths for every material conclusion. If the host cannot start subagents, do the same scans directly and say so.
3. **Monorepo coverage.** Discover root and nested project manifests, workspace definitions, package boundaries, framework configs, tests, and module entry points. Analyze each workspace separately, then summarize shared tooling and cross-workspace relationships. Never infer that root dependencies apply to every workspace.
4. **Scan record.** Run the deterministic AI Workflow scan and combine it with the parallel analysis. Present technologies, architecture, patterns, modules, tests, quality commands, workspace topology, confidence, and source evidence. Do not include secret values. Ask for confirmation where conflicting or uncertain findings would affect installed guidance.
5. **Recommendations.** Match catalog capabilities to the consolidated project profile. Show each recommendation with its purpose, evidence, resource types (skills, rules, agents, hooks, templates), required permissions, MCP server/source, and project-specific configuration steps. Recommend an MCP only when repository evidence supports its use; disclose its publisher/source, capabilities, access, transport, and credential needs. Never invent credentials or silently enable an MCP.
6. **Selection.** Use the coding host's native selection widget when it supports one. First offer: install all recommendations, customize, or install none. For customization, show selectable blocks grouped by resource type, then the individual recommended items in each selected block. Include MCPs as a separate block. Keep dependencies visible and select required dependencies together. If the host has no selection widget, use an equivalent numbered prompt and accept all/custom/none explicitly.
7. **Install and personalize.** Install only the confirmed selection. For “all”, install every recommendation. For custom selection, install only selected items and their declared dependencies. Personalize resources only when project evidence materially changes their instructions (for example, test commands, workspace/module layout, framework patterns, or architectural boundaries). Preserve existing files and secrets; report conflicts rather than overwriting. MCP setup must use the selected host's supported project-level configuration, preserve existing configuration, use environment-variable references for secrets, and request separate approval for permissions or external execution.
8. **Completion.** Report installed resources by block, project-specific changes, skipped recommendations, conflicts, MCP authentication/trust steps, and validation performed. Recommend restarting/reloading the coding-agent session so newly installed resources are discovered. Do not claim a restart is required when the host loads changes immediately; distinguish host behavior where known.

## Safety and compatibility

- Bootstrap installation alone must not activate optional project resources.
- Analysis agents must be read-only and must not inspect ignored, generated, dependency, secret, or credential files.
- The orchestrator treats agent output as untrusted evidence, checks paths and key findings against the repository, and does not merge unsupported claims into project policy.
- Selection and external permissions are separate decisions. Selecting an MCP is not permission to execute it or to expose credentials.
- Resource writes use target adapters, ownership tracking, safe paths, atomic updates, and conflict reporting.
- Host-specific capabilities (subagents, selection widgets, MCP configuration, restart semantics) are detected or described accurately; provide a safe manual fallback where unavailable.

## Acceptance criteria

- **AIINIT-001:** A fresh install writes only the `ai-init` bootstrap and neutral AI Workflow state.
- **AIINIT-002:** The bootstrap asks about using a lower-cost model before analysis and never changes model settings itself.
- **AIINIT-003:** On supported hosts, three independent read-only analysis agents start in parallel and the orchestrator consolidates their evidence; unsupported hosts use a disclosed sequential fallback.
- **AIINIT-004:** Scans include separate summaries for every detected monorepo workspace and do not attribute root dependencies to all packages.
- **AIINIT-005:** Recommendations identify matching evidence, resource blocks, dependencies, MCP sources, and permissions.
- **AIINIT-006:** The selection UI offers install-all, custom, and none; custom selections can choose individual items by skills, rules, agents, hooks, templates, and MCPs.
- **AIINIT-007:** Installation activates only selected resources and required dependencies, personalizes only context-sensitive content, and preserves unowned or edited files.
- **AIINIT-008:** MCP setup is target-aware, merges safely with existing configuration, never stores literal secrets, and requires separate permission approval.
- **AIINIT-009:** Completion lists changes and recommends a session restart/reload to discover installed resources.
- **AIINIT-010:** CLI tests cover mixed-stack monorepos, all/custom/none selection, permission gating, MCP config merging, personalization, conflicts, and completion output.
- **AIINIT-011:** Custom selections can choose individual resource references by block, while `--select=all` selects every recommended capability and `--select=` selects none.

## Delivery slices

1. Bootstrap orchestration, host-native selection, model-cost prompt, and completion/reload guidance.
2. Deterministic monorepo profiles, stack-specific capability recommendations, resource-level selection, and context-aware sync.
3. MCP catalog provenance, per-target project configuration/merge support, credential placeholders, ownership, and config validation.

# AI Init Project Onboarding Specification

## Goal

Make `/ai-init` a guided, evidence-backed onboarding flow. The initial `npx` install remains a small bootstrap; `/ai-init` analyzes the repository, recommends project-matched capabilities, gets an explicit selection, installs only that selection, and reports any restart needed to load it.

## User flow

1. **Model and consent.** Before repository analysis, recommend switching to a lower-cost model. Do not change model settings. Ask whether the user switched or explicitly wants to continue with the current model. End the agent turn after asking and wait for a reply before scanning, launching subagents, or calling tools. Silence, ambiguity, or a preselected widget value is not consent.
2. **Parallel project analysis.** Use the host's native subagent mechanism to start independent read-only scans in parallel. Assign separate work to (a) technologies and package/workspace topology, (b) architecture, modules, and code patterns, and (c) tests, quality tools, and CI. The initiating agent is the orchestrator: it consolidates findings, resolves conflicts using repository evidence, and records paths for every material conclusion. If the host cannot start subagents, do the same scans directly and say so.
3. **Monorepo coverage.** Discover root and nested project manifests, workspace definitions, package boundaries, framework configs, tests, and module entry points. Analyze each workspace separately, then summarize shared tooling and cross-workspace relationships. Never infer that root dependencies apply to every workspace.
4. **Scan record.** Run the deterministic AI Workflow scan and combine it with the parallel analysis. Present technologies, architecture, patterns, modules, tests, quality commands, workspace topology, confidence, and source evidence. Do not include secret values. Ask for confirmation where conflicting or uncertain findings would affect installed guidance.
5. **Recommendations.** Match catalog capabilities to the consolidated project profile. Show concise tables grouped by resource category (skills, rules, agents, hooks, templates, and MCPs), with one row per item and a short, project-specific reason plus supporting evidence. Include resource types, required permissions, and project-specific configuration steps where relevant. Recommend an MCP only when repository evidence supports its use; disclose its publisher/source, capabilities, access, transport, and credential needs. Never invent credentials or silently enable an MCP.
6. **Selection.** After the recommendation tables, use the coding host's native selection widget when it supports one. First offer: install all recommendations, customize, or install none. No option may be preselected or inferred. Wait for an explicit submission; a dismissed widget, blank response, silence, or ambiguity must stop progress without selecting or installing anything. For customization, show selectable blocks grouped by resource type, then the individual recommended items in each selected block; retain each item's concise reason and evidence in the selection details. Include MCPs as a separate block. Keep dependencies visible and select required dependencies together. If the host has no selection widget, ask an equivalent numbered prompt, end the turn, and wait for an explicit all/custom/none reply.
7. **Install and personalize.** After an explicit non-empty selection, show the exact resources and prerequisite capabilities that will be installed, ask for confirmation, end the turn, and wait. Install only after that confirmation arrives in a later turn. For “all”, install every recommendation that does not require an unapproved external permission. A missing external permission must not block independent bundled resources; report the external item as pending and give the user the exact retry command. For custom selection, install only selected items and their declared dependencies. Personalize resources only when project evidence materially changes their instructions (for example, test commands, workspace/module layout, framework patterns, or architectural boundaries). Preserve existing files and secrets; report conflicts rather than overwriting. MCP setup must use the selected host's supported project-level configuration, preserve existing configuration, use environment-variable references for secrets, and request separate approval for permissions or external execution.
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
- **AIINIT-012:** Recommendations are displayed in concise tables grouped by category, and each item has a project-specific reason and supporting evidence before selection.
- **AIINIT-006:** The selection UI offers install-all, custom, and none; custom selections can choose individual items by skills, rules, agents, hooks, templates, and MCPs.
- **AIINIT-007:** Installation activates only selected resources and required dependencies, personalizes only context-sensitive content, and preserves unowned or edited files.
- **AIINIT-008:** MCP setup is target-aware, merges safely with existing configuration, never stores literal secrets, and requires separate permission approval.
- **AIINIT-009:** Completion lists changes and recommends a session restart/reload to discover installed resources.
- **AIINIT-010:** CLI tests cover mixed-stack monorepos, all/custom/none selection, permission gating, MCP config merging, personalization, conflicts, and completion output.
- **AIINIT-011:** Custom selections can choose individual resource references by block, while `--select=all` selects every recommended capability and `--select=` selects none.
- **AIINIT-013:** Sync previews exact additions, updates, preserved files, conflicts, and external permissions without writing; apply is bound to the approved plan fingerprint and is transactional. External skills and MCP actions require separate approvals, so network denial cannot partially apply local resources.
- **AIINIT-014:** The bootstrap pauses the agent turn at the model choice, recommendation selection, and final install confirmation; no scan or install proceeds from silence, ambiguity, cancellation, or a default/preselected choice.
- **AIINIT-015:** Every applicable SDD stage has a mandatory human approval checkpoint before the next stage; automated quality gates are explicitly distinct from human approval, and the agent must stop the turn until an explicit decision arrives.
- **AIINIT-016:** A versioned per-workflow approval ledger binds each human decision to the exact evidence fingerprint, blocks out-of-order commands, invalidates downstream approvals when evidence changes, and explains the next action in workflow status.

## Delivery slices

1. Bootstrap orchestration, host-native selection, model-cost prompt, and completion/reload guidance.
2. Deterministic monorepo profiles, stack-specific capability recommendations, resource-level selection, and context-aware sync.
3. MCP catalog provenance, per-target project configuration/merge support, credential placeholders, ownership, and config validation.

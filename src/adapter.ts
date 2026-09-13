import { join } from "node:path";
import { TARGETS, type Target, type FileSystem } from "./types.js";
import { getAdapterCapabilities } from "./adapter-contract.js";
import type { ResourceType } from "./package-contract.js";
import { describeCodexResource } from "./codex-layout.js";
import { describeClaudeResource } from "./claude-layout.js";
import { describeCursorResource } from "./cursor-layout.js";
import { describeGeminiResource } from "./gemini-layout.js";
import { describeCopilotResource } from "./copilot-layout.js";
import { describeUniversalResource } from "./universal-layout.js";
export function isTarget(value: string): value is Target {
  return TARGETS.includes(value as Target);
}

export function detectTarget(root: string, fs: FileSystem): Target | undefined {
  const markers: Array<[Target, string]> = [
    ["codex", ".agents"],
    ["claude", ".claude"],
    ["cursor", ".cursor"],
    ["gemini", ".gemini"],
    ["copilot", ".github/copilot-instructions.md"],
  ];
  return markers.find(([, marker]) => fs.exists(join(root, marker)))?.[0];
}
export function generateAiInit(root: string, target: string, fs: FileSystem): void {
  if (!isTarget(target)) throw new Error(`Unsupported target: ${target}`);
  fs.write(join(root, renderAiInitPath(target)), renderAiInit(target));
}

export function renderAiInit(target: string): string {
  if (!isTarget(target)) throw new Error(`Unsupported target: ${target}`);
  getAdapterCapabilities(target);
  return `---
name: ai-init
description: Initialize AI Workflow and run its specification-driven development setup.
---

# AI Workflow Initialization

This skill is the bootstrap for AI Workflow. The installer intentionally installs only this skill and the provider-neutral project state. Do not copy or activate the full resource package automatically.

## First-run setup

### Mandatory interaction checkpoints

This setup is gated by explicit user replies. At every human decision, call the host's native blocking question widget/tool; do not replace it with a prose question when the widget is available. Use the selection widget for multi-select decisions. Leave every choice unselected by default. Do not continue, call tools, run commands, or change files while a widget is awaiting submission. Only its actual submitted response is consent; never answer your own question or infer consent from silence, ambiguity, cancellation, or a preselected value. If the host has no blocking question widget, ask one concise numbered question in chat, end the turn, and wait for an explicit reply in a later turn. This is an interaction requirement for the agent; the AI Workflow CLI cannot independently verify which UI produced an approval.

Use that widget for the model choice, confirmation of uncertain scan findings, all/custom/none recommendation selection, approval of the exact sync preview, external network or remote-skill consent, and each separate MCP configuration/execution/credential permission. For a single decision, offer explicit choices with no default; for “request changes,” “correct this finding,” or “other,” collect the user's free-text details in a follow-up widget before acting.

1. Before scanning, recommend that the user switch to a cheaper model. Use a blocking question widget with no default choice to offer “I switched; continue”, “Keep this model; continue”, or “Stop setup”; never change model settings yourself. Explain that analysis is read-only and optional resources will not be installed without their selection. Wait for and evaluate the widget’s explicit response. Do not launch analysis agents or run \`aiw scan\` until the widget returns an explicit continue choice. If the widget is dismissed or the reply is unclear, ask again with the widget and stop; proceed only after an explicit answer to continue (including an explicit choice to keep the current model).
2. Use the host's native subagent mechanism to launch these read-only analyses in parallel: (a) technologies, root and nested manifests, workspaces, and monorepo boundaries; (b) architecture, modules, entry points, and recurring code patterns; (c) tests, quality commands, CI, and developer tools. Keep the main agent as orchestrator. Wait for all results, verify important claims against cited project files, reconcile disagreements, and consolidate one evidence-backed project profile. Do not inspect secrets, ignored files, dependency directories such as \`node_modules\`, or generated output; inspect declared dependencies in project manifests. If subagents are unavailable, perform the same analyses directly and disclose the fallback.
3. Run \`npx --yes --package=@multileaf/ai-workflow -- aiw scan\` and read \`.aiw/profile.yml\`. Treat this deterministic scan as another evidence source, not as a replacement for workspace-level analysis. Summarize each workspace separately; do not assume root dependencies or commands apply to every module. Ask the user to confirm uncertain or conflicting facts before using them as project policy. Add confirmed architecture and recurring patterns to the matching entries in the \`project_modules\` JSON array in \`.aiw/profile.yml\`, including file-path evidence; create a root-level entry when only the root project exists. Preserve existing detected fields and never store secrets or source-code excerpts there.
4. Run \`npx --yes --package=@multileaf/ai-workflow -- aiw recommend\` and read \`.aiw/recommendations.yml\`. Combine catalog results with the consolidated project profile. Recommend matching skills, rules, agents, hooks, templates, and MCP servers. For every MCP, disclose its publisher/source, purpose, capabilities, permissions, transport, and credential needs; verify them against current official host and server documentation. Recommend only integrations supported by project evidence and never invent credentials.
5. Present recommendations as concise tables grouped by category: skills, rules, agents, hooks, templates, and MCPs. Include one row per recommended item and columns for the item, a short project-specific reason for the recommendation, and relevant evidence. For MCP rows, also summarize purpose, source, permissions, transport, and credential needs (use a separate table if needed). Do not show a flat list without category headings or generic reasons such as “useful for this project.” After the tables, use the host's native selection widget to offer three explicit choices: install all recommendations, customize, or install none. The widget must start with no choice selected; never accept a default or preselected value as the user's answer. If the user customizes, show selectable category blocks and individual items, keeping each item's short reason and declared prerequisites visible. Read \`requires\` from \`.aiw/recommendations.yml\`; explain that choosing a stage auto-selects its prerequisite capabilities and their resources. If the host lacks a multi-select widget, ask a numbered all/custom/none question and stop the turn to wait for the reply. Do not run a selection command or install anything until a reply/explicit widget submission arrives in a later turn. A dismissed widget, empty answer, silence, or ambiguous answer means no consent; ask again or stop without installing. MCP selection does not grant permission to execute the server or use external access; ask separately for those permissions.
6. Only after receiving the user's explicit all/custom/none choice, record it: use \`npx --yes --package=@multileaf/ai-workflow -- aiw recommend --select=all\` for an explicit all choice; for customized item-level choices, pass only the selected resource references such as \`skills/verification,rules/tdd-policy,agents/test-engineer\`; use \`npx --yes --package=@multileaf/ai-workflow -- aiw recommend --select=\` for an explicit none choice. Before syncing a non-empty selection, show the exact selected resources and their prerequisites. Run \`npx --yes --package=@multileaf/ai-workflow -- aiw sync --preview\` and show the complete plan, including additions, updates, preserved files, conflicts, and any external permissions. Use the blocking question widget to approve this exact plan, request changes, or cancel. Run sync only after that confirmation arrives from an explicit widget submission. Only after a later explicit approval, rerun preview if selection or project files changed, then run \`npx --yes --package=@multileaf/ai-workflow -- aiw sync --approve-plan=<fingerprint>\` using the fingerprint from the approved preview. A changed plan or conflict must stop without writes. Remote skills are not installed by sync: ask separately for network access and installation approval, then use \`npx --yes --package=@multileaf/ai-workflow -- aiw skills install --source=vercel-labs/agent-skills --skill=vercel-react-best-practices --allow=network:external\`. MCP configuration, server execution, and credentials each require separate consent. Install only confirmed selected resources and declared dependencies. Tailor instructions only where project evidence changes their usefulness (such as test commands, workspace boundaries, framework patterns, or module architecture). Preserve existing files, configuration, and secrets; report conflicts rather than overwriting them.
7. For selected MCPs, add only the selected servers to the host's supported project configuration. Check current official host and server documentation for the configuration format, merge existing settings without replacing unrelated entries, and use environment-variable references instead of literal credentials. Do not run server install/start/authentication commands without separate approval. If the target requires user-level changes or safe configuration cannot be validated, give the user exact manual steps and report the MCP as pending rather than installed.
8. Report installed resources by block, project-specific changes, skipped recommendations, MCP trust/authentication steps, and conflicts. Recommend restarting or reloading the coding-agent session so it discovers newly installed resources; follow known host behavior if it reloads changes automatically. Introduce only the gates supported by installed resources: brainstorming → specification → architecture decision when needed → implementation plan → implementation with tests → verification → code review → traceability.

If the user declines all recommendations, leave the project with only the bootstrap skill and scan state. Do not treat scanning or recommendation as consent to install.

## For each feature request after setup

### Mandatory human gates between stages

At every stage gate, use the host's native blocking question widget and present the exact evidence with these unselected choices: “Approve and continue”, “Request changes”, and “Reject/stop”. For optional brainstorming or technical-design skips, use a separate widget with “Accept this skip” and “Do not skip”; collect the reason before recording an accepted skip. Do not run \`aiw approve\`, \`aiw reject\`, or \`aiw skip\` until the relevant widget has returned an explicit submission. A request for changes must collect the feedback in a follow-up question widget, record rejection, then revise and rerun the gate. If no blocking question widget exists, use a numbered chat prompt and end the turn until an explicit reply arrives. A widget submission is the agent's required interaction signal; the CLI cannot prove the widget was used.

For every CLI command below, use \`npx --yes --package=@multileaf/ai-workflow -- aiw <command>\`; do not assume a global \`aiw\` binary exists. Start each feature request with \`npx --yes --package=@multileaf/ai-workflow -- aiw workflow start\` and check progress with \`npx --yes --package=@multileaf/ai-workflow -- aiw workflow status\`. Complete it with \`npx --yes --package=@multileaf/ai-workflow -- aiw workflow complete\` only after all stages resolve. The \`aiw gate <stage>\` command checks evidence and records a pending review; a passing result is not human approval. At every stage boundary—brainstorming, specification, technical design, plan, implementation, verification, code review, and traceability—present the exact artifact/evidence, ask using the blocking question widget and wait for its explicit submission before proceeding; end the turn only when the widget is unavailable. On approval, record it with \`npx --yes --package=@multileaf/ai-workflow -- aiw approve <stage>\`; if the user asks for changes, record the rejection first with \`npx --yes --package=@multileaf/ai-workflow -- aiw reject <stage> --reason=<feedback>\`, then revise and rerun the gate. Do not invoke the next skill, create its scaffold, run its commands, or edit its artifacts before approval is recorded or the pending stage is rejected. Silence, an ambiguous reply, an automated gate pass, or earlier approval never counts. Brainstorming and technical design may be skipped only after explaining why and receiving explicit human acceptance; record each skip with \`npx --yes --package=@multileaf/ai-workflow -- aiw skip <stage> --reason=<accepted reason>\`.

- Use the brainstorming skill when scope, users, constraints, or assumptions are unclear; create its artifact with \`npx --yes --package=@multileaf/ai-workflow -- aiw brainstorm\`, validate it with \`npx --yes --package=@multileaf/ai-workflow -- aiw gate brainstorming\`, present it, wait, then record the reply with \`npx --yes --package=@multileaf/ai-workflow -- aiw approve brainstorming\` before specification. If unnecessary, ask to skip and record explicit acceptance with \`npx --yes --package=@multileaf/ai-workflow -- aiw skip brainstorming --reason=...\`.
- Create a specification with stable requirement IDs and Given/When/Then acceptance criteria; pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate specification\`, present it, wait, and record approval before design or planning.
- For changes with architecture impact, write \`.aiw/generated/reports/technical-design.md\` using the technical-design template, record consequential choices as ADRs, pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate technical-design\`, and obtain/record approval before planning. If design is unnecessary, obtain explicit acceptance and record a reasoned skip. Then create an implementation plan with \`npx --yes --package=@multileaf/ai-workflow -- aiw plan\`, pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate plan\`, present it, wait, and record approval before coding.
- When TDD resources are installed and the project has a test workflow, follow the TDD policy; otherwise use the project's existing validation methods. Follow installed project quality rules and use specialist agents only when useful. After implementation, write \`.aiw/generated/reports/implementation-report.md\` with changed files, tests, validation, and deviations; pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate implementation\`, present the diff/evidence, wait, and record approval before verification.
- Run declared checks, write \`.aiw/generated/reports/verification-report.md\`, pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate verification\`, run \`npx --yes --package=@multileaf/ai-workflow -- aiw verify\`, present results, wait, and record approval before review. Write \`.aiw/generated/reports/code-review.md\` with findings/checks/risks/decision, pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate review\`, present findings, wait, and record approval before \`npx --yes --package=@multileaf/ai-workflow -- aiw trace\`. Pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate traceability\`, present the final graph, wait, record approval, then complete the workflow. Do not claim completion without evidence.

## Language policy

All generated AI Workflow artifacts must be written in English unless the user explicitly requests another language.
`;
}

export function renderAiInitPath(target: Target): string {
  const paths: Record<Target, string> = {
    codex: ".agents/skills/ai-init/SKILL.md",
    claude: ".claude/skills/ai-init/SKILL.md",
    cursor: ".cursor/skills/ai-init/SKILL.md",
    gemini: ".gemini/skills/ai-init/SKILL.md",
    copilot: ".github/copilot-instructions.md",
    universal: ".aiw/resources/skills/ai-init.md",
  };
  return paths[target];
}

export function renderResourcePath(target: Target, type: ResourceType, id: string): string {
  return describeResource(target, type, id).path;
}

export type AdapterResourceType = ResourceType | "context";
export type AdapterSupport = "native" | "compatibility" | "fallback";
export type AdapterResourceDescriptor = { path: string; support: AdapterSupport };

export function describeResource(
  target: Target,
  type: AdapterResourceType,
  id: string,
): AdapterResourceDescriptor {
  if (!isTarget(target))
    throw new Error(`Adapter rendering is not implemented for target: ${target}`);
  if (target === "codex") return describeCodexResource(type, id);
  if (target === "claude") return describeClaudeResource(type, id);
  if (target === "cursor") return describeCursorResource(type, id);
  if (target === "gemini") return describeGeminiResource(type, id);
  if (target === "copilot") return describeCopilotResource(type, id);
  return describeUniversalResource(type, id);
}

export function renderCodexResource(
  type: ResourceType,
  id: string,
  content: string,
  root: string,
  fs: FileSystem,
): string {
  const path = renderResourcePath("codex", type, id);
  fs.write(join(root, path), content);
  return path;
}

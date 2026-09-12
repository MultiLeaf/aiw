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

1. Before scanning, recommend that the user switch to a cheaper model for this onboarding. Ask whether they switched or prefer to continue with the current model; never change model settings yourself. Explain that analysis is read-only and optional resources will not be installed without their selection.
2. Use the host's native subagent mechanism to launch these read-only analyses in parallel: (a) technologies, root and nested manifests, workspaces, and monorepo boundaries; (b) architecture, modules, entry points, and recurring code patterns; (c) tests, quality commands, CI, and developer tools. Keep the main agent as orchestrator. Wait for all results, verify important claims against cited project files, reconcile disagreements, and consolidate one evidence-backed project profile. Do not inspect secrets, ignored files, dependency directories such as \`node_modules\`, or generated output; inspect declared dependencies in project manifests. If subagents are unavailable, perform the same analyses directly and disclose the fallback.
3. Run \`npx --yes --package=@multileaf/ai-workflow -- aiw scan\` and read \`.aiw/profile.yml\`. Treat this deterministic scan as another evidence source, not as a replacement for workspace-level analysis. Summarize each workspace separately; do not assume root dependencies or commands apply to every module. Ask the user to confirm uncertain or conflicting facts before using them as project policy. Add confirmed architecture and recurring patterns to the matching entries in the \`project_modules\` JSON array in \`.aiw/profile.yml\`, including file-path evidence; create a root-level entry when only the root project exists. Preserve existing detected fields and never store secrets or source-code excerpts there.
4. Run \`npx --yes --package=@multileaf/ai-workflow -- aiw recommend\` and read \`.aiw/recommendations.yml\`. Combine catalog results with the consolidated project profile. Recommend matching skills, rules, agents, hooks, templates, and MCP servers. For every MCP, disclose its publisher/source, purpose, capabilities, permissions, transport, and credential needs; verify them against current official host and server documentation. Recommend only integrations supported by project evidence and never invent credentials.
5. Present recommendations as concise tables grouped by category: skills, rules, agents, hooks, templates, and MCPs. Include one row per recommended item and columns for the item, a short project-specific reason for the recommendation, and relevant evidence. For MCP rows, also summarize purpose, source, permissions, transport, and credential needs (use a separate table if needed). Do not show a flat list without category headings or generic reasons such as “useful for this project.” After the tables, use the host's native selection widget to offer three choices: install all recommendations, customize, or install none. If the user customizes, show selectable category blocks and individual items, keeping each item's short reason and declared prerequisites visible. Read \`requires\` from \`.aiw/recommendations.yml\`; explain that choosing a stage auto-selects its prerequisite capabilities and their resources. If the host lacks a multi-select widget, use a numbered all/custom/none prompt and grouped checklists. MCP selection does not grant permission to execute the server or use external access; ask separately for those permissions.
6. Record all recommendations with \`npx --yes --package=@multileaf/ai-workflow -- aiw recommend --select=all\`; for customized item-level choices, pass the selected resource references such as \`skills/verification,rules/tdd-policy,agents/test-engineer\`. Use \`npx --yes --package=@multileaf/ai-workflow -- aiw recommend --select=\` when none are chosen. If any AI Workflow resources are selected, run \`npx --yes --package=@multileaf/ai-workflow -- aiw sync\` without extra permissions first. It installs selected bundled resources and reports any external resource that is still pending approval. Only if the user separately approves external access, rerun with \`--allow=network:external\` to install that pending external resource. Install only selected resources and declared dependencies. Tailor instructions only where project evidence changes their usefulness (such as test commands, workspace boundaries, framework patterns, or module architecture). Preserve existing files, configuration, and secrets; report conflicts rather than overwriting them.
7. For selected MCPs, add only the selected servers to the host's supported project configuration. Check current official host and server documentation for the configuration format, merge existing settings without replacing unrelated entries, and use environment-variable references instead of literal credentials. Do not run server install/start/authentication commands without separate approval. If the target requires user-level changes or safe configuration cannot be validated, give the user exact manual steps and report the MCP as pending rather than installed.
8. Report installed resources by block, project-specific changes, skipped recommendations, MCP trust/authentication steps, and conflicts. Recommend restarting or reloading the coding-agent session so it discovers newly installed resources; follow known host behavior if it reloads changes automatically. Introduce only the gates supported by installed resources: brainstorming → specification → architecture decision when needed → implementation plan → implementation with tests → verification → traceability → review.

If the user declines all recommendations, leave the project with only the bootstrap skill and scan state. Do not treat scanning or recommendation as consent to install.

## For each feature request after setup

- Use the brainstorming skill when scope, users, constraints, or assumptions are unclear; create its artifact with \`npx --yes --package=@multileaf/ai-workflow -- aiw brainstorm\`, then validate it with \`npx --yes --package=@multileaf/ai-workflow -- aiw gate brainstorming\`.
- Create a specification with stable requirement IDs and Given/When/Then acceptance criteria; pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate specification\` before planning.
- For changes with architecture impact, use technical design, record consequential choices as ADRs with \`npx --yes --package=@multileaf/ai-workflow -- aiw adr\`, and link those decisions to the requirements. Then create an implementation plan with \`npx --yes --package=@multileaf/ai-workflow -- aiw plan\`, linking tasks to requirements, tests, risks, and validation commands; pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate plan\` before coding.
- When TDD resources are installed and the project has a test workflow, follow the TDD policy; otherwise use the project's existing validation methods. Follow installed project quality rules and use specialist agents only when they are installed and useful.
- Run the declared checks, write \`.aiw/generated/reports/verification-report.md\` using the verification-report template, and pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate verification\`. Then run \`npx --yes --package=@multileaf/ai-workflow -- aiw verify\` and \`npx --yes --package=@multileaf/ai-workflow -- aiw trace\`. Use the code-review skill when installed and record its findings; AI Workflow does not provide a separate review gate. Do not claim completion without evidence.

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

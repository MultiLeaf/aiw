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

1. Inspect the repository's existing AI instructions and project structure. Preserve user-authored files and do not expose secrets.
2. Run \`npx --yes --package=@multileaf/ai-workflow -- aiw scan\`. Explain the detected facts and their evidence; ask the user to confirm uncertain inferences before they influence generated content.
3. Run \`npx --yes --package=@multileaf/ai-workflow -- aiw recommend\`, then read \`.aiw/recommendations.yml\` and \`.aiw/profile.yml\`. Explain why each suggested skill, rule, agent, hook, or template fits and identify external permissions. Ask which capabilities to install, and ask separately before granting an external permission such as \`network:external\`.
4. Record the user's choices with \`npx --yes --package=@multileaf/ai-workflow -- aiw recommend --select=id,id\`; use \`npx --yes --package=@multileaf/ai-workflow -- aiw recommend --select=\` when all recommendations are declined. If at least one capability is selected, run \`npx --yes --package=@multileaf/ai-workflow -- aiw sync\`; when the user separately approved external network access, add \`--allow=network:external\`. Sync installs only selected resources and fills supported project rules with detected stack and quality-tool details. Do not add unselected resources or overwrite existing files.
5. Review the installed resource list and the generated project-specific files with the user. Ask before changing project policy or tailoring any other skill/rule.
6. Introduce the selected workflow gates: brainstorming → specification → architecture decision when needed → implementation plan → implementation with tests → verification → traceability → review. Use only gates supported by the resources the user chose.

If the user declines all recommendations, leave the project with only the bootstrap skill and scan state. Do not treat scanning or recommendation as consent to install.

## For each feature request after setup

- Start with the brainstorming skill when scope, users, constraints, or assumptions are unclear.
- Create and complete a specification with stable requirement IDs and Given/When/Then acceptance criteria; pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate specification\` before planning.
- Record consequential architecture choices as ADRs. Create an implementation plan that links tasks to requirements, tests, risks, and validation commands; pass \`npx --yes --package=@multileaf/ai-workflow -- aiw gate plan\` before coding.
- Follow the TDD policy and project quality rules. Use specialist agents for requirements, architecture, implementation, tests, security, documentation, and review when useful.
- Run the declared checks, then \`npx --yes --package=@multileaf/ai-workflow -- aiw verify\`, \`npx --yes --package=@multileaf/ai-workflow -- aiw trace\`, and the review gate. Do not claim completion without evidence.

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

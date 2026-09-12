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

Set up the repository's AI-assisted development workflow. Do not stop after scanning or writing configuration: activate the installed skills, rules, agents, hooks, and templates, then guide the user through the project gates.

Analyze the repository safely, confirm uncertain facts, and recommend project-specific capabilities.

## First-run setup

1. Inspect the repository and existing AI instructions. Preserve user-authored files and ask before replacing conflicts.
2. Run \`aiw scan\` and review detected facts and evidence. Confirm uncertain inferences with the user before treating them as project policy.
3. Run \`aiw recommend\`. Explain each recommendation and its permissions, then install only the capabilities the user selects. Do not approve network or shell permissions implicitly.
4. Run \`aiw sync\` to generate the selected project-specific resources. Resolve drift or conflicts with the user instead of overwriting them.
5. Show the available workflow resources and explain how to use them: brainstorming → specification → architecture decision when needed → implementation plan → implementation with tests → verification → traceability → review.
6. Before advancing each stage, run its matching \`aiw gate <stage>\`. Record validation evidence with \`aiw verify\` and link requirements, decisions, tasks, code, tests, and evidence with \`aiw trace\`.

## For each feature request

- Start with the brainstorming skill when scope, users, constraints, or assumptions are unclear.
- Create and complete a specification with stable requirement IDs and Given/When/Then acceptance criteria; pass \`aiw gate specification\` before planning.
- Record consequential architecture choices as ADRs. Create an implementation plan that links tasks to requirements, tests, risks, and validation commands; pass \`aiw gate plan\` before coding.
- Follow the TDD policy and project quality rules. Use specialist agents for requirements, architecture, implementation, tests, security, documentation, and review when useful.
- Run the declared checks, then \`aiw verify\`, \`aiw trace\`, and the review gate. Do not claim completion without evidence.

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

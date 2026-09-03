import type { AdapterResourceType, AdapterSupport } from "../adapter.js";
import type { Target } from "../types.js";

export type AdapterContractFixture = {
  target: Target;
  resources: Record<AdapterResourceType, { path: string; support: AdapterSupport }>;
};

export const ADAPTER_CONTRACT_FIXTURES: AdapterContractFixture[] = [
  {
    target: "codex",
    resources: {
      skills: { path: ".agents/skills/example/SKILL.md", support: "native" },
      rules: { path: ".agents/rules/example/example.md", support: "compatibility" },
      agents: { path: ".agents/agents/example/example.md", support: "compatibility" },
      hooks: { path: ".agents/hooks/example/example.md", support: "compatibility" },
      templates: { path: ".agents/templates/example/example.md", support: "compatibility" },
      context: { path: "AGENTS.md", support: "native" },
    },
  },
  {
    target: "claude",
    resources: {
      skills: { path: ".claude/skills/example/SKILL.md", support: "native" },
      rules: { path: ".claude/rules/example.md", support: "native" },
      agents: { path: ".claude/agents/example.md", support: "native" },
      hooks: { path: ".claude/aiw/hooks/example.md", support: "compatibility" },
      templates: { path: ".claude/aiw/templates/example.md", support: "compatibility" },
      context: { path: "CLAUDE.md", support: "native" },
    },
  },
  {
    target: "cursor",
    resources: {
      skills: { path: ".cursor/skills/example/SKILL.md", support: "compatibility" },
      rules: { path: ".cursor/rules/example.mdc", support: "native" },
      agents: { path: ".cursor/aiw/agents/example.md", support: "compatibility" },
      hooks: { path: ".cursor/aiw/hooks/example.md", support: "compatibility" },
      templates: { path: ".cursor/aiw/templates/example.md", support: "compatibility" },
      context: { path: "AGENTS.md", support: "native" },
    },
  },
  {
    target: "gemini",
    resources: {
      skills: { path: ".gemini/skills/example/SKILL.md", support: "native" },
      rules: { path: ".gemini/aiw/rules/example.md", support: "compatibility" },
      agents: { path: ".gemini/agents/example.md", support: "native" },
      hooks: { path: ".gemini/aiw/hooks/example.md", support: "compatibility" },
      templates: { path: ".gemini/aiw/templates/example.md", support: "compatibility" },
      context: { path: "GEMINI.md", support: "native" },
    },
  },
  {
    target: "copilot",
    resources: {
      skills: { path: ".github/skills/example/SKILL.md", support: "native" },
      rules: { path: ".github/instructions/example.instructions.md", support: "native" },
      agents: { path: ".github/agents/example.md", support: "native" },
      hooks: { path: ".github/aiw/hooks/example.md", support: "compatibility" },
      templates: { path: ".github/aiw/templates/example.md", support: "compatibility" },
      context: { path: ".github/copilot-instructions.md", support: "native" },
    },
  },
  {
    target: "universal",
    resources: {
      skills: { path: ".aiw/resources/skills/example/SKILL.md", support: "fallback" },
      rules: { path: ".aiw/resources/rules/example/example.md", support: "fallback" },
      agents: { path: ".aiw/resources/agents/example/example.md", support: "fallback" },
      hooks: { path: ".aiw/resources/hooks/example/example.md", support: "fallback" },
      templates: { path: ".aiw/resources/templates/example/example.md", support: "fallback" },
      context: { path: ".aiw/resources/context/example/example.md", support: "fallback" },
    },
  },
];

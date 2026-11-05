import type { ProjectProfile } from "./profile.js";
import type { ProposalRecord } from "./eval/types.js";
import { resolveGeneratedPath } from "./drift.js";

export type ResourceWriter = (path: string, content: string) => void;

export function generateProjectResources(
  profile: ProjectProfile,
  selected: string[],
  write: ResourceWriter,
): void {
  const linterCommand = safeInlineValue(profile.quality.linter?.command);
  const formatterCommand = safeInlineValue(profile.quality.formatter?.command);
  const testCommands = [
    ...(profile.testing?.command ? [{ scope: "project", command: profile.testing.command }] : []),
    ...(profile.modules ?? []).flatMap((module) =>
      module.testing?.command
        ? [{ scope: `workspace ${module.path}`, command: module.testing.command }]
        : [],
    ),
  ].map(({ scope, command }) => ({ scope, command: safeInlineValue(command) }));
  const uniqueTestCommands = [
    ...new Map(
      testCommands
        .filter(({ command }) => command)
        .map(({ scope, command }) => [`${scope}:${command}`, { scope, command }]),
    ).values(),
  ];
  if (selected.includes("typescript-quality") || selected.includes("rules/project-quality"))
    write(
      resolveGeneratedPath("rules/project-quality.md"),
      `# Project Quality Rules\n\n- Use ${profile.runtime.languages.map((language) => (language === "typescript" ? "TypeScript" : language)).join(", ")} with strict typing.\n${linterCommand ? `- Run \`${linterCommand}\` before completion.\n` : ""}${formatterCommand ? `- Run \`${formatterCommand}\` before review.\n` : ""}- Keep all generated AI Workflow artifacts in English.\n`,
    );
  if (selected.includes("tdd-development") || selected.includes("rules/tdd-project-policy"))
    write(
      resolveGeneratedPath("rules/tdd-project-policy.md"),
      `# TDD Project Policy\n\n${uniqueTestCommands.map(({ scope, command }) => `- Run the ${scope} test command \`${command}\` for verification.`).join("\n")}${uniqueTestCommands.length ? "\n" : ""}- Write a failing behavioral test before implementation.\n- Refactor only after the test is green.\n`,
    );
  if (
    selected.includes("nextjs-development") ||
    selected.includes("react-best-practices") ||
    selected.includes("rules/architecture-policy")
  )
    write(
      resolveGeneratedPath("agents/project-context.md"),
      `# Project Context\n\nThis project uses ${profile.frameworks.map((framework) => (framework === "nextjs" ? "Next.js" : framework)).join(", ")}. Follow the detected project structure and existing framework conventions.\n`,
    );
  if (selected.length > 0) {
    write(
      resolveGeneratedPath("context/project-profile.md"),
      `# Confirmed Project Profile\n\n- Languages: ${profile.runtime.languages.join(", ") || "none detected"}\n- Frameworks: ${profile.frameworks.join(", ") || "none detected"}\n- Package manager: ${profile.packageManager}\n- All generated content is in English.\n`,
    );
    write(
      resolveGeneratedPath("context/root-context.md"),
      `# AI Workflow Project Context\n\nThis repository is managed by AI Workflow (\`.aiw/\` holds the neutral project state).\n\n- Languages: ${profile.runtime.languages.join(", ") || "none detected"}\n- Frameworks: ${profile.frameworks.join(", ") || "none detected"}\n- Package manager: ${profile.packageManager}${linterCommand ? `\n- Lint: \`${linterCommand}\`` : ""}${formatterCommand ? `\n- Format: \`${formatterCommand}\`` : ""}${uniqueTestCommands.map(({ scope, command }) => `\n- Tests (${scope}): \`${command}\``).join("")}\n\nBefore completing changes, run the project quality commands listed above. Follow installed AI Workflow skills, rules, and agents; the confirmed profile lives in \`.aiw/profile.yml\` and workflow evidence in \`.aiw/checkpoints/\`.\n\n## Context recovery (managed by AI Workflow)\n\nAfter any context compaction, reset, resume, or handoff: run \`aiw task status\`, read the stage artifacts this workflow declares under \`.aiw/generated/\`, and do not rely on compacted chat as the source of project state.\n`,
    );
    write(
      resolveGeneratedPath("hooks/quality-check.md"),
      `# Quality Check Hook\n\nRun the available project quality commands before completion.${linterCommand ? `\n\n- Linter: \`${linterCommand}\`` : ""}${formatterCommand ? `\n- Formatter: \`${formatterCommand}\`` : ""}${uniqueTestCommands.map(({ scope, command }) => `\n- ${scope} tests: \`${command}\``).join("")}\n`,
    );
  }
}

function safeInlineValue(value: string | undefined): string | undefined {
  return value
    ?.split("")
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "`"
        ? " "
        : character,
    )
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

/**
 * Materialize an approved evaluator proposal as a project-local resource with
 * provenance frontmatter. Only the approve path may call this (REQ-004);
 * output is always under generated/ via resolveGeneratedPath (REQ-006).
 */
export function generateProposalResource(proposal: ProposalRecord, write: ResourceWriter): void {
  if (proposal.status !== "approved")
    throw new Error(
      `Refusing to materialize proposal ${proposal.id}: only approved proposals can be materialized (status: ${proposal.status})`,
    );
  const directory = `${proposal.kind}s`;
  write(
    resolveGeneratedPath(`${directory}/${proposal.signature}.md`),
    [
      "---",
      "provenance: aiw-evaluator",
      `proposal: ${proposal.id}`,
      "---",
      "",
      `# ${proposal.title}`,
      "",
      proposal.outline,
      "",
    ].join("\n"),
  );
}

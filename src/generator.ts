import type { ProjectProfile } from "./profile.js";
import { resolveGeneratedPath } from "./drift.js";

export type ResourceWriter = (path: string, content: string) => void;

export function generateProjectResources(
  profile: ProjectProfile,
  selected: string[],
  write: ResourceWriter,
): void {
  const linterCommand = profile.quality.linter?.command;
  const formatterCommand = profile.quality.formatter?.command;
  const testCommand = profile.testing?.command;
  if (selected.includes("typescript-quality"))
    write(
      resolveGeneratedPath("rules/project-quality.md"),
      `# Project Quality Rules\n\n- Use ${profile.runtime.languages.map((language) => (language === "typescript" ? "TypeScript" : language)).join(", ")} with strict typing.\n${linterCommand ? `- Run \`${linterCommand}\` before completion.\n` : ""}${formatterCommand ? `- Run \`${formatterCommand}\` before review.\n` : ""}- Keep all generated AI Workflow artifacts in English.\n`,
    );
  if (selected.includes("tdd-development"))
    write(
      resolveGeneratedPath("rules/tdd-project-policy.md"),
      `# TDD Project Policy\n\n${testCommand ? `- Run \`${testCommand}\` for verification.\n` : ""}- Write a failing behavioral test before implementation.\n- Refactor only after the test is green.\n`,
    );
  if (selected.includes("nextjs-development") || selected.includes("react-best-practices"))
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
      resolveGeneratedPath("hooks/quality-check.md"),
      `# Quality Check Hook\n\nRun the available project quality commands before completion.${linterCommand ? `\n\n- Linter: \`${linterCommand}\`` : ""}${formatterCommand ? `\n- Formatter: \`${formatterCommand}\`` : ""}${testCommand ? `\n- Tests: \`${testCommand}\`` : ""}\n`,
    );
  }
}

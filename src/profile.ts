import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanProject } from "./scanner.js";
import { buildFacts, type EvidenceFact } from "./evidence.js";

export type Tool = { name: string; command?: string };
export type ProjectProfile = {
  runtime: { languages: string[] };
  frameworks: string[];
  packageManager: string;
  quality: { linter?: Tool; formatter?: Tool; typecheck?: Tool };
  testing?: Tool;
  ci: string[];
  workspaces: string[];
  facts: EvidenceFact[];
};

function scalar(content: string, key: string): string | undefined {
  const value = content.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
  return value && value !== "unknown" ? value : undefined;
}

function list(content: string, key: string): string[] {
  const value = content.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]$`, "m"))?.[1] ?? "";
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseProjectProfile(content: string): ProjectProfile {
  if (!/^status:\s*scanned$/m.test(content))
    throw new Error("Project profile has not been scanned.");
  const languages = list(content, "  languages");
  const frameworks = list(content, "frameworks");
  let packageManager = scalar(content, "package_manager") ?? "unknown";
  const confirmed = [
    ...content.matchAll(/\s{2}- key: ([^\n]+)\n\s{4}value: ([^\n]+)\n\s{4}state: confirmed/g),
  ];
  for (const match of confirmed) {
    const key = match[1].trim();
    const value = match[2].trim();
    if (key === "package-manager") packageManager = value;
    if (key === "runtime.language" && !languages.includes(value)) languages.push(value);
    if (key === "framework" && !frameworks.includes(value)) frameworks.push(value);
  }
  const tool = (name: string, command: string): Tool | undefined => {
    const toolName = scalar(content, name);
    return toolName ? { name: toolName, command: scalar(content, command) } : undefined;
  };
  return {
    runtime: { languages },
    frameworks,
    packageManager,
    quality: {
      linter: tool("linter", "linter_command"),
      formatter: tool("formatter", "formatter_command"),
      typecheck: tool("typecheck", "typecheck_command"),
    },
    testing: tool("testing", "testing_command"),
    ci: list(content, "ci"),
    workspaces: list(content, "workspaces"),
    facts: [],
  };
}

type PackageManifest = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

async function packageManifest(root: string): Promise<PackageManifest> {
  try {
    return JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageManifest;
  } catch {
    return {};
  }
}

function hasDependency(manifest: PackageManifest, name: string): boolean {
  return Boolean(manifest.dependencies?.[name] || manifest.devDependencies?.[name]);
}
function commandFor(manifest: PackageManifest, key: string): string | undefined {
  return manifest.scripts?.[key];
}

export async function profileProject(root: string): Promise<ProjectProfile> {
  const scan = await scanProject(root);
  const manifest = await packageManifest(root);
  const files = scan.files;
  const languages = [
    ...new Set(
      scan.evidence
        .filter((item) => item.fact.startsWith("language."))
        .map((item) => item.fact.replace("language.", "")),
    ),
  ];
  const frameworks = [
    hasDependency(manifest, "next") ? "nextjs" : "",
    hasDependency(manifest, "react") ? "react" : "",
    hasDependency(manifest, "vue") ? "vue" : "",
    hasDependency(manifest, "express") ? "express" : "",
  ].filter(Boolean);
  const packageManager = files.includes("pnpm-lock.yaml")
    ? "pnpm"
    : files.includes("yarn.lock")
      ? "yarn"
      : files.includes("package.json")
        ? "npm"
        : "unknown";
  const linter =
    hasDependency(manifest, "eslint") ||
    files.some((file) => file.startsWith("eslint.config") || file === ".eslintrc.json")
      ? { name: "eslint", command: commandFor(manifest, "lint") }
      : undefined;
  const formatter =
    hasDependency(manifest, "prettier") || files.some((file) => file.startsWith("prettier"))
      ? { name: "prettier", command: commandFor(manifest, "format") }
      : undefined;
  const testingName = hasDependency(manifest, "vitest")
    ? "vitest"
    : hasDependency(manifest, "jest")
      ? "jest"
      : undefined;
  const workspaces = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);
  const profile: ProjectProfile = {
    runtime: { languages },
    frameworks,
    packageManager,
    quality: {
      linter,
      formatter,
      typecheck: commandFor(manifest, "typecheck")
        ? { name: "typescript", command: commandFor(manifest, "typecheck") }
        : undefined,
    },
    testing: testingName ? { name: testingName, command: commandFor(manifest, "test") } : undefined,
    ci: files.some((file) => file.startsWith(".github/workflows/")) ? ["github-actions"] : [],
    workspaces,
    facts: [],
  };
  profile.facts = buildFacts(profile, scan.evidence);
  return profile;
}

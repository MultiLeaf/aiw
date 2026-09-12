import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { scanProject } from "./scanner.js";
import { buildFacts, type EvidenceFact } from "./evidence.js";

export type Tool = { name: string; command?: string };
export type ProjectModule = {
  path: string;
  name?: string;
  runtime: { languages: string[] };
  frameworks: string[];
  packageManager: string;
  quality: { linter?: Tool; formatter?: Tool; typecheck?: Tool };
  testing?: Tool;
  architecture?: string[];
  patterns?: string[];
  evidence?: string[];
};
export type ProjectProfile = {
  runtime: { languages: string[] };
  frameworks: string[];
  packageManager: string;
  quality: { linter?: Tool; formatter?: Tool; typecheck?: Tool };
  testing?: Tool;
  ci: string[];
  workspaces: string[];
  modules?: ProjectModule[];
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
  let modules: ProjectModule[] = [];
  try {
    const parsed = JSON.parse(scalar(content, "project_modules") ?? "[]") as unknown;
    if (Array.isArray(parsed)) modules = parseModules(parsed);
  } catch {
    modules = [];
  }
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
    modules,
    facts: [],
  };
}

function parseModules(values: unknown[]): ProjectModule[] {
  return values.slice(0, 256).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.path !== "string" || !item.path.trim()) return [];
    const runtime =
      item.runtime && typeof item.runtime === "object"
        ? (item.runtime as Record<string, unknown>)
        : {};
    const quality =
      item.quality && typeof item.quality === "object"
        ? (item.quality as Record<string, unknown>)
        : {};
    const tool = (candidate: unknown): Tool | undefined => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
      const details = candidate as Record<string, unknown>;
      if (typeof details.name !== "string" || !details.name.trim()) return undefined;
      return {
        name: details.name.slice(0, 180),
        command: typeof details.command === "string" ? details.command.slice(0, 180) : undefined,
      };
    };
    return [
      {
        path: item.path.slice(0, 240),
        name: typeof item.name === "string" ? item.name.slice(0, 180) : undefined,
        runtime: { languages: stringArray(runtime.languages) },
        frameworks: stringArray(item.frameworks),
        packageManager:
          typeof item.packageManager === "string" ? item.packageManager.slice(0, 80) : "unknown",
        quality: {
          linter: tool(quality.linter),
          formatter: tool(quality.formatter),
          typecheck: tool(quality.typecheck),
        },
        testing: tool(item.testing),
        architecture: stringArray(item.architecture),
        patterns: stringArray(item.patterns),
        evidence: stringArray(item.evidence),
      },
    ];
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 32)
        .map((item) => item.slice(0, 240))
    : [];
}

type PackageManifest = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

async function packageManifest(root: string): Promise<PackageManifest> {
  return packageManifestFile(join(root, "package.json"));
}

async function packageManifestFile(path: string): Promise<PackageManifest> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
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
  const moduleManifests = files.filter((file) => /(^|\/)package\.json$/.test(file));
  const packageDirectories = moduleManifests.map((file) => dirname(file));
  const modules = await Promise.all(
    moduleManifests
      .filter((file) => dirname(file) !== ".")
      .map((file) =>
        profileModule(root, file, files, scan.evidence, undefined, packageDirectories),
      ),
  );
  const rootModule = await profileModule(
    root,
    "package.json",
    files,
    scan.evidence,
    manifest,
    packageDirectories,
  );
  const languages = [
    ...new Set([
      ...rootModule.runtime.languages,
      ...modules.flatMap((item) => item.runtime.languages),
    ]),
  ];
  const frameworks = [
    ...new Set([...rootModule.frameworks, ...modules.flatMap((item) => item.frameworks)]),
  ];
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
    modules,
    facts: [],
  };
  profile.facts = buildFacts(profile, scan.evidence);
  return profile;
}

async function profileModule(
  root: string,
  manifestPath: string,
  files: string[],
  evidence: Array<{ fact: string; source: string }>,
  existingManifest?: PackageManifest,
  packageDirectories: string[] = [],
): Promise<ProjectModule> {
  const manifest = existingManifest ?? (await packageManifestFile(join(root, manifestPath)));
  const modulePath =
    dirname(manifestPath) === "." ? "." : dirname(manifestPath).split("\\").join("/");
  const prefix = modulePath === "." ? "" : `${modulePath}/`;
  const childPrefixes = packageDirectories
    .filter((directory) => directory !== modulePath && directory.startsWith(prefix))
    .map((directory) => `${directory}/`);
  const moduleFiles = files.filter(
    (file) =>
      file.startsWith(prefix) && !childPrefixes.some((childPrefix) => file.startsWith(childPrefix)),
  );
  const languages = [
    ...new Set(
      evidence
        .filter((item) => item.fact.startsWith("language.") && item.source.startsWith(prefix))
        .map((item) => item.fact.slice("language.".length)),
    ),
  ];
  const frameworkSet = new Set<string>();
  const addDependency = (dependency: string, label: string): void => {
    if (hasDependency(manifest, dependency)) frameworkSet.add(label);
  };
  addDependency("next", "nextjs");
  addDependency("react", "react");
  addDependency("vue", "vue");
  addDependency("express", "express");
  addDependency("@nestjs/core", "nestjs");
  addDependency("@prisma/client", "prisma");
  addDependency("prisma", "prisma");
  addDependency("vite", "vite");
  addDependency("fastify", "fastify");
  if (moduleFiles.some((file) => file.startsWith(`${prefix}prisma/`) && file.endsWith(".prisma")))
    frameworkSet.add("prisma");

  const testingName = hasDependency(manifest, "vitest")
    ? "vitest"
    : hasDependency(manifest, "jest")
      ? "jest"
      : hasDependency(manifest, "@playwright/test")
        ? "playwright"
        : hasDependency(manifest, "cypress")
          ? "cypress"
          : undefined;
  const qualityTool = (
    dependency: string,
    config: string,
    script: string,
    name: string,
  ): Tool | undefined =>
    hasDependency(manifest, dependency) ||
    moduleFiles.some((file) => file.startsWith(`${prefix}${config}`))
      ? { name, command: commandFor(manifest, script) }
      : undefined;
  const packageManager = moduleFiles.some((file) => file === `${prefix}pnpm-lock.yaml`)
    ? "pnpm"
    : moduleFiles.some((file) => file === `${prefix}yarn.lock`)
      ? "yarn"
      : moduleFiles.some((file) => file === `${prefix}package-lock.json`)
        ? "npm"
        : "unknown";
  return {
    path: modulePath,
    name: typeof manifest.name === "string" ? manifest.name : undefined,
    runtime: { languages },
    frameworks: [...frameworkSet],
    packageManager,
    quality: {
      linter: qualityTool("eslint", "eslint.config", "lint", "eslint"),
      formatter: qualityTool("prettier", "prettier", "format", "prettier"),
      typecheck: commandFor(manifest, "typecheck")
        ? { name: "typescript", command: commandFor(manifest, "typecheck") }
        : undefined,
    },
    testing: testingName ? { name: testingName, command: commandFor(manifest, "test") } : undefined,
  };
}

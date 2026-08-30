import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

export type ProjectEvidence = { fact: string; source: string };
export type ProjectScan = { files: string[]; evidence: ProjectEvidence[] };

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  ".aiw",
  ".agents",
  ".claude",
  ".cursor",
  "dist",
  "coverage",
]);
const SENSITIVE_NAMES = /^(\.env(?:\..*)?|.*\.(pem|key|p12|pfx|secret))$/i;

function matchesIgnore(path: string, patterns: string[]): boolean {
  const name = basename(path);
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\//, "").replace(/\/$/, "");
    if (normalized.includes("*")) {
      const expression = new RegExp(`^${normalized.split("*").map(escapeRegExp).join(".*")}$`);
      return expression.test(path) || expression.test(name);
    }
    return path === normalized || path.startsWith(`${normalized}/`) || name === normalized;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ignoredPatterns(root: string): Promise<string[]> {
  try {
    const content = await readFile(resolve(root, ".gitignore"), "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

async function collect(
  root: string,
  current: string,
  patterns: string[],
  files: string[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = resolve(current, entry.name);
    const relativePath = relative(root, absolute).split("\\").join("/");
    if (
      DEFAULT_IGNORES.has(entry.name) ||
      SENSITIVE_NAMES.test(entry.name) ||
      matchesIgnore(relativePath, patterns)
    )
      continue;
    if (entry.isSymbolicLink()) {
      const link = await lstat(absolute);
      if (link.isSymbolicLink()) continue;
    }
    if (entry.isDirectory()) await collect(root, absolute, patterns, files);
    else if (entry.isFile()) files.push(relativePath);
  }
}

function detectEvidence(files: string[]): ProjectEvidence[] {
  const evidence: ProjectEvidence[] = [];
  for (const file of files) {
    if (/\.(ts|tsx)$/.test(file)) evidence.push({ fact: "language.typescript", source: file });
    if (/\.(js|jsx|mjs|cjs)$/.test(file))
      evidence.push({ fact: "language.javascript", source: file });
    if (basename(file).startsWith("eslint.config") || file === ".eslintrc.json")
      evidence.push({ fact: "tool.eslint", source: file });
    if (file === "package.json") evidence.push({ fact: "package-manager.npm", source: file });
    if (file === "pnpm-lock.yaml") evidence.push({ fact: "package-manager.pnpm", source: file });
    if (file === "yarn.lock") evidence.push({ fact: "package-manager.yarn", source: file });
  }
  return evidence;
}

export async function scanProject(root: string): Promise<ProjectScan> {
  const projectRoot = resolve(root);
  const files: string[] = [];
  await collect(projectRoot, projectRoot, await ignoredPatterns(projectRoot), files);
  return { files, evidence: detectEvidence(files) };
}

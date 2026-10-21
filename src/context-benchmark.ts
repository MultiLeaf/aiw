import { createHash } from "node:crypto";
import { join } from "node:path";
import type { FileSystem } from "./types.js";

/**
 * Standing-context benchmark (deterministic, offline, zero API cost).
 *
 * Measures the persistent context AI Workflow renders into every agent
 * session: the root context file for the active target, neutral resources
 * under `.aiw/resources/`, and composed context layers under `.aiw/context/`.
 *
 * Honest-measurement rules (see docs/token-efficiency-study-notes.md):
 * - byte and file counts are `measured`; token counts are `estimated`
 *   (characters/4) and always labeled as such;
 * - the bundle hash pins the exact fixture content behind every number;
 * - output contains no timestamps or randomness, so reruns are
 *   byte-identical for unchanged projects.
 */

export const CONTEXT_BENCH_SCHEMA = 1;
export const ROOT_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"] as const;
export const RESOURCE_CATEGORIES = ["skills", "rules", "agents", "hooks", "templates"] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];
export type ContextBenchCategory =
  ResourceCategory | "root-context" | "context-layers" | "other-resources";
export const CONTEXT_BENCH_CATEGORIES: readonly ContextBenchCategory[] = [
  "root-context",
  ...RESOURCE_CATEGORIES,
  "context-layers",
  "other-resources",
];

export type ContextBenchCategoryMetrics = {
  name: ContextBenchCategory;
  files: number;
  characters: number;
  estimatedTokens: number;
  paths: string[];
};

export type ContextBenchReport = {
  schema: number;
  bundleHash: string;
  totalCharacters: number;
  totalEstimatedTokens: number;
  categories: ContextBenchCategoryMetrics[];
};

/** Estimate tokens from characters. Always labeled `estimated`, never `measured`. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashBundle(entries: { path: string; content: string }[]): string {
  const hash = createHash("sha256");
  for (const entry of entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))
    hash.update(`${entry.path}\0${Buffer.byteLength(entry.content, "utf8")}\0`);
  return hash.digest("hex").slice(0, 16);
}

function emptyCategory(name: ContextBenchCategory): ContextBenchCategoryMetrics {
  return { name, files: 0, characters: 0, estimatedTokens: 0, paths: [] };
}

function addFile(
  categories: Map<ContextBenchCategory, ContextBenchCategoryMetrics>,
  name: ContextBenchCategory,
  path: string,
  content: string,
): void {
  const category = categories.get(name) ?? emptyCategory(name);
  category.files += 1;
  category.characters += content.length;
  category.estimatedTokens += estimateTokens(content);
  category.paths.push(path);
  categories.set(name, category);
}

/** Collect the standing-context report for a project. Deterministic: same files, same bytes, same report. */
export function collectContextBench(root: string, fs: FileSystem): ContextBenchReport {
  const categories = new Map<ContextBenchCategory, ContextBenchCategoryMetrics>();
  const bundle: { path: string; content: string }[] = [];
  const record = (name: ContextBenchCategory, path: string, content: string): void => {
    addFile(categories, name, path, content);
    bundle.push({ path, content });
  };

  for (const file of ROOT_CONTEXT_FILES) {
    const path = join(root, file);
    if (fs.pathType?.(path) === "file") record("root-context", file, fs.read(path));
  }

  const resourceRoot = join(root, ".aiw/resources");
  if (fs.pathType?.(resourceRoot) === "directory" && fs.listFiles) {
    for (const relative of fs.listFiles(resourceRoot)) {
      const absolute = join(resourceRoot, relative);
      if (fs.pathType?.(absolute) !== "file") continue;
      const top = relative.split(/[\\/]/)[0];
      const name: ContextBenchCategory = (RESOURCE_CATEGORIES as readonly string[]).includes(top)
        ? (top as ResourceCategory)
        : "other-resources";
      record(name, `.aiw/resources/${relative.split("\\").join("/")}`, fs.read(absolute));
    }
  }

  const contextRoot = join(root, ".aiw/context");
  if (fs.pathType?.(contextRoot) === "directory") {
    for (const file of (fs.list?.(contextRoot) ?? [])
      .filter((name) => name.endsWith(".md"))
      .sort()) {
      const absolute = join(contextRoot, file);
      if (fs.pathType?.(absolute) !== "file") continue;
      record("context-layers", `.aiw/context/${file}`, fs.read(absolute));
    }
  }

  const ordered = CONTEXT_BENCH_CATEGORIES.map(
    (name) => categories.get(name) ?? emptyCategory(name),
  );
  return {
    schema: CONTEXT_BENCH_SCHEMA,
    bundleHash: hashBundle(bundle),
    totalCharacters: ordered.reduce((total, category) => total + category.characters, 0),
    totalEstimatedTokens: ordered.reduce((total, category) => total + category.estimatedTokens, 0),
    categories: ordered,
  };
}

export function serializeContextBench(report: ContextBenchReport): string {
  const lines = [
    `schema: ${report.schema}`,
    `bundle_hash: ${report.bundleHash}`,
    `total_characters: ${report.totalCharacters}`,
    `total_estimated_tokens: ${report.totalEstimatedTokens}`,
    "token_estimate: characters/4 (estimated; byte counts are measured)",
    "categories:",
  ];
  for (const category of report.categories) {
    lines.push(
      `  - name: ${category.name}`,
      `    files: ${category.files}`,
      `    characters: ${category.characters}`,
      `    estimated_tokens: ${category.estimatedTokens}`,
    );
    if (category.paths.length) {
      lines.push("    paths:");
      lines.push(...category.paths.map((path) => `      - ${path}`));
    }
  }
  return lines.join("\n") + "\n";
}

/** Parse a previously saved report for baseline comparison. */
export function parseContextBench(content: string): ContextBenchReport {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== `schema: ${CONTEXT_BENCH_SCHEMA}`)
    throw new Error("Unrecognized context benchmark report schema.");
  const report: ContextBenchReport = {
    schema: CONTEXT_BENCH_SCHEMA,
    bundleHash: requiredValue(lines, "bundle_hash"),
    totalCharacters: Number(requiredValue(lines, "total_characters")),
    totalEstimatedTokens: Number(requiredValue(lines, "total_estimated_tokens")),
    categories: [],
  };
  let current: ContextBenchCategoryMetrics | undefined;
  for (const line of lines.slice(1)) {
    const category = line.match(/^ {2}- name: (.+)$/);
    if (category) {
      current = emptyCategory(category[1] as ContextBenchCategory);
      report.categories.push(current);
      continue;
    }
    const path = line.match(/^ {6}- (.+)$/);
    if (path && current) current.paths.push(path[1]);
    const match = line.match(/^ {4}(files|characters|estimated_tokens): (\d+)$/);
    if (match && current) {
      const key = match[1] === "estimated_tokens" ? "estimatedTokens" : match[1];
      current[key as "files" | "characters" | "estimatedTokens"] = Number(match[2]);
    }
  }
  if (!report.categories.length) throw new Error("Context benchmark report has no categories.");
  return report;
}

function requiredValue(lines: string[], key: string): string {
  const value = lines.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2);
  if (!value) throw new Error(`Context benchmark report is missing ${key}.`);
  return value;
}

export type ContextBenchComparison = {
  bundleChanged: boolean;
  totalTokenDelta: number;
  regressions: string[];
};

/**
 * Compare a current report against a saved baseline.
 * Follows the parity-harness rule: any token increase is a regression.
 */
export function compareContextBench(
  baseline: ContextBenchReport,
  current: ContextBenchReport,
): ContextBenchComparison {
  const baselineByCategory = new Map(
    baseline.categories.map((category) => [category.name, category]),
  );
  const regressions: string[] = [];
  for (const category of current.categories) {
    const previous = baselineByCategory.get(category.name);
    if (previous && category.estimatedTokens > previous.estimatedTokens)
      regressions.push(
        `${category.name}: ${previous.estimatedTokens} -> ${category.estimatedTokens} estimated tokens`,
      );
  }
  const totalTokenDelta = current.totalEstimatedTokens - baseline.totalEstimatedTokens;
  if (totalTokenDelta > 0)
    regressions.push(
      `total: ${baseline.totalEstimatedTokens} -> ${current.totalEstimatedTokens} estimated tokens`,
    );
  return {
    bundleChanged: baseline.bundleHash !== current.bundleHash,
    totalTokenDelta,
    regressions,
  };
}

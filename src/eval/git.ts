import type { GitSummary } from "./signals.js";
import { defaultShellRunner, type ShellRunner } from "./scenarios.js";

const COMMIT_TYPES = new Set([
  "feat",
  "fix",
  "chore",
  "docs",
  "test",
  "refactor",
  "perf",
  "build",
  "ci",
  "style",
]);

const LOG_COMMAND = 'git log --name-only --pretty=format:"@@%s" -n 500';
const LIST_CAP = 5;

function typeOf(subject: string): string {
  const match = /^([a-z]+)(\([^)]*\))?:/.exec(subject);
  const type = match?.[1];
  return type && COMMIT_TYPES.has(type) ? type : "other";
}

/**
 * Deterministic summary of `git log --name-only --pretty=format:@@%s`:
 * commit-type ratios, most-changed files, and hotspot directories. Subjects
 * are marked with @@ so file paths can never be mistaken for subjects.
 */
export function summarizeGitLog(output: string): GitSummary {
  const typeCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();
  const dirCounts = new Map<string, number>();
  let commits = 0;
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("@@")) {
      commits += 1;
      const type = typeOf(trimmed.slice(2));
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      continue;
    }
    fileCounts.set(trimmed, (fileCounts.get(trimmed) ?? 0) + 1);
    const dir = trimmed.includes("/") ? trimmed.slice(0, trimmed.lastIndexOf("/")) : undefined;
    if (dir) dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const commitTypeRatio: Record<string, number> = {};
  for (const type of [...typeCounts.keys()].sort())
    commitTypeRatio[type] =
      Math.round(((typeCounts.get(type) ?? 0) / Math.max(commits, 1)) * 10000) / 10000;
  const rank = (counts: Map<string, number>): string[] =>
    [...counts.entries()]
      .sort(([pathA, countA], [pathB, countB]) => countB - countA || pathA.localeCompare(pathB))
      .slice(0, LIST_CAP)
      .map(([path]) => path);
  return {
    available: true,
    topPaths: rank(fileCounts),
    commitTypeRatio,
    hotspots: rank(dirCounts),
  };
}

/**
 * Run the git summary in `root`. Any failure (no git, not a repository, empty
 * history) maps to `undefined` so the caller degrades to tree+CI signals.
 */
export async function collectGitSummary(
  root: string,
  runShell: ShellRunner = defaultShellRunner,
): Promise<GitSummary | undefined> {
  const result = await runShell(root, LOG_COMMAND, 10000);
  if (result.exitCode !== 0 || !result.stdout.trim()) return undefined;
  return summarizeGitLog(result.stdout);
}

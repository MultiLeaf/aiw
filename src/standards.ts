/**
 * OPP-012: Standards discovery — deterministic extraction of codebase
 * conventions into versioned, evidence-cited standards documents.
 *
 * The floor is fully deterministic and offline: conventions are detected from
 * repository structure and content (test layout, naming, error classes), each
 * statement carries file:line evidence and an occurrence count, and every
 * standard starts `inferred` until a human confirms or rejects it. Semantic
 * retrieval (OPP-008) may later widen coverage; it never bypasses confirmation.
 */

import { parse as parseYaml } from "yaml";
import type { FileSystem } from "./types.js";

export type StandardStatus = "inferred" | "confirmed" | "rejected";

export type StandardEvidence = { path: string; line: number };

export type StandardDocument = {
  topic: string;
  status: StandardStatus;
  statements: {
    convention: string;
    occurrences: number;
    evidence: StandardEvidence[];
  }[];
};

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".aiw",
  ".agents",
  ".claude",
  ".cursor",
  "dist",
  "build",
  "coverage",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
]);

function walkFiles(fs: FileSystem, root: string, directory: string, limit: number): string[] {
  const files: string[] = [];
  const walk = (current: string, depth: number): void => {
    if (files.length >= limit || depth > 8) return;
    const entries = fs.list?.(current) ?? [];
    for (const entry of entries) {
      if (files.length >= limit) return;
      const path = `${current}/${entry}`;
      const stat = fs.pathType?.(path);
      if (stat === "directory") {
        if (!IGNORED_DIRECTORIES.has(entry)) walk(path, depth + 1);
      } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
        files.push(path);
      }
    }
  };
  walk(directory, 0);
  return files;
}

function relative(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

export function extractStandards(root: string, fs: FileSystem): StandardDocument[] {
  const files = walkFiles(fs, root, root, 2000);
  const relativePaths = files.map((path) => relative(root, path));

  // Testing convention: co-located *.test.* files vs a dedicated tests tree.
  const coLocated = relativePaths.filter((path) => /\.(test|spec)\.[a-z]+$/i.test(path));
  const testsDirectory = relativePaths.filter((path) => /(^|\/)tests?\//i.test(path));
  const testing: StandardDocument = {
    topic: "testing",
    status: "inferred",
    statements: [
      coLocated.length > 0
        ? {
            convention: `Tests live beside the sources they cover, using *.test.* / *.spec.* file names (${coLocated.length} files).`,
            occurrences: coLocated.length,
            evidence: coLocated.slice(0, 3).map((path) => ({ path, line: 1 })),
          }
        : testsDirectory.length > 0
          ? {
              convention: `Tests live in a dedicated tests/ tree (${testsDirectory.length} files).`,
              occurrences: testsDirectory.length,
              evidence: testsDirectory.slice(0, 3).map((path) => ({ path, line: 1 })),
            }
          : {
              convention: "No deterministic testing layout detected.",
              occurrences: 0,
              evidence: [],
            },
    ],
  };

  // Error-handling convention: custom error classes.
  const errorEvidence: StandardEvidence[] = [];
  let errorCount = 0;
  for (const path of files) {
    const content = fs.read(path);
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (/class\s+\w+Error\b\s+extends\s+(?:\w+Error|Error)\b/.test(lines[index])) {
        errorCount += 1;
        if (errorEvidence.length < 3)
          errorEvidence.push({ path: relative(root, path), line: index + 1 });
      }
    }
  }
  const errorHandling: StandardDocument = {
    topic: "error-handling",
    status: "inferred",
    statements: [
      errorCount > 0
        ? {
            convention: `Custom error classes (\`class …Error extends …Error\`) are the error convention (${errorCount} definitions).`,
            occurrences: errorCount,
            evidence: errorEvidence,
          }
        : {
            convention: "No custom error classes detected; error convention unknown.",
            occurrences: 0,
            evidence: [],
          },
    ],
  };

  // Naming convention: source file casing.
  const kebab = relativePaths.filter(
    (path) =>
      /(^|\/)[a-z0-9]+(-[a-z0-9]+)*\.[a-z]+$/.test(path) &&
      !/[A-Z_]/.test(path.split("/").pop() ?? ""),
  );
  const camel = relativePaths.filter((path) => /[a-z][A-Z]/.test(path.split("/").pop() ?? ""));
  const naming: StandardDocument = {
    topic: "naming",
    status: "inferred",
    statements: [
      kebab.length >= camel.length
        ? {
            convention: `Source files use kebab-case naming (${kebab.length} files).`,
            occurrences: kebab.length,
            evidence: kebab.slice(0, 3).map((path) => ({ path, line: 1 })),
          }
        : {
            convention: `Source files use camelCase naming (${camel.length} files).`,
            occurrences: camel.length,
            evidence: camel.slice(0, 3).map((path) => ({ path, line: 1 })),
          },
    ],
  };

  return [testing, errorHandling, naming];
}

export type StandardsIndex = {
  schema: 1;
  standards: Record<string, { status: StandardStatus; updatedAt: string }>;
};

export function parseStandardsIndex(content: string): StandardsIndex {
  const value: unknown = parseYaml(content);
  const standards: StandardsIndex["standards"] = {};
  if (value && typeof value === "object") {
    const entries = (value as Record<string, Record<string, unknown>>).standards;
    if (entries && typeof entries === "object")
      for (const [topic, entry] of Object.entries(entries)) {
        const status = (entry as Record<string, unknown>)?.status;
        if (typeof status === "string" && ["inferred", "confirmed", "rejected"].includes(status))
          standards[topic] = {
            status: status as StandardStatus,
            updatedAt: new Date().toISOString(),
          };
      }
  }
  return { schema: 1, standards };
}

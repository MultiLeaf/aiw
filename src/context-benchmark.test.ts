import { describe, expect, it } from "vitest";
import {
  collectContextBench,
  compareContextBench,
  estimateTokens,
  parseContextBench,
  serializeContextBench,
} from "./context-benchmark.js";
import type { FileSystem } from "./types.js";

function memoryFs(files: Record<string, string>): FileSystem {
  return {
    exists: (path: string): boolean => Object.prototype.hasOwnProperty.call(files, path),
    read: (path: string): string => {
      if (!Object.prototype.hasOwnProperty.call(files, path)) throw new Error(`missing: ${path}`);
      return files[path];
    },
    write: (): void => {
      throw new Error("benchmark never writes");
    },
    mkdir: (): void => {},
    list: (path: string): string[] =>
      [
        ...new Set(
          Object.keys(files)
            .filter((file: string) => file.startsWith(`${path}/`))
            .map((file: string) => file.slice(path.length + 1).split("/")[0]),
        ),
      ].sort(),
    listFiles: (path: string): string[] =>
      Object.keys(files)
        .filter((file: string) => file.startsWith(`${path}/`))
        .map((file: string) => file.slice(path.length + 1))
        .sort(),
    pathType: (path: string): "file" | "directory" | "missing" =>
      Object.prototype.hasOwnProperty.call(files, path)
        ? "file"
        : Object.keys(files).some((file: string) => file.startsWith(`${path}/`))
          ? "directory"
          : "missing",
  };
}

describe("context benchmark", () => {
  const root = "/project";
  const files = {
    "/project/AGENTS.md": "# root context\n".repeat(10),
    "/project/.aiw/resources/skills/ai-init.md": "skill body",
    "/project/.aiw/resources/rules/typescript.md": "rule body",
    "/project/.aiw/resources/extra/notes.md": "extra",
    "/project/.aiw/context/global.md": "global layer",
    "/project/README.md": "not measured",
  };

  it("categorizes standing context deterministically with measured bytes and estimated tokens", () => {
    const report = collectContextBench(root, memoryFs(files));
    const byName = new Map(report.categories.map((category) => [category.name, category]));
    expect(byName.get("root-context")?.files).toBe(1);
    expect(byName.get("skills")?.paths).toEqual([".aiw/resources/skills/ai-init.md"]);
    expect(byName.get("rules")?.estimatedTokens).toBe(estimateTokens("rule body"));
    expect(byName.get("other-resources")?.paths).toEqual([".aiw/resources/extra/notes.md"]);
    expect(byName.get("context-layers")?.files).toBe(1);
    expect(report.categories.every((category) => !category.paths.includes("README.md"))).toBe(true);
    expect(report.totalEstimatedTokens).toBe(
      report.categories.reduce((total, category) => total + category.estimatedTokens, 0),
    );
  });

  it("produces byte-identical reports for identical content", () => {
    const first = serializeContextBench(collectContextBench(root, memoryFs(files)));
    const second = serializeContextBench(collectContextBench(root, memoryFs({ ...files })));
    expect(first).toBe(second);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no timestamps
  });

  it("changes the bundle hash when content changes", () => {
    const baseline = collectContextBench(root, memoryFs(files));
    const grown = collectContextBench(
      root,
      memoryFs({ ...files, "/project/AGENTS.md": "# root context\n".repeat(20) }),
    );
    expect(grown.bundleHash).not.toBe(baseline.bundleHash);
  });

  it("round-trips through serialize and parse", () => {
    const report = collectContextBench(root, memoryFs(files));
    const parsed = parseContextBench(serializeContextBench(report));
    expect(parsed.bundleHash).toBe(report.bundleHash);
    expect(parsed.totalEstimatedTokens).toBe(report.totalEstimatedTokens);
    expect(parsed.categories).toEqual(report.categories);
  });

  it("flags any token increase as a regression and improvements as safe", () => {
    const baseline = collectContextBench(root, memoryFs(files));
    const improved = collectContextBench(
      root,
      memoryFs({ ...files, "/project/.aiw/resources/rules/typescript.md": "r" }),
    );
    const comparison = compareContextBench(baseline, improved);
    expect(comparison.regressions).toEqual([]);
    expect(comparison.bundleChanged).toBe(true);
    expect(comparison.totalTokenDelta).toBeLessThan(0);

    const regressed = collectContextBench(
      root,
      memoryFs({ ...files, "/project/.aiw/context/global.md": "global layer with bloat" }),
    );
    expect(compareContextBench(baseline, regressed).regressions).toContain(
      "context-layers: 3 -> 6 estimated tokens",
    );
  });

  it("rejects reports with unknown schema", () => {
    expect(() => parseContextBench("schema: 99\n")).toThrow(/schema/);
  });
});

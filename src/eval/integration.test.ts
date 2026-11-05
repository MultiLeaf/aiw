import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../cli.js";
import { parseEvidenceBundle } from "./signals.js";

async function listAll(dir: string): Promise<string[]> {
  const entries: string[] = [];
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory())
      entries.push(...(await listAll(path)).map((child) => `${name.name}/${child}`));
    else entries.push(name.name);
  }
  return entries.sort();
}

describe("evaluator end-to-end", () => {
  it("runs the full lifecycle: evaluate → draft → import → approve → generated resource (REQ-001/004/006)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-e2e-"));
    await writeFile(join(cwd, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.20)\n");
    const before = await listAll(cwd);

    // 1. deterministic evaluation
    const evaluation = await run(["evaluate"], cwd);
    expect(evaluation.exitCode).toBe(0);
    expect(existsSync(join(cwd, ".aiw/eval/brief.md"))).toBe(true);
    const brief = await readFile(join(cwd, ".aiw/eval/brief.md"), "utf8");
    expect(brief).toContain("cmake");

    // 2. fake host agent: read the brief, draft one proposal citing real fact ids
    const bundle = parseEvidenceBundle(await readFile(join(cwd, ".aiw/eval/signals.yml"), "utf8"));
    const factIds = bundle.facts.slice(0, 2).map((fact) => fact.id);
    expect(factIds).toHaveLength(2);
    await mkdir(join(cwd, ".aiw/eval"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw/eval/proposals-draft.yml"),
      [
        "- kind: rule",
        "  signature: cpp-ctest-before-done",
        '  title: "Run ctest before completing"',
        '  outline: "Require ctest --output-on-failure before any task completion."',
        `  evidence: [${factIds.join(", ")}]`,
        "",
      ].join("\n"),
    );

    // 3. contract validation + store
    const imported = await run(["proposals", "import"], cwd);
    expect(imported.exitCode).toBe(0);
    expect(imported.output).toContain("imported 1 proposal");

    // 4. human gate: approval is the only path that materializes resources
    const rejected = await run(["proposals", "reject", "--id=prop-001", "--reason=not yet"], cwd);
    expect(rejected.exitCode).toBe(0);
    expect(existsSync(join(cwd, ".aiw/generated"))).toBe(false);
    const approved = await run(["proposals", "approve", "--id=prop-001"], cwd);
    expect(approved.exitCode).toBe(0);
    const generated = await readFile(
      join(cwd, ".aiw/generated/rules/cpp-ctest-before-done.md"),
      "utf8",
    );
    expect(generated).toContain("provenance: aiw-evaluator");
    expect(generated).toContain("proposal: prop-001");
    expect(generated).toContain("ctest --output-on-failure");

    // 5. REQ-007: with telemetry off (default), nothing outside .aiw/ changed
    const after = await listAll(cwd);
    const outside = after.filter((path) => !path.startsWith(".aiw/") && !before.includes(path));
    expect(outside).toEqual([]);
  });
});

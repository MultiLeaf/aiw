import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../cli.js";
import { renderBrief } from "./brief.js";
import { collectSignals } from "./signals.js";

describe("brief renderer", () => {
  it("renders the signal summary and the strict proposal contract (REQ-001)", () => {
    const bundle = collectSignals(["pyproject.toml", "tests/test_app.py"]);
    const brief = renderBrief(bundle);
    expect(brief).toContain("Resource Evaluator Brief");
    expect(brief).toContain("build.system");
    expect(brief).toContain(".aiw/eval/proposals-draft.yml");
    expect(brief).toContain("evidence");
    expect(brief).toMatch(/skill \| agent \| rule \| hook \| template/);
  });

  it("is deterministic: same bundle renders byte-identically", () => {
    const bundle = collectSignals(["CMakeLists.txt", "src/main.cpp"]);
    expect(renderBrief(bundle)).toBe(
      renderBrief(collectSignals(["CMakeLists.txt", "src/main.cpp"])),
    );
  });

  it("surfaces limitations such as missing git history", () => {
    const brief = renderBrief(collectSignals(["go.mod"]));
    expect(brief).toContain("git-history-unavailable");
  });
});

describe("aiw evaluate command", () => {
  it("writes signals.yml and brief.md under .aiw/eval and is idempotent (REQ-001)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-eval-"));
    await writeFile(join(cwd, "pyproject.toml"), '[project]\nname = "x"\n');
    const result = await run(["evaluate"], cwd);
    expect(result.exitCode).toBe(0);
    const signals = await readFile(join(cwd, ".aiw/eval/signals.yml"), "utf8");
    const brief = await readFile(join(cwd, ".aiw/eval/brief.md"), "utf8");
    expect(signals).toContain("build.system");
    expect(signals).toContain("git-history-unavailable");
    expect(brief).toContain("Resource Evaluator Brief");
    await run(["evaluate"], cwd);
    expect(await readFile(join(cwd, ".aiw/eval/signals.yml"), "utf8")).toBe(signals);
  });

  it("reports the handoff path for the host skill", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-eval-"));
    await writeFile(join(cwd, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.20)\n");
    const result = await run(["evaluate"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(".aiw/eval/brief.md");
  });
});

// ---- AIW-666 follow-up: stale draft invalidation (A4) ----

describe("aiw evaluate stale draft handling", () => {
  it("removes a previous proposals-draft so imports always match the fresh brief (A4)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-eval-"));
    await writeFile(join(cwd, "pyproject.toml"), '[project]\nname = "x"\n');
    await mkdir(join(cwd, ".aiw/eval"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw/eval/proposals-draft.yml"),
      "- kind: rule\n  signature: stale\n",
    );
    const result = await run(["evaluate"], cwd);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(cwd, ".aiw/eval/proposals-draft.yml"))).toBe(false);
    expect(existsSync(join(cwd, ".aiw/eval/signals.yml"))).toBe(true);
  });
});

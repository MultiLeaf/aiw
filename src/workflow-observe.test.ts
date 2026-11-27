import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./cli.js";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-observe-"));
}

async function writeArtifact(cwd: string, relative: string, content: string): Promise<void> {
  const path = join(cwd, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function readApprovals(cwd: string): Promise<string> {
  return readFile(join(cwd, ".aiw/approvals.yml"), "utf8");
}

describe("gate observe mode (REQ-001)", () => {
  it("logs a would-pass decision without changing stage state or approvals", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=test-workflow"], cwd);
    await run(["skip", "brainstorming", "--reason=Not needed by this test"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed by this test"], cwd);
    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/test-workflow/specification.md",
      "## Requirements\nREQ-001\n## Acceptance criteria\nGiven a user\nWhen they act\nThen it works\n",
    );
    const before = await readApprovals(cwd);

    const result = await run(["gate", "specification", "--observe"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("would pass for specification");
    expect(result.output).toContain("No workflow state was changed");

    // Stage state and approval ledger are untouched.
    expect(await readApprovals(cwd)).toBe(before);
    const status = await run(["status"], cwd);
    expect(status.output).not.toContain("Quality gate passed");

    // The decision is logged to the workflow-scoped observe checkpoint.
    const logPath = join(cwd, ".aiw/checkpoints/workflow-test-workflow-observe.yml");
    expect(existsSync(logPath)).toBe(true);
    const entries = (await import("yaml")).parse(await readFile(logPath, "utf8")) as Array<{
      stage: string;
      decision: string;
      issues: string[];
      recordedAt: string;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ stage: "specification", decision: "pass", issues: [] });

    // A real gate afterwards still works exactly as before.
    const gate = await run(["gate", "specification"], cwd);
    expect(gate.exitCode).toBe(0);
    expect(gate.output).toContain("Quality gate passed for specification");
  });

  it("logs a would-fail decision and does not block the stage", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=test-workflow"], cwd);
    await run(["skip", "brainstorming", "--reason=Not needed by this test"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed by this test"], cwd);
    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/test-workflow/specification.md",
      "# Spec\n\nREQ-001\n\nAcceptance criteria\n",
    );
    const before = await readApprovals(cwd);

    const result = await run(["gate", "specification", "--observe"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("would fail for specification");
    expect(result.output).toContain("1 issue(s)");

    const logPath = join(cwd, ".aiw/checkpoints/workflow-test-workflow-observe.yml");
    const entries = (await import("yaml")).parse(await readFile(logPath, "utf8")) as Array<{
      decision: string;
      issues: string[];
    }>;
    expect(entries[0].decision).toBe("fail");
    expect(entries[0].issues.length).toBeGreaterThan(0);

    // Observe does not record approval evidence: state unchanged.
    expect(await readApprovals(cwd)).toBe(before);

    // The failing real gate still blocks as before.
    const gate = await run(["gate", "specification"], cwd);
    expect(gate.exitCode).toBe(1);
    expect(gate.error).toContain("Quality gate blocked");
  });

  it("migrates a legacy JSON observe log losslessly to YAML (AIW-002 REQ-004)", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=test-workflow"], cwd);
    await run(["skip", "brainstorming", "--reason=Not needed by this test"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed by this test"], cwd);
    await run(["spec"], cwd);
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/test-workflow/specification.md",
      "## Requirements\nREQ-001\n## Acceptance criteria\nGiven a user\nWhen they act\nThen it works\n",
    );
    // Pre-existing legacy JSON log with one entry.
    const legacyPath = join(cwd, ".aiw/checkpoints/workflow-test-workflow-observe.json");
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify([
        {
          stage: "specification",
          decision: "fail",
          issues: ["old issue"],
          recordedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );

    const result = await run(["gate", "specification", "--observe"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("would pass for specification");

    // The YAML log exists, carries both entries, and the JSON file is gone.
    const yamlPath = join(cwd, ".aiw/checkpoints/workflow-test-workflow-observe.yml");
    const entries = (await import("yaml")).parse(await readFile(yamlPath, "utf8")) as Array<{
      stage: string;
      decision: string;
      issues: string[];
    }>;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      stage: "specification",
      decision: "fail",
      issues: ["old issue"],
    });
    expect(entries[1]).toMatchObject({ stage: "specification", decision: "pass" });
    expect(existsSync(legacyPath)).toBe(false);
  });
});

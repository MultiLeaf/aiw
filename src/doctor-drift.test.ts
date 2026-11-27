import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.js";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-doctor-drift-"));
}

/** A ledger that predates the product-requirements stage: specification decided, prerequisite missing. */
const DRIFTED_LEDGER = `schema: 1
workflowId: drift-test
stages:
  brainstorming:
    status: approved
    qualityGate: passed
    artifactHash: sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    updatedAt: 2026-11-27T10:00:00.000Z
  specification:
    status: approved
    qualityGate: passed
    artifactHash: sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    updatedAt: 2026-11-27T10:05:00.000Z
`;

const SESSION = `schema: 1
workflowId: drift-test
status: active
startedAt: 2026-11-27T10:00:00.000Z
updatedAt: 2026-11-27T10:05:00.000Z
`;

async function driftedProject(): Promise<string> {
  const cwd = await project();
  await run(["install"], cwd);
  await mkdir(join(cwd, ".aiw"), { recursive: true });
  await writeFile(join(cwd, ".aiw/workflow.yml"), SESSION);
  await writeFile(join(cwd, ".aiw/approvals.yml"), DRIFTED_LEDGER);
  return cwd;
}

describe("doctor stage-list drift (AIW-001)", () => {
  it("diagnoses drift with stage names and the repair command (REQ-001)", async () => {
    const cwd = await driftedProject();
    const doctor = await run(["doctor"], cwd);
    expect(doctor.exitCode).toBe(1);
    expect(doctor.error).toContain("Stage-list drift detected");
    expect(doctor.error).toContain(
      "specification is decided but its prerequisites are unresolved: product-requirements",
    );
    expect(doctor.error).toContain("aiw doctor --fix");
  });

  it("reports no drift for a healthy workflow and stays identical otherwise (NFR-002)", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const doctor = await run(["doctor"], cwd);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.output).toContain("AI Workflow health check passed");
  });

  it("repairs drift with recorded skips and never invents approvals (REQ-002)", async () => {
    const cwd = await driftedProject();
    const fix = await run(["doctor", "--fix"], cwd);
    expect(fix.exitCode).toBe(0);
    expect(fix.output).toContain("recorded skips for product-requirements");
    expect(fix.output).toContain("No decided stage was modified and no approval was invented");

    const ledger = await readFile(join(cwd, ".aiw/approvals.yml"), "utf8");
    // The new prerequisite carries a skip record with the drift reason.
    expect(ledger).toContain("product-requirements:");
    expect(ledger).toContain("status: skipped");
    expect(ledger).toContain("process list drift");
    // Decided stages untouched.
    expect(ledger).toContain("specification:");
    // The repaired ledger loads strictly and doctor is healthy again.
    const doctor = await run(["doctor"], cwd);
    expect(doctor.exitCode).toBe(0);
    const status = await run(["status"], cwd);
    expect(status.exitCode).toBe(0);
  });

  it("refuses to fix when the unresolved prerequisite is a required stage", async () => {
    const cwd = await driftedProject();
    // Make the drift block on a required stage: wipe the plan record while
    // implementation is decided (plan is required before implementation).
    const ledger = `${DRIFTED_LEDGER}  plan:
    status: approved
    qualityGate: passed
    updatedAt: 2026-11-27T10:10:00.000Z
  implementation:
    status: pending-human
    qualityGate: passed
    artifactHash: sha256-${"a".repeat(64)}
    updatedAt: 2026-11-27T10:15:00.000Z
`;
    await writeFile(
      join(cwd, ".aiw/approvals.yml"),
      ledger.replace(
        "  plan:\n    status: approved\n    qualityGate: passed\n    updatedAt: 2026-11-27T10:10:00.000Z\n",
        "",
      ),
    );
    const fix = await run(["doctor", "--fix"], cwd);
    expect(fix.exitCode).toBe(1);
    expect(fix.error).toContain("cannot skip required stage");
  });

  it("rejects unknown flags combined with --fix", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["doctor", "--fix", "--extra"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Usage: aiw doctor [--fix]");
  });
});

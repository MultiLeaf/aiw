import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./cli.js";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-escalation-"));
}

async function writeArtifact(cwd: string, relative: string, content: string): Promise<void> {
  const path = join(cwd, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const SPEC =
  "## Requirements\nREQ-001\n## Acceptance criteria\nGiven a user\nWhen they act\nThen it works\n";

async function reachPendingSpec(cwd: string): Promise<void> {
  await run(["install"], cwd);
  await run(["workflow", "start", "--id=test-workflow"], cwd);
  await run(["skip", "brainstorming", "--reason=Not needed by this test"], cwd);
  await run(["skip", "product-requirements", "--reason=Not needed by this test"], cwd);
  await run(["spec"], cwd);
  await writeArtifact(cwd, ".aiw/generated/specs/test-workflow/specification.md", SPEC);
  const gate = await run(["gate", "specification"], cwd);
  if (gate.exitCode !== 0) throw new Error(gate.error ?? "gate failed");
}

async function rejectOnce(cwd: string, n: number): Promise<void> {
  // Each cycle: reject, revise the artifact, re-gate.
  await run(["reject", "specification", `--reason=reason ${n}`], cwd);
  await writeArtifact(
    cwd,
    ".aiw/generated/specs/test-workflow/specification.md",
    `${SPEC}\nRevision ${n}\n`,
  );
  const gate = await run(["gate", "specification"], cwd);
  if (gate.exitCode !== 0) throw new Error(gate.error ?? "gate failed");
}

describe("bounded rejection escalation (REQ-002)", () => {
  it("escalates after 3 consecutive rejections and blocks the gate until a human resolves", async () => {
    const cwd = await project();
    await reachPendingSpec(cwd);
    await rejectOnce(cwd, 1);
    await rejectOnce(cwd, 2);

    // Third rejection trips the escalation.
    const third = await run(["reject", "specification", "--reason=reason 3"], cwd);
    expect(third.exitCode).toBe(0);
    expect(third.output).toContain("Escalation");
    expect(third.output).toContain("blocked until");
    expect(third.output).toContain("reason 1 | reason 2 | reason 3");

    // Gate refuses to pass the escalated stage, even with a valid artifact.
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/test-workflow/specification.md",
      `${SPEC}\nRevision 3\n`,
    );
    const blocked = await run(["gate", "specification"], cwd);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("escalated");

    // Explicit human authorization clears the escalation and resets the count.
    const resolve = await run(["resolve", "--stage=specification"], cwd);
    expect(resolve.exitCode).toBe(0);
    expect(resolve.output).toContain("retry authorization recorded");
    const ledger = await readFile(join(cwd, ".aiw/approvals.yml"), "utf8");
    expect(ledger).not.toContain("escalated: true");

    const gate = await run(["gate", "specification"], cwd);
    expect(gate.exitCode).toBe(0);
    const approve = await run(["approve", "specification"], cwd);
    expect(approve.exitCode).toBe(0);
  });

  it("resets the consecutive count on approval", async () => {
    const cwd = await project();
    await reachPendingSpec(cwd);
    await rejectOnce(cwd, 1);

    // Approve after one rejection; a later rejection starts counting from 1 again.
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/test-workflow/specification.md",
      `${SPEC}\nApproved revision\n`,
    );
    await run(["gate", "specification"], cwd);
    const approve = await run(["approve", "specification"], cwd);
    expect(approve.exitCode).toBe(0);
    // Re-open for another rejection cycle via a new artifact + gate.
    await writeArtifact(
      cwd,
      ".aiw/generated/specs/test-workflow/specification.md",
      `${SPEC}\nNew revision\n`,
    );
    await run(["gate", "specification"], cwd);
    const reject = await run(["reject", "specification", "--reason=reason 2"], cwd);
    expect(reject.output).toContain("Rejection 1 of 3");
    const ledger = await readFile(join(cwd, ".aiw/approvals.yml"), "utf8");
    expect(ledger).not.toContain("escalated: true");
  });

  it("honors a custom rejection budget from workflow start", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=test-workflow", "--rejection-budget=1"], cwd);
    await run(["skip", "brainstorming", "--reason=Not needed by this test"], cwd);
    await run(["skip", "product-requirements", "--reason=Not needed by this test"], cwd);
    await run(["spec"], cwd);
    await writeArtifact(cwd, ".aiw/generated/specs/test-workflow/specification.md", SPEC);
    await run(["gate", "specification"], cwd);

    const reject = await run(["reject", "specification", "--reason=too soon"], cwd);
    expect(reject.output).toContain("Escalation");
    const blocked = await run(["gate", "specification"], cwd);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("escalated");
  });

  it("rejects an invalid rejection budget", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["workflow", "start", "--rejection-budget=0"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("at least 1");
  });
});

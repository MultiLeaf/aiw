import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "./cli.js";
import { extractDigest, parseDigest, serializeDigest } from "./digest.js";

async function gitProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "aiw-opp013-"));
  const git = (args: string[]): void =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
  git(["init", "-q"]);
  git(["config", "user.email", "t@e.c"]);
  git(["config", "user.name", "t"]);
  await writeFile(join(cwd, "README.md"), "# project\n");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  return cwd;
}

const SPEC =
  "# Requirements\n\n## Requirements\n\n### REQ-001: Signed tokens\n\n- **Acceptance criteria:**\n  - Given a user\n  - When a token is issued\n  - Then it verifies\n\n### REQ-002: Revocation\n\n- **Acceptance criteria:**\n  - Given a revoked token\n  - When verified\n  - Then rejected\n";

describe("digest extraction (unit)", () => {
  it("extracts ids, criteria count and decision deterministically", () => {
    const digest = extractDigest("specification", SPEC, "sha256-abc");
    expect(digest.requirementIds).toEqual(["REQ-001", "REQ-002"]);
    expect(digest.criteriaCount).toBe(2);
    expect(digest.title).toBe("Requirements");
    expect(serializeDigest(digest)).toContain("requirementIds: [REQ-001, REQ-002]");
    expect(parseDigest(serializeDigest(digest), "specification")).toEqual(digest);
  });

  it("captures plan task ids and decision lines", () => {
    const plan =
      "# Plan\n\n- [ ] TASK-001: a\n- [ ] TASK-002: b\n\n## Decision\nShip behind a flag.\n";
    const digest = extractDigest("plan", plan, "sha256-x");
    expect(digest.taskIds).toEqual(["TASK-001", "TASK-002"]);
    expect(digest.decision).toBe("Ship behind a flag.");
  });
});

describe("OPP-013 digest layer (e2e)", () => {
  it("computes a digest at approval and serves it fresh", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=digest-1"], cwd);
    await run(["skip", "brainstorming", "--reason=ticket requirement"], cwd);
    await run(["spec"], cwd);
    await writeFile(join(cwd, ".aiw/generated/specs/specification.md"), SPEC);
    await run(["gate", "specification"], cwd);
    const approved = await run(["approve", "specification"], cwd);
    expect(approved.output).toContain("Digest available");
    expect(existsSync(join(cwd, ".aiw", "digests", "specification.yml"))).toBe(true);

    const served = await run(["digest", "--stage=specification"], cwd);
    expect(served.output).toContain("digest(specification)");
    expect(served.output).toContain("REQ-001, REQ-002");
    expect(served.output).toContain("criteria: 2");
    expect(served.output).not.toContain("STALE");
  });

  it("marks the digest stale when the artifact changes after approval", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=digest-2"], cwd);
    await run(["skip", "brainstorming", "--reason=ticket requirement"], cwd);
    await run(["spec"], cwd);
    await writeFile(join(cwd, ".aiw/generated/specs/specification.md"), SPEC);
    await run(["gate", "specification"], cwd);
    await run(["approve", "specification"], cwd);
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      SPEC + "\nEdited after approval.\n",
    );
    const served = await run(["digest", "--stage=specification"], cwd);
    expect(served.output).toContain("STALE");
    expect(served.output).toContain("read the full artifact");
  });

  it("serves approved digests into stage context", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=digest-3"], cwd);
    await run(["skip", "brainstorming", "--reason=ticket requirement"], cwd);
    await run(["spec"], cwd);
    await writeFile(join(cwd, ".aiw/generated/specs/specification.md"), SPEC);
    await run(["gate", "specification"], cwd);
    await run(["approve", "specification"], cwd);
    const context = await run(["context", "--stage=plan"], cwd);
    expect(context.output).toContain("digest(specification)");
    expect(context.output).toContain("REQ-001");
  });

  it("keeps light lanes and fresh repositories digest-free", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    const served = await run(["digest"], cwd);
    expect(served.exitCode).toBe(0);
    expect(served.output).toContain("No digests yet");
  });

  it("digest survives round-trip through the ledger workflow (full lane state)", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=digest-4"], cwd);
    await run(["skip", "brainstorming", "--reason=ticket requirement"], cwd);
    await run(["spec"], cwd);
    await writeFile(join(cwd, ".aiw/generated/specs/specification.md"), SPEC);
    await run(["gate", "specification"], cwd);
    await run(["approve", "specification"], cwd);
    const ledger = await readFile(join(cwd, ".aiw", "approvals.yml"), "utf8");
    expect(ledger).toContain("specification");
    const stored = await readFile(join(cwd, ".aiw", "digests", "specification.yml"), "utf8");
    expect(stored).toContain("sha256-");
  });
});

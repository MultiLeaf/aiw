import { describe, expect, it } from "vitest";
import { createEmptyStore, parseProposalStore } from "./proposals.js";
import { defaultPolicy } from "./policy.js";
import { extractObservations, monitorSession, type SessionArtifact } from "./monitor.js";

const gateFailure = (stage: string): SessionArtifact => ({
  type: "gate-failure",
  stage,
  ref: `checkpoints/${stage}-001.yml`,
});
const rejection = (stage: string, reason: string): SessionArtifact => ({
  type: "rejection",
  stage,
  reason,
  ref: `checkpoints/${stage}-002.yml`,
});

describe("continuous monitor", () => {
  it("extracts deterministic observations from AIW artifacts", () => {
    const observations = extractObservations([
      gateFailure("specification"),
      rejection("implementation", "tests missing"),
    ]);
    expect(observations).toEqual([
      {
        kind: "rule",
        signature: "gate-specification-quality",
        origin: "monitor",
        evidence: "checkpoints/specification-001.yml",
      },
      {
        kind: "rule",
        signature: "rejection-implementation",
        origin: "monitor",
        evidence: "checkpoints/implementation-002.yml",
      },
    ]);
  });

  it("one proposal for a pattern repeated across sessions, citing each occurrence (REQ-003)", () => {
    const store = createEmptyStore();
    const sessions: SessionArtifact[][] = [
      [gateFailure("specification")],
      [gateFailure("specification")],
      [gateFailure("specification")],
    ];
    for (const artifacts of sessions) monitorSession(store, artifacts);
    expect(store.proposals).toHaveLength(1);
    const proposal = store.proposals[0];
    expect(proposal?.occurrences).toBe(3);
    expect(proposal?.evidence).toHaveLength(3);
    expect(proposal?.evidence.every((ref) => ref.startsWith("checkpoints/"))).toBe(true);
  });

  it("does not surface single-occurrence patterns (REQ-003 acceptance)", () => {
    const store = createEmptyStore();
    const result = monitorSession(store, [gateFailure("plan")]);
    expect(result.surfaced).toEqual([]);
    expect(store.proposals[0]?.occurrences).toBe(1);
  });

  it("surfaces a proposal once the threshold is crossed", () => {
    const store = createEmptyStore();
    let surfaced: string[] = [];
    for (let i = 0; i < defaultPolicy().threshold; i++)
      surfaced = monitorSession(store, [rejection("implementation", "tests missing")]).surfaced;
    expect(surfaced).toEqual(["rejection-implementation"]);
  });

  it("is local: mutates only the passed store, touches no filesystem (REQ-007)", () => {
    const store = createEmptyStore();
    const before = JSON.stringify(store);
    expect(() => monitorSession(store, [gateFailure("review")])).not.toThrow();
    expect(JSON.stringify(store)).not.toBe(before);
  });
});

// ---- AIW-666 follow-up: production wiring at session boundaries ----

import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../cli.js";
import { harvestApprovalObservations } from "./monitor.js";

describe("approval-ledger harvesting", () => {
  it("maps rejected stages to monitor observations, ignoring others", () => {
    const artifacts = harvestApprovalObservations(
      [
        "schema: 1",
        "workflowId: w-1",
        "stages:",
        "  implementation:",
        "    status: rejected",
        '    reason: "tests missing"',
        "  verification:",
        "    status: approved",
        "",
      ].join("\n"),
    );
    expect(artifacts).toEqual([
      {
        type: "rejection",
        stage: "implementation",
        reason: "tests missing",
        ref: "approvals.yml",
      },
    ]);
  });

  it("returns nothing for content without rejections", () => {
    expect(harvestApprovalObservations("schema: 1\nstages: {}\n")).toEqual([]);
    expect(harvestApprovalObservations("")).toEqual([]);
  });
});

describe("heartbeat monitor wiring", () => {
  it("observes rejections at session start and reports surfaced thresholds (REQ-003 wiring)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-mon-"));
    await mkdir(join(cwd, ".aiw"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw/manifest.yml"),
      "schema: 1\nproject:\n  name: t\ntarget:\n  active: codex\n",
    );
    await writeFile(
      join(cwd, ".aiw/approvals.yml"),
      [
        "schema: 1",
        "workflowId: w-1",
        "stages:",
        "  implementation:",
        "    status: rejected",
        '    reason: "tests missing"',
        "",
      ].join("\n"),
    );
    const first = await run(["heartbeat", "--session=s1"], cwd);
    expect(first.exitCode).toBe(0);
    expect(existsSync(join(cwd, ".aiw/proposals.yml"))).toBe(true);
    const store = parseProposalStore(await readFile(join(cwd, ".aiw/proposals.yml"), "utf8"));
    expect(store.proposals[0]?.signature).toBe("rejection-implementation");
    expect(store.proposals[0]?.occurrences).toBe(1);
    // more sessions push occurrences; threshold surfacing reports advisory at s3
    await run(["heartbeat", "--session=s2"], cwd);
    const third = await run(["heartbeat", "--session=s3"], cwd);
    expect(third.exitCode).toBe(0);
    expect(third.output).toContain("monitor:");
    // s4 is cooldown-suppressed: one surfacing per window (REQ-005)
    const fourth = await run(["heartbeat", "--session=s4"], cwd);
    expect(fourth.output).not.toContain("monitor:");
    const after = parseProposalStore(await readFile(join(cwd, ".aiw/proposals.yml"), "utf8"));
    expect(after.proposals[0]?.occurrences).toBe(4);
  });

  it("never breaks the heartbeat when monitor state is unreadable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-mon-"));
    await mkdir(join(cwd, ".aiw"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw/manifest.yml"),
      "schema: 1\nproject:\n  name: t\ntarget:\n  active: codex\n",
    );
    await writeFile(join(cwd, ".aiw/proposals.yml"), "schema: 9\n");
    const result = await run(["heartbeat", "--session=s1"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("heartbeat:");
  });
});

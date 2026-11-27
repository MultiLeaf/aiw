import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { run } from "./cli.js";
import {
  clusterRejections,
  normalizeReason,
  parseRulesCandidates,
  setCandidateStatus,
  type RejectionOccurrence,
} from "./rules-candidates.js";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-rules-"));
}

const SPEC =
  "## Requirements\nREQ-001\n## Acceptance criteria\nGiven a user\nWhen they act\nThen it works\n";

async function writeArtifact(cwd: string, relative: string, content: string): Promise<void> {
  const path = join(cwd, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function prepareWorkflow(cwd: string): Promise<void> {
  await run(["install"], cwd);
  await run(["workflow", "start", "--id=test-workflow"], cwd);
  await run(["skip", "brainstorming", "--reason=Not needed by this test"], cwd);
  await run(["skip", "product-requirements", "--reason=Not needed by this test"], cwd);
  await run(["spec"], cwd);
  await writeArtifact(cwd, ".aiw/generated/specs/test-workflow/specification.md", SPEC);
  await run(["gate", "specification"], cwd);
}

async function rejectCycle(cwd: string, reason: string, revision: number): Promise<void> {
  await run(["reject", "specification", `--reason=${reason}`], cwd);
  await writeArtifact(
    cwd,
    ".aiw/generated/specs/test-workflow/specification.md",
    `${SPEC}\nRevision ${revision}\n`,
  );
  const gate = await run(["gate", "specification"], cwd);
  if (gate.exitCode !== 0) throw new Error(gate.error ?? "gate failed");
}

describe("rules candidates core (REQ-003)", () => {
  it("normalizes reasons so paraphrases group", () => {
    expect(normalizeReason("Add   Given/When/Then!")).toBe(normalizeReason("add given when then"));
  });

  it("clusters recurring rejections above the threshold and preserves prior statuses", () => {
    const occurrences: RejectionOccurrence[] = [
      {
        workflowId: "w1",
        stage: "specification",
        reason: "Add Given/When/Then",
        date: "2026-01-01T00:00:00Z",
      },
      {
        workflowId: "w2",
        stage: "specification",
        reason: "add given when then",
        date: "2026-01-02T00:00:00Z",
      },
      {
        workflowId: "w3",
        stage: "review",
        reason: "One-off feedback",
        date: "2026-01-03T00:00:00Z",
      },
    ];
    const prior = clusterRejections(occurrences);
    expect(prior).toHaveLength(1);
    expect(prior[0].occurrences).toHaveLength(2);
    expect(prior[0].status).toBe("draft");

    const accepted = setCandidateStatus(prior, prior[0].id, "accepted");
    const rescan = clusterRejections(occurrences, accepted);
    expect(rescan[0].status).toBe("accepted");
  });
});

describe("rules candidates CLI (REQ-003)", () => {
  it("surfaces recurring rejection reasons as draft candidates and never auto-activates", async () => {
    const cwd = await project();
    await prepareWorkflow(cwd);
    await rejectCycle(cwd, "Add Given/When/Then to REQ-001", 1);
    await rejectCycle(cwd, "add given when then to req-001", 2);

    const result = await run(["rules-candidates"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Add Given/When/Then to REQ-001");
    expect(result.output).toContain("(2x)");
    expect(result.output).toContain("never activate on their own");

    const file = await readFile(join(cwd, ".aiw/generated/rules-candidates.yml"), "utf8");
    const candidates = parseRulesCandidates(file);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("draft");
    expect(candidates[0].occurrences).toHaveLength(2);
  });

  it("accepts and dismisses candidates by id", async () => {
    const cwd = await project();
    await prepareWorkflow(cwd);
    await rejectCycle(cwd, "Add Given/When/Then to REQ-001", 1);
    await rejectCycle(cwd, "add given when then to req-001", 2);
    await run(["rules-candidates"], cwd);
    const listing = await readFile(join(cwd, ".aiw/generated/rules-candidates.yml"), "utf8");
    const id = parseRulesCandidates(listing)[0].id;

    const accept = await run(["rules-candidates", `--accept=${id}`], cwd);
    expect(accept.exitCode).toBe(0);
    expect(accept.output).toContain("accepted");
    expect(accept.output).toContain("commit it manually");

    const file = await readFile(join(cwd, ".aiw/generated/rules-candidates.yml"), "utf8");
    expect(parseRulesCandidates(file)[0].status).toBe("accepted");

    // A rescan preserves the accepted status.
    await run(["rules-candidates"], cwd);
    const rescanned = await readFile(join(cwd, ".aiw/generated/rules-candidates.yml"), "utf8");
    expect(parseRulesCandidates(rescanned)[0].status).toBe("accepted");

    const dismiss = await run(["rules-candidates", `--dismiss=${id}`], cwd);
    expect(dismiss.exitCode).toBe(0);
    expect(dismiss.output).toContain("dismissed");

    const unknown = await run(["rules-candidates", "--accept=rc-nope"], cwd);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.error).toContain("No rules candidate");
  });
});

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveProposal,
  createEmptyStore,
  parseProposalStore,
  recordOccurrence,
  rejectProposal,
  serializeProposalStore,
  shouldSurfaceProposal,
  suppressProposal,
} from "./proposals.js";
import { defaultPolicy } from "./policy.js";

const pattern = (n: number): string => `pattern-${n}`;

describe("proposal store", () => {
  it("serializes deterministically: same input yields byte-identical output", () => {
    const store = createEmptyStore();
    recordOccurrence(store, { kind: "skill", signature: pattern(1) });
    recordOccurrence(store, { kind: "rule", signature: pattern(2) });
    const first = serializeProposalStore(store);
    const reparsed = parseProposalStore(first);
    expect(serializeProposalStore(reparsed)).toBe(first);
  });

  it("deduplicates occurrences by signature: one proposal, growing count", () => {
    const store = createEmptyStore();
    recordOccurrence(store, { kind: "skill", signature: pattern(1) });
    recordOccurrence(store, { kind: "skill", signature: pattern(1) });
    recordOccurrence(store, { kind: "skill", signature: pattern(1) });
    expect(store.proposals).toHaveLength(1);
    expect(store.proposals[0]?.occurrences).toBe(3);
    expect(store.proposals[0]?.evidence).toHaveLength(3);
  });

  it("enforces the occurrence threshold before surfacing (REQ-003)", () => {
    const store = createEmptyStore();
    for (let i = 0; i < defaultPolicy().threshold - 1; i++)
      recordOccurrence(store, { kind: "skill", signature: pattern(1) });
    expect(shouldSurfaceProposal(store, pattern(1)).surface).toBe(false);
    recordOccurrence(store, { kind: "skill", signature: pattern(1) });
    expect(shouldSurfaceProposal(store, pattern(1)).surface).toBe(true);
  });

  it("does not surface a single-occurrence pattern (REQ-003 acceptance)", () => {
    const store = createEmptyStore();
    recordOccurrence(store, { kind: "agent", signature: pattern(9) });
    expect(shouldSurfaceProposal(store, pattern(9)).surface).toBe(false);
  });

  it("applies cooldown as a sequence gap between same-kind surfacings (REQ-005)", () => {
    const store = createEmptyStore();
    const threshold = defaultPolicy().threshold;
    for (let i = 0; i < threshold; i++)
      recordOccurrence(store, { kind: "rule", signature: pattern(1) });
    expect(shouldSurfaceProposal(store, pattern(1)).surface).toBe(true);
    // same kind again within the cooldown gap: suppressed
    for (let i = 0; i < threshold; i++)
      recordOccurrence(store, { kind: "rule", signature: pattern(2) });
    const cooled = shouldSurfaceProposal(store, pattern(2));
    expect(cooled.surface).toBe(false);
    expect(cooled.reason).toContain("cooldown");
    // after enough further events the cooldown elapses
    for (let i = 0; i < defaultPolicy().cooldown; i++)
      recordOccurrence(store, { kind: "skill", signature: pattern(3) });
    expect(shouldSurfaceProposal(store, pattern(2)).surface).toBe(true);
  });

  it("records rejection reason and resurfaces only with new occurrences (REQ-004)", () => {
    const store = createEmptyStore();
    for (let i = 0; i < defaultPolicy().threshold; i++)
      recordOccurrence(store, { kind: "skill", signature: pattern(1) });
    const id = store.proposals[0]?.id as string;
    rejectProposal(store, id, "too generic for this repo");
    expect(store.proposals[0]?.status).toBe("rejected");
    expect(store.proposals[0]?.rejectReason).toBe("too generic for this repo");
    // recurrence without new evidence stays suppressed
    expect(shouldSurfaceProposal(store, pattern(1)).surface).toBe(false);
    expect(shouldSurfaceProposal(store, pattern(1)).reason).toContain("rejected");
    // new occurrences beyond the cited count resurface
    recordOccurrence(store, { kind: "skill", signature: pattern(1) });
    recordOccurrence(store, { kind: "skill", signature: pattern(1) });
    expect(shouldSurfaceProposal(store, pattern(1)).surface).toBe(true);
  });

  it("suppresses via do-not-suggest-again and records the signature (REQ-005)", () => {
    const store = createEmptyStore();
    for (let i = 0; i < defaultPolicy().threshold; i++)
      recordOccurrence(store, { kind: "hook", signature: pattern(1) });
    const id = store.proposals[0]?.id as string;
    suppressProposal(store, id);
    expect(store.policy.suppressed).toContain(pattern(1));
    recordOccurrence(store, { kind: "hook", signature: pattern(1) });
    const verdict = shouldSurfaceProposal(store, pattern(1));
    expect(verdict.surface).toBe(false);
    expect(verdict.reason).toContain("suppressed");
  });

  it("approves proposals and advances the sequence on every mutation", () => {
    const store = createEmptyStore();
    const seqBefore = store.seq;
    for (let i = 0; i < defaultPolicy().threshold; i++)
      recordOccurrence(store, { kind: "template", signature: pattern(1) });
    expect(store.seq).toBeGreaterThan(seqBefore);
    const id = store.proposals[0]?.id as string;
    approveProposal(store, id);
    expect(store.proposals[0]?.status).toBe("approved");
    expect(store.proposals[0]?.id).toMatch(/^prop-\d+$/);
  });

  it("rejects unknown schema versions", () => {
    expect(() => parseProposalStore("schema: 99\n")).toThrow(/schema/i);
  });
});

// ---- command-level lifecycle (TASK-005) ----

import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { run } from "../cli.js";
import { collectSignals, serializeEvidenceBundle } from "./signals.js";

async function evaluatedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "aiw-prop-"));
  await mkdir(join(cwd, ".aiw/eval"), { recursive: true });
  const bundle = collectSignals(["build.gradle.kts", "gradlew", "src/test/java/AppTest.java"]);
  await writeFile(join(cwd, ".aiw/eval/signals.yml"), serializeEvidenceBundle(bundle));
  await writeFile(
    join(cwd, ".aiw/eval/proposals-draft.yml"),
    [
      "- kind: rule",
      "  signature: gradle-test-before-done",
      '  title: "Run Gradle tests before completing"',
      '  outline: "Require ./gradlew test before any task completion."',
      "  evidence: [fact-001, fact-002]",
      "",
    ].join("\n"),
  );
  return cwd;
}

describe("aiw proposals commands", () => {
  it("imports valid drafts into the store (REQ-001)", async () => {
    const cwd = await evaluatedProject();
    const result = await run(["proposals", "import"], cwd);
    expect(result.exitCode).toBe(0);
    const store = await readFile(join(cwd, ".aiw/proposals.yml"), "utf8");
    expect(store).toContain("gradle-test-before-done");
    expect(store).toContain("origin: onboarding");
  });

  it("rejects drafts with dangling evidence refs and writes no store (REQ-001/004)", async () => {
    const cwd = await evaluatedProject();
    await writeFile(
      join(cwd, ".aiw/eval/proposals-draft.yml"),
      "- kind: rule\n  signature: bad\n  title: B\n  outline: Do B.\n  evidence: [fact-999]\n",
    );
    const result = await run(["proposals", "import"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("fact-999");
    expect(existsSync(join(cwd, ".aiw/proposals.yml"))).toBe(false);
  });

  it("supports the human gate lifecycle: reject keeps files absent, approve records status (REQ-004)", async () => {
    const cwd = await evaluatedProject();
    expect((await run(["proposals", "import"], cwd)).exitCode).toBe(0);
    const reject = await run(["proposals", "reject", "--id=prop-001", "--reason=too generic"], cwd);
    expect(reject.exitCode).toBe(0);
    const store = await readFile(join(cwd, ".aiw/proposals.yml"), "utf8");
    expect(store).toContain("status: rejected");
    expect(store).toContain("too generic");
    // no command other than approve may create generated resource files
    for (const command of [
      ["proposals", "list"],
      ["proposals", "show", "--id=prop-001"],
      ["proposals", "suppress", "--id=prop-001"],
    ]) {
      await run(command, cwd);
      expect(existsSync(join(cwd, ".aiw/generated"))).toBe(false);
    }
  });

  it("requires a reason on reject", async () => {
    const cwd = await evaluatedProject();
    await run(["proposals", "import"], cwd);
    const result = await run(["proposals", "reject", "--id=prop-001"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("reason");
  });

  it("lists proposals after import", async () => {
    const cwd = await evaluatedProject();
    await run(["proposals", "import"], cwd);
    const result = await run(["proposals", "list"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("prop-001");
    expect(result.output).toContain("rule");
  });
});

// ---- AIW-666 follow-ups: idempotent import, kind update, empty drafts ----

describe("aiw proposals follow-ups", () => {
  it("is idempotent: re-importing the same draft adds no occurrence (A2)", async () => {
    const cwd = await evaluatedProject();
    await run(["proposals", "import"], cwd);
    await run(["proposals", "import"], cwd);
    const store = parseProposalStore(await readFile(join(cwd, ".aiw/proposals.yml"), "utf8"));
    expect(store.proposals[0]?.occurrences).toBe(1);
  });

  it("records a new occurrence only when the draft content changes (A2)", async () => {
    const cwd = await evaluatedProject();
    await run(["proposals", "import"], cwd);
    const draftPath = join(cwd, ".aiw/eval/proposals-draft.yml");
    await writeFile(
      draftPath,
      [
        "- kind: rule",
        "  signature: gradle-test-before-done",
        '  title: "Run Gradle tests before completing"',
        '  outline: "Require ./gradlew test AND integration tests before completion."',
        "  evidence: [fact-001, fact-002]",
        "",
      ].join("\n"),
    );
    await run(["proposals", "import"], cwd);
    const store = parseProposalStore(await readFile(join(cwd, ".aiw/proposals.yml"), "utf8"));
    expect(store.proposals[0]?.occurrences).toBe(2);
    expect(store.proposals[0]?.outline).toContain("integration tests");
  });

  it("updates the kind when a re-draft changes it (A5)", async () => {
    const cwd = await evaluatedProject();
    await run(["proposals", "import"], cwd);
    await writeFile(
      join(cwd, ".aiw/eval/proposals-draft.yml"),
      [
        "- kind: skill",
        "  signature: gradle-test-before-done",
        '  title: "Run Gradle tests before completing"',
        '  outline: "Skill wrapping ./gradlew test before completion."',
        "  evidence: [fact-001]",
        "",
      ].join("\n"),
    );
    await run(["proposals", "import"], cwd);
    const store = parseProposalStore(await readFile(join(cwd, ".aiw/proposals.yml"), "utf8"));
    expect(store.proposals[0]?.kind).toBe("skill");
  });

  it("reports a clean no-proposals result for an empty drafts file (B2/REQ-001)", async () => {
    const cwd = await evaluatedProject();
    await writeFile(join(cwd, ".aiw/eval/proposals-draft.yml"), "");
    const result = await run(["proposals", "import"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("no proposals");
    expect(existsSync(join(cwd, ".aiw/proposals.yml"))).toBe(false);
  });

  it("shows a proposal with its full evidence trail (B3)", async () => {
    const cwd = await evaluatedProject();
    await run(["proposals", "import"], cwd);
    const result = await run(["proposals", "show", "--id=prop-001"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("prop-001 [rule] proposed");
    expect(result.output).toContain("title: Run Gradle tests before completing");
    expect(result.output).toContain("evidence: fact-001, fact-002");
  });
});

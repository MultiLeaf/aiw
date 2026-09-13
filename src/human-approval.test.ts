import { describe, expect, it } from "vitest";
import {
  APPROVAL_STAGES,
  approveStage,
  beginStageApproval,
  createApprovalLedger,
  getUnresolvedPrerequisites,
  invalidateStageAndDescendants,
  parseApprovalLedger,
  rejectStage,
  serializeApprovalLedger,
  skipOptionalStage,
  stageDefinition,
  stageFingerprint,
} from "./human-approval.js";

const timestamp = "2026-09-13T12:00:00.000Z";
const fingerprint = (content: string): string => stageFingerprint(content);

describe("human approval contract", () => {
  it("defines an ordered stage graph with only brainstorming and design optional", () => {
    expect(APPROVAL_STAGES).toEqual([
      "brainstorming",
      "specification",
      "technical-design",
      "plan",
      "implementation",
      "verification",
      "review",
      "traceability",
    ]);
    expect(stageDefinition("brainstorming").optional).toBe(true);
    expect(stageDefinition("technical-design").optional).toBe(true);
    expect(stageDefinition("specification").optional).toBe(false);
  });

  it("fingerprints exact artifact content with SHA-256", () => {
    expect(fingerprint("approved artifact")).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(fingerprint("approved artifact")).toBe(fingerprint("approved artifact"));
    expect(fingerprint("approved artifact\n")).not.toBe(fingerprint("approved artifact"));
  });

  it("scopes approval ledgers to a single workflow request", () => {
    expect(createApprovalLedger("feature-001")).toEqual({
      schema: 1,
      workflowId: "feature-001",
      stages: {},
    });
    expect(() => createApprovalLedger("../outside-project")).toThrow("Workflow ID");
    expect(() =>
      beginStageApproval(createApprovalLedger("feature-003"), "brainstorming", {
        artifactHash: fingerprint("brainstorm"),
        qualityGate: "passed",
        updatedAt: "1",
      }),
    ).toThrow("valid date-time");
  });

  it("blocks later stages until every prior stage is approved or explicitly skipped", () => {
    const ledger = createApprovalLedger("feature-001");
    expect(getUnresolvedPrerequisites(ledger, "specification")).toEqual(["brainstorming"]);
    expect(() =>
      beginStageApproval(ledger, "specification", {
        artifactHash: fingerprint("spec"),
        qualityGate: "passed",
        updatedAt: timestamp,
      }),
    ).toThrow("brainstorming");

    const skipped = skipOptionalStage(ledger, "brainstorming", {
      reason: "The request has clear scope and constraints.",
      humanAccepted: true,
      updatedAt: timestamp,
    });
    expect(getUnresolvedPrerequisites(skipped, "specification")).toEqual([]);
  });

  it("requires automated quality gates to pass before human review where a gate exists", () => {
    const ledger = skipOptionalStage(createApprovalLedger("feature-001"), "brainstorming", {
      reason: "Scope is already clear.",
      humanAccepted: true,
      updatedAt: timestamp,
    });
    expect(() =>
      beginStageApproval(ledger, "specification", {
        artifactHash: fingerprint("spec"),
        qualityGate: "failed",
        updatedAt: timestamp,
      }),
    ).toThrow("quality gate must pass");
    expect(() =>
      beginStageApproval(ledger, "specification", {
        artifactHash: fingerprint("spec"),
        qualityGate: "not-applicable",
        updatedAt: timestamp,
      }),
    ).toThrow("quality gate must pass");
  });

  it("records human approval only for the pending exact artifact", () => {
    const ledger = skipOptionalStage(createApprovalLedger("feature-001"), "brainstorming", {
      reason: "Scope is already clear.",
      humanAccepted: true,
      updatedAt: timestamp,
    });
    const pending = beginStageApproval(ledger, "specification", {
      artifactHash: fingerprint("spec v1"),
      qualityGate: "passed",
      updatedAt: timestamp,
    });
    expect(() =>
      approveStage(pending, "specification", {
        artifactHash: fingerprint("spec v2"),
        updatedAt: timestamp,
      }),
    ).toThrow("artifact changed");
    const approved = approveStage(pending, "specification", {
      artifactHash: fingerprint("spec v1"),
      updatedAt: timestamp,
    });
    expect(approved.stages.specification?.status).toBe("approved");
    expect(approved.stages.specification?.artifactHash).toBe(fingerprint("spec v1"));
  });

  it("requires a reason and explicit human acceptance to skip optional stages", () => {
    const ledger = createApprovalLedger("feature-001");
    expect(() =>
      skipOptionalStage(ledger, "brainstorming", {
        reason: "Clear request.",
        humanAccepted: false,
        updatedAt: timestamp,
      }),
    ).toThrow("human acceptance");
    expect(() =>
      skipOptionalStage(ledger, "brainstorming", {
        reason: "   ",
        humanAccepted: true,
        updatedAt: timestamp,
      }),
    ).toThrow("reason");
    expect(() =>
      skipOptionalStage(ledger, "specification", {
        reason: "Not needed.",
        humanAccepted: true,
        updatedAt: timestamp,
      }),
    ).toThrow("is required");
  });

  it("requires reasons for rejection and invalidates dependent approvals after edits", () => {
    const brainstorm = beginStageApproval(createApprovalLedger("feature-001"), "brainstorming", {
      artifactHash: fingerprint("brainstorm v1"),
      qualityGate: "passed",
      updatedAt: timestamp,
    });
    const approvedBrainstorm = approveStage(brainstorm, "brainstorming", {
      artifactHash: fingerprint("brainstorm v1"),
      updatedAt: timestamp,
    });
    const specification = beginStageApproval(approvedBrainstorm, "specification", {
      artifactHash: fingerprint("spec v1"),
      qualityGate: "passed",
      updatedAt: timestamp,
    });
    expect(() => rejectStage(specification, "specification", "  ", timestamp)).toThrow("reason");
    expect(
      rejectStage(specification, "specification", "Clarify one requirement.", timestamp).stages
        .specification?.status,
    ).toBe("rejected");

    const stale = invalidateStageAndDescendants(specification, "brainstorming", timestamp);
    expect(stale.stages.brainstorming?.status).toBe("stale");
    expect(stale.stages.specification?.status).toBe("stale");
  });

  it("invalidates all approved descendants when a stage artifact changes", () => {
    let ledger = beginStageApproval(createApprovalLedger("feature-002"), "brainstorming", {
      artifactHash: fingerprint("brainstorm v1"),
      qualityGate: "passed",
      updatedAt: timestamp,
    });
    ledger = approveStage(ledger, "brainstorming", {
      artifactHash: fingerprint("brainstorm v1"),
      updatedAt: timestamp,
    });
    ledger = beginStageApproval(ledger, "specification", {
      artifactHash: fingerprint("spec v1"),
      qualityGate: "passed",
      updatedAt: timestamp,
    });
    ledger = approveStage(ledger, "specification", {
      artifactHash: fingerprint("spec v1"),
      updatedAt: timestamp,
    });
    ledger = skipOptionalStage(ledger, "technical-design", {
      reason: "No architecture decisions are needed.",
      humanAccepted: true,
      updatedAt: timestamp,
    });
    ledger = beginStageApproval(ledger, "plan", {
      artifactHash: fingerprint("plan v1"),
      qualityGate: "passed",
      updatedAt: timestamp,
    });
    ledger = approveStage(ledger, "plan", {
      artifactHash: fingerprint("plan v1"),
      updatedAt: timestamp,
    });

    const edited = beginStageApproval(ledger, "specification", {
      artifactHash: fingerprint("spec v2"),
      qualityGate: "passed",
      updatedAt: timestamp,
    });
    expect(edited.stages.specification?.status).toBe("pending-human");
    expect(edited.stages["technical-design"]?.status).toBe("stale");
    expect(edited.stages.plan?.status).toBe("stale");
    expect(getUnresolvedPrerequisites(edited, "implementation")).toContain("plan");
  });

  it("round-trips the versioned ledger and rejects unsupported schemas or stages", () => {
    const ledger = skipOptionalStage(createApprovalLedger("feature-001"), "brainstorming", {
      reason: "Scope is already clear.",
      humanAccepted: true,
      updatedAt: timestamp,
    });
    expect(parseApprovalLedger(serializeApprovalLedger(ledger))).toEqual(ledger);
    expect(() => parseApprovalLedger("schema: 2\nstages: {}\n")).toThrow(
      "schema must be version 1",
    );
    expect(() =>
      parseApprovalLedger("schema: 1\nworkflowId: feature-001\nowner: agent\nstages: {}\n"),
    ).toThrow("unknown field");
    expect(() =>
      parseApprovalLedger(
        'schema: 1\nworkflowId: feature-001\nstages:\n  deploy:\n    status: approved\n    updatedAt: "2026-09-13T12:00:00.000Z"\n',
      ),
    ).toThrow("unknown workflow stage");
    expect(() =>
      parseApprovalLedger(
        `schema: 1\nworkflowId: feature-001\nstages:\n  plan:\n    status: approved\n    qualityGate: passed\n    artifactHash: ${fingerprint("plan")}\n    updatedAt: "${timestamp}"\n`,
      ),
    ).toThrow("out-of-order decision");
    expect(() =>
      parseApprovalLedger(
        `schema: 1\nworkflowId: feature-001\nstages:\n  brainstorming:\n    status: approved\n    qualityGate: failed\n    artifactHash: ${fingerprint("brainstorm")}\n    updatedAt: "${timestamp}"\n`,
      ),
    ).toThrow("must have a passing quality gate");
  });
});

import { describe, expect, it } from "vitest";
import {
  BLOCKING_REASON_CODES,
  BlockingError,
  blockingResultToJson,
  describeBlockingReason,
  exportContinuationInventoryMarkdown,
  formatBlockingOutput,
  getBlockingReasonDefinition,
} from "./blocking-reasons.js";

function normalizeTableRows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/^\|\s*-/.test(line.trim()))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
}

describe("blocking reason inventory", () => {
  it("registers a definition for every declared reason code", () => {
    for (const code of BLOCKING_REASON_CODES) {
      expect(() => getBlockingReasonDefinition(code)).not.toThrow();
    }
  });

  it("rejects unknown reason codes", () => {
    expect(() => getBlockingReasonDefinition("not_a_reason")).toThrow(/unknown blocking reason/i);
    expect(() => getBlockingReasonDefinition("")).toThrow(/unknown blocking reason/i);
  });

  it("gives every definition a non-empty description", () => {
    for (const code of BLOCKING_REASON_CODES) {
      const definition = getBlockingReasonDefinition(code);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });

  it("keeps the inventory markdown in parity with the registered codes", () => {
    const markdown = exportContinuationInventoryMarkdown();
    for (const code of BLOCKING_REASON_CODES) {
      expect(markdown).toContain(`\`${code}\``);
    }
    expect(markdown).not.toContain("not_a_reason");
  });

  it("keeps the published docs inventory in parity with the registry (CI check)", async () => {
    const { readFile } = await import("node:fs/promises");
    const published = await readFile("docs/continuation-inventory.md", "utf8");
    const publishedRows = normalizeTableRows(published);
    const generatedRows = normalizeTableRows(exportContinuationInventoryMarkdown());
    expect(publishedRows).toEqual(generatedRows);
  });
});

describe("blocking reason continuations", () => {
  it("resolves the exact approve command for a stage awaiting approval", () => {
    const result = describeBlockingReason("stage_awaiting_approval", { stage: "specification" });
    expect(result.continuation).toEqual({
      kind: "command",
      command: "aiw approve specification",
    });
  });

  it("resolves the first pending prerequisite as the continuation", () => {
    const result = describeBlockingReason("stage_prerequisite_pending", {
      stage: "plan",
      pendingStages: ["brainstorming", "specification"],
    });
    expect(result.continuation).toEqual({
      kind: "command",
      command: "aiw approve brainstorming",
    });
  });

  it("resolves the first unresolved prerequisite as the continuation", () => {
    const result = describeBlockingReason("stage_prerequisite_unresolved", {
      stage: "plan",
      unresolvedStages: ["brainstorming", "specification"],
    });
    expect(result.continuation).toEqual({ kind: "command", command: "aiw approve brainstorming" });
  });

  it("names the gate rerun for an already approved stage with changed evidence", () => {
    const result = describeBlockingReason("stage_already_approved", { stage: "verification" });
    expect(result.continuation).toEqual({ kind: "command", command: "aiw gate verification" });
  });

  it("names the gate rerun for a stale approval", () => {
    const result = describeBlockingReason("approval_stale", { stage: "specification" });
    expect(result.continuation).toEqual({ kind: "command", command: "aiw gate specification" });
  });

  it("describes the artifact to create when gate evidence is missing", () => {
    const result = describeBlockingReason("gate_evidence_missing", {
      stage: "specification",
      artifactPath: ".aiw/generated/specs/specification.md",
    });
    expect(result.continuation.kind).toBe("action");
    if (result.continuation.kind === "action") {
      expect(result.continuation.description).toContain(".aiw/generated/specs/specification.md");
      expect(result.continuation.description).toContain("aiw gate specification");
    }
  });

  it("returns a terminal continuation when required context is missing", () => {
    const result = describeBlockingReason("stage_awaiting_approval", {});
    expect(result.continuation.kind).toBe("terminal");
    if (result.continuation.kind === "terminal") {
      expect(result.continuation.humanDecision.length).toBeGreaterThan(0);
    }
  });

  it("returns a terminal continuation when a prerequisite list is empty", () => {
    const result = describeBlockingReason("stage_prerequisite_pending", {
      stage: "plan",
      pendingStages: [],
    });
    expect(result.continuation.kind).toBe("terminal");
  });
});

describe("blocking reason output formatting", () => {
  it("formats a command continuation with the reason code and runnable command", () => {
    const output = formatBlockingOutput(
      describeBlockingReason("stage_awaiting_approval", { stage: "plan" }),
    );
    expect(output).toContain("[reason: stage_awaiting_approval]");
    expect(output).toContain("`aiw approve plan`");
    expect(output).not.toContain("Terminal");
  });

  it("formats an action continuation with the reason code and the description", () => {
    const output = formatBlockingOutput(
      describeBlockingReason("gate_evidence_missing", {
        stage: "specification",
        artifactPath: ".aiw/generated/specs/specification.md",
      }),
    );
    expect(output).toContain("[reason: gate_evidence_missing]");
    expect(output).toContain("Next:");
    expect(output).toContain(".aiw/generated/specs/specification.md");
  });

  it("formats a terminal continuation explicitly", () => {
    const output = formatBlockingOutput(describeBlockingReason("stage_awaiting_approval", {}));
    expect(output).toContain("[reason: stage_awaiting_approval]");
    expect(output).toContain("Terminal:");
  });

  it("exposes machine-readable reason_code and next_command fields", () => {
    const json = blockingResultToJson(
      describeBlockingReason("stage_awaiting_approval", { stage: "plan" }),
    );
    expect(json).toEqual({
      reason_code: "stage_awaiting_approval",
      next_command: "aiw approve plan",
    });
  });

  it("exposes next_action for non-command continuations and terminal for none", () => {
    const actionJson = blockingResultToJson(
      describeBlockingReason("gate_evidence_missing", {
        stage: "specification",
        artifactPath: "spec.md",
      }),
    );
    expect(actionJson.reason_code).toBe("gate_evidence_missing");
    expect(typeof actionJson.next_action).toBe("string");
    expect(actionJson.next_command).toBeUndefined();

    const terminalJson = blockingResultToJson(
      describeBlockingReason("stage_awaiting_approval", {}),
    );
    expect(terminalJson.reason_code).toBe("stage_awaiting_approval");
    expect(terminalJson.terminal).toBe(true);
    expect(terminalJson.next_command).toBeUndefined();
    expect(terminalJson.next_action).toBeUndefined();
  });

  it("prefers the context-specific detail over the generic description", () => {
    const result = describeBlockingReason("stage_awaiting_approval", {
      stage: "plan",
      detail: "Cannot enter plan; brainstorming is awaiting human approval.",
    });
    expect(result.message).toBe("Cannot enter plan; brainstorming is awaiting human approval.");
    expect(formatBlockingOutput(result)).toContain(
      "Cannot enter plan; brainstorming is awaiting human approval. [reason: stage_awaiting_approval]",
    );
  });

  it("carries the typed result on BlockingError", () => {
    const result = describeBlockingReason("approval_stale", { stage: "specification" });
    const error = new BlockingError(result);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BlockingError");
    expect(error.result.code).toBe("approval_stale");
    expect(error.message).toContain("[reason: approval_stale]");
    expect(error.message).toContain("`aiw gate specification`");
  });
});

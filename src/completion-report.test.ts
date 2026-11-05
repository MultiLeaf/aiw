import { describe, expect, it } from "vitest";
import { buildCompletionReport } from "./completion-report.js";
import type { TaskUsageSummary } from "./cost-attribution.js";
import type { CostAttribution } from "./cost-attribution.js";
import type { ApprovalLedger, WorkflowSession } from "./human-approval.js";

const session: WorkflowSession = {
  schema: 1,
  workflowId: "11111111-2222-3333-4444-555555555555",
  status: "active",
  startedAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T11:00:00.000Z",
  ticket: "FRIC-003",
};

const ledger: ApprovalLedger = {
  schema: 1,
  workflowId: session.workflowId,
  stages: {
    specification: {
      status: "approved",
      qualityGate: { status: "pass", findings: [] },
      updatedAt: "2026-01-01T10:20:00.000Z",
    },
    implementation: {
      status: "approved",
      qualityGate: { status: "pass", findings: [] },
      updatedAt: "2026-01-01T10:50:00.000Z",
    },
  },
};

const usage: TaskUsageSummary = {
  workflow: "FRIC-003",
  entries: 2,
  label: "measured",
  inputTokens: 1000,
  outputTokens: 200,
  totalTokens: 1200,
  models: ["test-model"],
  harnesses: ["test-harness"],
  requirements: [],
  stages: [{ stage: "implementation", tokens: 1200, label: "measured", models: ["test-model"] }],
};

const attribution: CostAttribution = {
  attributed: [{ requirement: "REQ-001", tokens: 1200, label: "measured" }],
  unattributedTokens: 0,
  unattributedLabel: "measured",
  verifiedRequirements: 1,
  unverifiedRequirements: 0,
  totalTokens: 1200,
  totalLabel: "measured",
};

describe("completion report", () => {
  it("includes usage summary, attribution, and stage timeline (REQ-001, REQ-002)", () => {
    const { markdown, consoleSummary } = buildCompletionReport({
      session,
      ledger,
      usage,
      attribution,
    });
    expect(markdown).toContain("total_tokens");
    expect(markdown).toContain("1,200");
    expect(markdown).toContain("test-model");
    expect(markdown).toContain("REQ-001");
    expect(markdown).toContain("2026-01-01T10:00:00.000Z");
    expect(markdown).toContain("specification: approved");
    expect(consoleSummary).toContain("1,200");
    expect(consoleSummary).not.toContain("undefined");
    expect(markdown).not.toContain("undefined");
  });

  it("states no usage and suggests usage-sidecar record (REQ-003, REQ-001)", () => {
    const { markdown, consoleSummary } = buildCompletionReport({ session, ledger });
    expect(markdown).toContain("No usage recorded");
    expect(markdown).toContain("aiw usage-sidecar record --workflow=FRIC-003");
    expect(consoleSummary).toContain("No usage recorded");
    expect(consoleSummary).toContain("usage-sidecar record");
  });

  it("records an advisory when attribution is unavailable (REQ-003)", () => {
    const { markdown } = buildCompletionReport({ session, ledger, usage });
    expect(markdown).toContain("Cost attribution skipped");
  });

  it("is deterministic for identical input (REQ-002)", () => {
    const first = buildCompletionReport({ session, ledger, usage, attribution });
    const second = buildCompletionReport({ session, ledger, usage, attribution });
    expect(first.markdown).toBe(second.markdown);
    expect(first.consoleSummary).toBe(second.consoleSummary);
  });
});

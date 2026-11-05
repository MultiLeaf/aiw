import type { CostAttribution, TaskUsageSummary } from "./cost-attribution.js";
import { serializeCostAttribution, serializeTaskUsage } from "./cost-attribution.js";
import type { ApprovalLedger, WorkflowSession } from "./human-approval.js";

export type CompletionReportInput = {
  session: WorkflowSession;
  ledger: ApprovalLedger;
  usage?: TaskUsageSummary;
  attribution?: CostAttribution;
};

export type CompletionReport = { markdown: string; consoleSummary: string };

/**
 * FRIC-003: build the usage/cost completion report from data AI Workflow
 * already records. Pure function — no filesystem access.
 */
export function buildCompletionReport(input: CompletionReportInput): CompletionReport {
  const { session, ledger, usage, attribution } = input;
  const scope = session.ticket ?? session.workflowId;
  const usageSection = usage
    ? serializeTaskUsage(usage)
    : `No usage recorded for workflow ${scope}. Record runs with \`aiw usage-sidecar record --workflow=${scope}\`.`;
  const attributionSection = attribution
    ? serializeCostAttribution(attribution)
    : "Cost attribution skipped: no traceability graph available for this workflow.";
  const timeline = Object.entries(ledger.stages)
    .map(([stage, record]) => `- ${stage}: ${record.status} (${record.updatedAt})`)
    .join("\n");
  const markdown = [
    `# Usage and Cost Report — Workflow ${session.workflowId}`,
    "",
    `- Ticket: ${session.ticket ?? "(none)"}`,
    `- Started: ${session.startedAt}`,
    `- Completed: ${session.updatedAt}`,
    "",
    "## Usage",
    "",
    usageSection,
    "",
    "## Cost attribution",
    "",
    attributionSection,
    "",
    "## Stage timeline",
    "",
    timeline || "(no recorded stages)",
    "",
  ].join("\n");
  const consoleSummary = usage
    ? serializeTaskUsage(usage)
    : `No usage recorded for workflow ${scope}. Record runs with \`aiw usage-sidecar record --workflow=${scope}\`.`;
  return { markdown, consoleSummary };
}

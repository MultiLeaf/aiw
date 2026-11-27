import type { CostAttribution, TaskUsageSummary } from "./cost-attribution.js";
import { serializeCostAttribution, serializeTaskUsage } from "./cost-attribution.js";
import type { ApprovalLedger, WorkflowSession } from "./human-approval.js";

export type CompletionReportInput = {
  session: WorkflowSession;
  ledger: ApprovalLedger;
  usage?: TaskUsageSummary;
  attribution?: CostAttribution;
  /** REQ-005: approved pr-readiness report content, when the pr stage ran. */
  prReadiness?: string;
};

export type CompletionReport = { markdown: string; consoleSummary: string };

/**
 * FRIC-003: build the usage/cost completion report from data AI Workflow
 * already records. Pure function — no filesystem access.
 */
/** REQ-005: PR readiness lines for the completion report. */
function prReadinessSection(input: CompletionReportInput): string[] {
  const record = input.ledger.stages.pr;
  if (!record) return [];
  if (record.status !== "approved")
    return [
      "## PR readiness",
      "",
      `PR stage ${record.status}: no merge-ready PR evidence recorded (skipped or unresolved).`,
    ];
  // AIW-002 REQ-003: fence-aware section extraction — a `## ` line inside a
  // fenced code block is body content, not the next heading.
  const extract = (heading: string): string => {
    const content = input.prReadiness ?? "";
    const startMatch = content.match(new RegExp(`^## ${heading}\\s*$`, "im"));
    if (!startMatch || startMatch.index === undefined) return "(not recorded)";
    const lines = content.slice(startMatch.index + startMatch[0].length).split("\n");
    const body: string[] = [];
    let fenced = false;
    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        fenced = !fenced;
        body.push(line);
        continue;
      }
      if (!fenced && /^##\s+\S/.test(line)) break;
      body.push(line);
    }
    const text = body.join("\n").trim();
    return text || "(not recorded)";
  };
  return [
    "## PR readiness",
    "",
    `- PR reference: ${extract("PR Reference")}`,
    `- Branch: ${extract("Branch")}`,
    `- CI: ${extract("CI Evidence")}`,
    `- Unresolved review comments: ${extract("Review Comments")}`,
    `- Conflicts: ${extract("Conflict Check")}`,
    `- Merge-ready decision: ${extract("Merge-Ready Checklist")}`,
  ];
}

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
  // REQ-005: PR readiness section, from the approved pr-readiness report.
  const prSection = prReadinessSection(input);
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
    ...prSection,
    "",
  ].join("\n");
  const consoleSummary = usage
    ? serializeTaskUsage(usage)
    : `No usage recorded for workflow ${scope}. Record runs with \`aiw usage-sidecar record --workflow=${scope}\`.`;
  return { markdown, consoleSummary };
}

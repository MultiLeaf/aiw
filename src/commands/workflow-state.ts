import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parse as parseYaml, stringify } from "yaml";
import { resolveStageArtifact, stageArtifactPaths } from "../artifact-paths.js";
import { BlockingError, describeBlockingReason } from "../blocking-reasons.js";
import { buildCompletionReport } from "../completion-report.js";
import {
  computeCostAttribution,
  type CostAttribution,
  summarizeTaskUsage,
  type TaskUsageSummary,
} from "../cost-attribution.js";
import {
  APPROVAL_STAGES,
  createApprovalLedger,
  effectiveLane,
  getUnresolvedPrerequisites,
  invalidateStageAndDescendants,
  parseApprovalLedger,
  parseWorkflowSession,
  processStages,
  serializeApprovalLedger,
  serializeWorkflowSession,
  stageFingerprint,
  type ApprovalLedger,
  type WorkflowProcess,
  type WorkflowSession,
} from "../human-approval.js";
import { assessRisk, collectWorkingTreeChanges, hasCoveringTest } from "../risk-assess.js";
import { parseTraceabilityGraph } from "../traceability.js";
import type { CommandResult, FileSystem, HumanApprovalStage } from "../types.js";
import { parseUsageSidecar, USAGE_SIDECAR_PATH } from "../usage-sidecar.js";
import { stateMismatch } from "./shared.js";
import type { LightEvidence, ObserveDecisionEntry } from "./types.js";

/** Monotonic ADR unix-time stamp (distinct ids within the same millisecond). */
let adrLastStamp = 0;

export function nextAdrStamp(): number {
  const now = Date.now();
  adrLastStamp = now > adrLastStamp ? now : adrLastStamp + 1;
  return adrLastStamp;
}

export function laneAdvisory(
  root: string,
  fs: FileSystem,
  lightChosen: boolean,
): string | undefined {
  const paths = collectWorkingTreeChanges(root);
  if (!paths || paths.length === 0) return undefined;
  const assessment = assessRisk(
    paths.map((path) => ({ path })),
    { hasCoveringTest: hasCoveringTest(root, fs) },
  );
  if (lightChosen && assessment.tier === "high")
    return `advisory: risk assess reports high for the current changes (${assessment.reasons
      .slice(0, 2)
      .map((reason) => reason.code)
      .join(
        ", ",
      )}); consider the full lane, or escalate later with \`aiw task escalate --reason=...\`.`;
  if (!lightChosen && assessment.tier === "passive")
    return "advisory: current changes look passive; the light lane (--lane=light --lane-reason=...) may be viable for small work.";
  return undefined;
}

/** FRIC-002: allocate the next LOCAL-### ticket from current and archived sessions. */
export function nextLocalTicket(fs: FileSystem, aiw: string): string {
  let max = 0;
  const consider = (text: string): void => {
    for (const match of text.matchAll(/^\s*ticket:\s*(LOCAL-(\d+)\s*)$/gm))
      max = Math.max(max, Number(match[2]));
  };
  const sessionPath = join(aiw, "workflow.yml");
  if (fs.exists(sessionPath)) consider(fs.read(sessionPath));
  const checkpoints = join(aiw, "checkpoints");
  if (fs.exists(checkpoints) && fs.list)
    for (const name of fs.list(checkpoints) ?? [])
      if (name.startsWith("workflow-") && name.endsWith("-session.yml"))
        consider(fs.read(join(checkpoints, name)));
  return `LOCAL-${String(max + 1).padStart(3, "0")}`;
}

/** FRIC-005: workflow id of the recorded session, if any. */
export function activeWorkflowId(fs: FileSystem, aiw: string): string | undefined {
  const sessionPath = join(aiw, "workflow.yml");
  if (!fs.exists(sessionPath)) return undefined;
  try {
    return parseWorkflowSession(fs.read(sessionPath)).workflowId;
  } catch {
    return undefined;
  }
}

/** FRIC-005: write path for a stage artifact — scoped when a workflow is active. */
export function stageArtifactWritePath(
  fs: FileSystem,
  aiw: string,
  stage: HumanApprovalStage,
): string {
  const { scoped, legacy } = stageArtifactPaths(aiw, stage, activeWorkflowId(fs, aiw));
  return scoped ?? legacy;
}

/** FRIC-003: gather recorded usage/cost data and write the completion report. Never blocks completion. */
export async function writeCompletionReport(
  fs: FileSystem,
  aiw: string,
  session: WorkflowSession,
  ledger: ApprovalLedger,
): Promise<string> {
  const scope = session.ticket ?? session.workflowId;
  let usage: TaskUsageSummary | undefined;
  let attribution: CostAttribution | undefined;
  try {
    const sidecarPath = join(aiw, USAGE_SIDECAR_PATH);
    if (fs.exists(sidecarPath))
      usage = summarizeTaskUsage(parseUsageSidecar(fs.read(sidecarPath)), scope);
    const tracePath = resolveStageArtifact(fs, aiw, "traceability", session.workflowId).path;
    if (usage && fs.exists(tracePath))
      attribution = computeCostAttribution(
        parseUsageSidecar(fs.read(sidecarPath)),
        parseTraceabilityGraph(fs.read(tracePath)),
      );
  } catch {
    // REQ-003: unreadable usage data degrades to an advisory, never blocks completion.
  }
  let prReadiness: string | undefined;
  try {
    const prPath = resolveStageArtifact(fs, aiw, "pr", session.workflowId).path;
    if (fs.exists(prPath)) prReadiness = fs.read(prPath);
  } catch {
    // REQ-003: unreadable PR evidence degrades the report section, never blocks completion.
  }
  const report = buildCompletionReport({ session, ledger, usage, attribution, prReadiness });
  try {
    const reportDir = join(aiw, "generated/reports");
    if (!fs.exists(reportDir)) fs.mkdir(reportDir);
    fs.write(join(reportDir, `usage-${session.workflowId}.md`), report.markdown);
  } catch {
    // REQ-003: a failed artifact write never blocks completion.
  }
  return report.consoleSummary;
}

export function beginWorkflowSession(
  fs: FileSystem,
  aiw: string,
  options: {
    id?: string;
    ticket?: string;
    title?: string;
    lane?: "light";
    laneReason?: string;
    process?: WorkflowProcess;
    rejectionBudget?: number;
  },
): CommandResult {
  const sessionPath = join(aiw, "workflow.yml");
  const ledgerPath = join(aiw, "approvals.yml");
  if (fs.exists(sessionPath)) {
    const previous = parseWorkflowSession(fs.read(sessionPath));
    if (previous.status === "active")
      throw new BlockingError(
        describeBlockingReason("workflow_still_active", {
          detail: `Workflow ${previous.workflowId} is still active. Complete it before starting another.`,
        }),
      );
    if (!fs.exists(ledgerPath))
      return stateMismatch("Completed workflow is missing its approval ledger.");
    const archive = join(aiw, `checkpoints/workflow-${previous.workflowId}-approvals.yml`);
    if (fs.exists(archive))
      return { exitCode: 1, error: `Workflow approval archive already exists: ${archive}` };
    fs.mkdir(join(aiw, "checkpoints"));
    fs.write(archive, fs.read(ledgerPath));
  } else if (fs.exists(ledgerPath)) {
    return {
      exitCode: 1,
      error: stateMismatch("Approval ledger exists without a workflow session; run doctor.").error,
    };
  }
  const workflowId = options.id ?? randomUUID();
  const priorRun = join(aiw, `checkpoints/workflow-${workflowId}-approvals.yml`);
  if (fs.exists(priorRun))
    return {
      exitCode: 1,
      error: `Workflow ID has already been used: ${workflowId}. Choose a new ID.`,
    };
  const now = new Date().toISOString();
  const session = {
    schema: 1 as const,
    workflowId,
    status: "active" as const,
    startedAt: now,
    updatedAt: now,
    ...(options.ticket ? { ticket: options.ticket } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.lane === "light" && options.laneReason
      ? { lane: "light" as const, laneReason: options.laneReason }
      : {}),
  };
  const ledger = createApprovalLedger(workflowId, {
    ...(options.lane === "light" && options.laneReason
      ? { lane: "light" as const, laneReason: options.laneReason }
      : {}),
    ...(options.process && options.process !== "feature" ? { process: options.process } : {}),
    ...(options.rejectionBudget !== undefined ? { rejectionBudget: options.rejectionBudget } : {}),
  });
  fs.write(ledgerPath, serializeApprovalLedger(ledger));
  fs.write(sessionPath, serializeWorkflowSession(session));
  return { exitCode: 0, output: `Workflow started: ${workflowId}.` };
}

export function approvalArtifactPath(
  fs: FileSystem,
  aiw: string,
  stage: HumanApprovalStage,
): string {
  return resolveStageArtifact(fs, aiw, stage, activeWorkflowId(fs, aiw)).path;
}

export function readWorkflowState(
  aiw: string,
  fs: FileSystem,
  requireActive = true,
): { session: WorkflowSession; ledger: ApprovalLedger } {
  const sessionPath = join(aiw, "workflow.yml");
  const ledgerPath = join(aiw, "approvals.yml");
  if (!fs.exists(sessionPath) || !fs.exists(ledgerPath))
    throw new Error("No SDD workflow is active. Start one with `aiw workflow start`.");
  const session = parseWorkflowSession(fs.read(sessionPath));
  let ledger = parseApprovalLedger(fs.read(ledgerPath));
  if (session.workflowId !== ledger.workflowId)
    throw new BlockingError(
      describeBlockingReason("state_mismatch", {
        detail: "Workflow session and approval ledger IDs do not match; run doctor.",
      }),
    );
  if (requireActive && session.status !== "active")
    throw new BlockingError(
      describeBlockingReason("workflow_complete", {
        detail: `Workflow ${session.workflowId} is complete; start a new workflow first.`,
      }),
    );
  const changed = processStages(ledger).find((stage) => {
    const record = ledger.stages[stage];
    if (!record?.artifactHash || !["pending-human", "approved"].includes(record.status))
      return false;
    const artifact = approvalArtifactPath(fs, aiw, stage);
    return (
      !artifact ||
      !fs.exists(artifact) ||
      stageFingerprint(fs.read(artifact)) !== record.artifactHash
    );
  });
  if (changed) {
    ledger = invalidateStageAndDescendants(ledger, changed, new Date().toISOString());
    fs.write(ledgerPath, serializeApprovalLedger(ledger));
  }
  return { session, ledger };
}

export function readActiveWorkflow(
  aiw: string,
  fs: FileSystem,
): { session: WorkflowSession; ledger: ApprovalLedger } {
  return readWorkflowState(aiw, fs, true);
}

export function workflowNextAction(ledger: ApprovalLedger): string {
  const next = APPROVAL_STAGES.find(
    (stage) =>
      ledger.stages[stage]?.status !== "approved" && ledger.stages[stage]?.status !== "skipped",
  );
  if (!next) return "Next action: all stages are resolved; run aiw workflow complete.";
  if (ledger.stages[next]?.status === "pending-human")
    return `Next action: present ${next} evidence and wait for the human; then run aiw approve ${next} (or reject it).`;
  if (ledger.stages[next]?.status === "stale" || ledger.stages[next]?.status === "rejected")
    return `Next action: revise ${next}, rerun its gate, and request human approval.`;
  return `Next action: prepare ${next} evidence.`;
}

export function parseContextBudgets(aiw: string, fs: FileSystem): Record<string, number> {
  const path = join(aiw, "budgets.yml");
  if (!fs.exists(path)) return {};
  const value: unknown = parseYaml(fs.read(path));
  if (!value || typeof value !== "object") return {};
  const stages = (value as Record<string, unknown>).stages;
  if (!stages || typeof stages !== "object") return {};
  const budgets: Record<string, number> = {};
  for (const [stage, ceiling] of Object.entries(stages as Record<string, unknown>)) {
    const n = Number(ceiling);
    if (Number.isFinite(n) && n > 0) budgets[stage] = n;
  }
  return budgets;
}

const PLAN_PAIR_PATTERN = /Validation:\s*([^→\n]+)→\s*([^\n]+)/g;
const EXIT_PATTERN = /exit\s+(\d+)/i;

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * OPP-014 paired verification: plan tasks declare `Validation: <command> →
 * <expected>`; reports record `Validation: <command> → <observed>`. The gate
 * compares the pairs — command match, observed presence, exit-code agreement.
 * Legacy plans without pair arrows are accepted unchanged (ratchet).
 */
export function compareVerificationPairs(
  aiw: string,
  fs: FileSystem,
  stage: "implementation" | "verification",
): string[] {
  const planPath = resolveStageArtifact(fs, aiw, "plan", activeWorkflowId(fs, aiw)).path;
  if (!fs.exists(planPath)) return [];
  const plan = fs.read(planPath);
  if (!plan.includes("→")) return [];
  const declared: { task: string; command: string; expectedExitText?: string; raw: string }[] = [];
  for (const blockMatch of plan.matchAll(/TASK-\d+[\s\S]*?(?=TASK-\d+|$)/g)) {
    const block = blockMatch[0];
    const taskId = /^\s*(TASK-\d+)/.exec(block)?.[1] ?? "TASK-?";
    for (const pair of block.matchAll(PLAN_PAIR_PATTERN)) {
      const command = pair[1].trim();
      if (!command) continue;
      declared.push({
        task: taskId,
        command,
        expectedExitText: EXIT_PATTERN.exec(pair[2])?.[1],
        raw: pair[2].trim(),
      });
    }
  }
  if (declared.length === 0) return [];
  const reportPath = resolveStageArtifact(
    fs,
    aiw,
    stage === "implementation" ? "implementation" : "verification",
    activeWorkflowId(fs, aiw),
  ).path;
  const issues: string[] = [];
  const observed = new Map<string, string>();
  if (fs.exists(reportPath)) {
    for (const line of fs.read(reportPath).split("\n")) {
      const match = /Validation:\s*([^→\n]+)→\s*([^\n]+)/.exec(line);
      if (match) observed.set(normalizeCommand(match[1]), match[2].trim());
    }
  }
  for (const pair of declared) {
    const key = normalizeCommand(pair.command);
    if (!observed.has(key)) {
      issues.push(`[verification_pair_missing] ${pair.task}: \`${pair.command}\``);
      continue;
    }
    const observedExit = EXIT_PATTERN.exec(observed.get(key) ?? "")?.[1];
    if (pair.expectedExitText && observedExit && pair.expectedExitText !== observedExit) {
      issues.push(
        `[verification_pair_mismatch] ${pair.task}: expected exit ${pair.expectedExitText}, observed exit ${observedExit}`,
      );
    }
  }
  return issues;
}

export function parseLightEvidence(content: string): LightEvidence {
  const value: unknown = parseYaml(content);
  if (!value || typeof value !== "object" || (value as Record<string, unknown>).schema !== 1)
    throw new Error("Light-lane evidence checkpoint must be schema version 1.");
  const record = value as Record<string, unknown>;
  const entries = Array.isArray(record.entries) ? record.entries : [];
  return {
    schema: 1,
    workflowId: String(record.workflowId ?? ""),
    ...(record.ticket !== undefined ? { ticket: String(record.ticket) } : {}),
    lane: "light",
    ...(record.laneReason !== undefined ? { laneReason: String(record.laneReason) } : {}),
    entries: entries.map((entry) => ({
      note: String((entry as Record<string, unknown>).note ?? ""),
      recordedAt: String((entry as Record<string, unknown>).recordedAt ?? ""),
    })),
  };
}

const OBSERVE_DECISIONS_PER_STAGE_CAP = 20;

/** REQ-001: log the decision a gate would make, without mutating stage state. */
export function recordObserveDecision(
  aiw: string,
  fs: FileSystem,
  stage: HumanApprovalStage,
  decision: "pass" | "fail",
  issues: string[],
): string {
  const workflowId = activeWorkflowId(fs, aiw) ?? "none";
  const path = join(aiw, `checkpoints/workflow-${workflowId}-observe.yml`);
  const legacyJsonPath = join(aiw, `checkpoints/workflow-${workflowId}-observe.json`);
  let entries: ObserveDecisionEntry[] = [];
  // AIW-002 REQ-004: YAML is the checkpoint format; a legacy JSON file is
  // migrated losslessly (parsed once, then superseded).
  if (fs.exists(path)) {
    try {
      entries = (parseYaml(fs.read(path)) ?? []) as ObserveDecisionEntry[];
    } catch {
      entries = [];
    }
  } else if (fs.exists(legacyJsonPath)) {
    try {
      entries = JSON.parse(fs.read(legacyJsonPath)) as ObserveDecisionEntry[];
    } catch {
      entries = [];
    }
  }
  const others = entries.filter((entry) => entry.stage !== stage);
  const stageEntries = entries.filter((entry) => entry.stage === stage);
  const entry: ObserveDecisionEntry = {
    stage,
    decision,
    issues,
    recordedAt: new Date().toISOString(),
  };
  const trimmed = [...stageEntries, entry].slice(-OBSERVE_DECISIONS_PER_STAGE_CAP);
  if (!fs.exists(join(aiw, "checkpoints"))) fs.mkdir(join(aiw, "checkpoints"));
  fs.write(path, stringify([...others, ...trimmed], { lineWidth: 0 }));
  if (fs.exists(legacyJsonPath)) fs.remove?.(legacyJsonPath);
  return path;
}

export function assertStageReady(aiw: string, fs: FileSystem, stage: HumanApprovalStage): void {
  const { session, ledger } = readActiveWorkflow(aiw, fs);
  if (!processStages(ledger).includes(stage))
    throw new BlockingError(
      describeBlockingReason("stage_not_in_process", {
        stage,
        detail: `Stage ${stage} is not part of the ${ledger.process ?? "feature"} process for workflow ${session.workflowId}.`,
      }),
    );
  if (effectiveLane(session) === "light")
    throw new BlockingError(
      describeBlockingReason("lane_escalation_required", {
        stage,
        detail: `Light-lane workflow ${session.workflowId} does not author stage artifacts; escalate to the full lane to continue.`,
      }),
    );
  const unresolved = getUnresolvedPrerequisites(ledger, stage);
  if (unresolved.length) {
    const pending = unresolved.filter(
      (prerequisite) => ledger.stages[prerequisite]?.status === "pending-human",
    );
    if (pending.length)
      throw new BlockingError(
        describeBlockingReason("stage_prerequisite_pending", {
          stage,
          pendingStages: pending,
          detail: `Cannot enter ${stage}; previous stage(s) are awaiting human approval: ${pending.join(", ")}.`,
        }),
      );
    throw new BlockingError(
      describeBlockingReason("stage_prerequisite_unresolved", {
        stage,
        unresolvedStages: unresolved,
        detail: `Cannot enter ${stage}; previous stages require human approval or an accepted optional skip: ${unresolved.join(", ")}.`,
      }),
    );
  }
  const current = ledger.stages[stage];
  if (current?.status === "pending-human")
    throw new BlockingError(
      describeBlockingReason("stage_awaiting_approval", {
        stage,
        detail: `${stage} is awaiting human approval. Approve or reject it before continuing.`,
      }),
    );
  if (current?.status === "approved")
    throw new BlockingError(
      describeBlockingReason("stage_already_approved", {
        stage,
        detail: `${stage} is already approved. Evidence changes require rerunning its gate.`,
      }),
    );
}

import { join } from "node:path";
import { stringify } from "yaml";
import { archiveWorkflowArtifacts } from "../artifact-paths.js";
import { BlockingError, describeBlockingReason } from "../blocking-reasons.js";
import {
  buildLaneScopeWatchRequest,
  createOllamaDecisionProvider,
  loadDecisionConfig,
} from "../decision.js";
import { digestPath, extractDigest, serializeDigest } from "../digest.js";
import {
  APPROVAL_STAGES,
  PROCESS_IDS,
  approveStage,
  assertWorkflowId,
  effectiveLane,
  invalidateStageAndDescendants,
  isWorkflowProcess,
  processStages,
  rejectStage,
  rejectionBudgetFor,
  serializeApprovalLedger,
  serializeWorkflowSession,
  skipOptionalStage,
  stageFingerprint,
  validateTaskTicket,
} from "../human-approval.js";
import { collectWorkingTreeChanges } from "../risk-assess.js";
import type { CommandResult, HumanApprovalStage } from "../types.js";
import { installationRequired, parseNamedOptions } from "./shared.js";
import type { CommandContext, CommandHandler } from "./types.js";
import {
  approvalArtifactPath,
  beginWorkflowSession,
  laneAdvisory,
  nextLocalTicket,
  parseLightEvidence,
  readActiveWorkflow,
  readWorkflowState,
  stageArtifactWritePath,
  workflowNextAction,
  writeCompletionReport,
} from "./workflow-state.js";

function handleTask({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const usage =
    "Usage: aiw task start --ticket=TEAM-123 [--title=text] [--id=workflow-id] [--lane=light --lane-reason=text] | aiw task start [--no-ticket] [--title=text] ... | aiw task status | aiw task escalate --reason=text | aiw task evidence --validation=text";
  const action = args[1];
  const sessionPath = join(aiw, "workflow.yml");
  if (action === "start") {
    const noTicket = args.slice(2).includes("--no-ticket");
    const options = parseNamedOptions(
      args.slice(2).filter((argument) => argument !== "--no-ticket"),
      ["ticket", "title", "id", "lane", "lane-reason", "process"],
    );
    if (!options || (noTicket && options.ticket)) return { exitCode: 1, error: usage };
    // FRIC-002: no ticket given (or --no-ticket) — self-serve a local ticket.
    const resolvedTicket = options.ticket ?? nextLocalTicket(fs, aiw);
    validateTaskTicket(resolvedTicket);
    const processName = options.process;
    if (processName !== undefined) {
      if (!isWorkflowProcess(processName))
        return {
          exitCode: 1,
          error: `Unknown process: ${processName}. Known processes: ${PROCESS_IDS.join(", ")}.`,
        };
      if (processName === "feature")
        return {
          exitCode: 1,
          error: "The feature process is the default; omit --process for it.",
        };
    }
    if (options.lane !== undefined && options.lane !== "light")
      return { exitCode: 1, error: "Only --lane=light exists; omit it for the full lane." };
    const laneReason = options["lane-reason"];
    if (options.lane === "light") {
      if (!laneReason)
        return {
          exitCode: 1,
          error: "--lane=light requires --lane-reason: the resume-test call, recorded for audit.",
        };
      if (laneReason.length > 500 || /[\r\n]/.test(laneReason))
        return {
          exitCode: 1,
          error: "--lane-reason must be a single line of at most 500 bytes.",
        };
    }
    if (options.id !== undefined) {
      try {
        assertWorkflowId(options.id);
      } catch {
        return { exitCode: 1, error: "Workflow ID must be a UUID." };
      }
    }
    const lane = options.lane === "light" ? ("light" as const) : undefined;
    const result = beginWorkflowSession(fs, aiw, {
      ...(options.id ? { id: options.id } : {}),
      ticket: resolvedTicket,
      ...(options.title ? { title: options.title } : {}),
      ...(lane ? { lane, laneReason: laneReason! } : {}),
      ...(processName ? { process: processName } : {}),
    });
    if (result.exitCode !== 0) return result;
    const advisory = laneAdvisory(root, fs, lane === "light");
    const title = options.title ? ` titled "${options.title}"` : "";
    if (lane)
      return {
        exitCode: 0,
        output:
          `Task started for ticket ${resolvedTicket}${title} (light lane): ${result.output}\n` +
          (advisory ? `${advisory}\n` : "") +
          "Resume test: this work is small when it is understood, risk is contained, and the work could be resumed from your request plus `git diff`.\n" +
          `Rationale recorded: ${laneReason}\n` +
          'No durable spec/plan artifacts are required. Record validation with `aiw task evidence --validation="<command and result>"`, then complete with `aiw workflow complete`. If scope grows, escalate with `aiw task escalate --reason=...`.',
      };
    return {
      exitCode: 0,
      output:
        `Task started for ticket ${resolvedTicket}${title}: ${result.output}\n` +
        (advisory ? `${advisory}\n` : "") +
        `Next steps: ask the user whether the requirement is clear enough to skip brainstorming (record an accepted skip with \`aiw skip brainstorming --reason="Requirement provided by ticket ${resolvedTicket}"\`), then create the specification with \`aiw spec --ticket=${resolvedTicket} --title=...\`.`,
    };
  }
  if (action === "escalate") {
    const options = parseNamedOptions(args.slice(2), ["reason"]);
    if (!options?.reason)
      return { exitCode: 1, error: "Usage: aiw task escalate --reason=why-scope-grew" };
    if (!fs.exists(sessionPath))
      return { exitCode: 1, error: "No SDD workflow is active. Start one first." };
    const { session } = readWorkflowState(aiw, fs);
    if (session.lane !== "light")
      return {
        exitCode: 1,
        error: "Only light-lane workflows escalate; this one already runs the full lane.",
      };
    if (session.laneEscalatedAt)
      return {
        exitCode: 1,
        error: `Workflow ${session.workflowId} already escalated to the full lane.`,
      };
    const now = new Date().toISOString();
    fs.write(
      sessionPath,
      serializeWorkflowSession({
        ...session,
        laneEscalatedAt: now,
        laneEscalationReason: options.reason,
        updatedAt: now,
      }),
    );
    const evidencePath = join(aiw, `checkpoints/task-light-${session.workflowId}.yml`);
    return {
      exitCode: 0,
      output:
        `Workflow ${session.workflowId} escalated to the full lane.\n` +
        (fs.exists(evidencePath)
          ? `Light-lane evidence preserved and linked: ${evidencePath}\n`
          : "No light-lane evidence had been recorded yet.\n") +
        "Stages now run the full approval sequence from brainstorming.",
    };
  }
  if (action === "evidence") {
    const options = parseNamedOptions(args.slice(2), ["validation"]);
    if (!options?.validation)
      return {
        exitCode: 1,
        error: 'Usage: aiw task evidence --validation="<command and its observed result>"',
      };
    if (!fs.exists(sessionPath))
      return { exitCode: 1, error: "No SDD workflow is active. Start one first." };
    const { session } = readWorkflowState(aiw, fs);
    if (effectiveLane(session) !== "light")
      return {
        exitCode: 1,
        error:
          "Evidence entries are a light-lane command; full-lane workflows record stage artifacts and gates.",
      };
    const evidencePath = join(aiw, `checkpoints/task-light-${session.workflowId}.yml`);
    const existing = fs.exists(evidencePath)
      ? parseLightEvidence(fs.read(evidencePath))
      : {
          schema: 1 as const,
          workflowId: session.workflowId,
          ...(session.ticket ? { ticket: session.ticket } : {}),
          lane: "light" as const,
          ...(session.laneReason ? { laneReason: session.laneReason } : {}),
          entries: [],
        };
    const updated = {
      ...existing,
      entries: [
        ...existing.entries,
        { note: options.validation, recordedAt: new Date().toISOString() },
      ],
    };
    fs.mkdir(join(aiw, "checkpoints"));
    fs.write(evidencePath, stringify({ ...updated }, { lineWidth: 0 }));
    return {
      exitCode: 0,
      output: `Validation evidence recorded (${updated.entries.length} entr${updated.entries.length === 1 ? "y" : "ies"}): ${options.validation}`,
    };
  }
  if (action === "status") {
    if (!fs.exists(sessionPath))
      return {
        exitCode: 0,
        output: "No SDD workflow is active. Start one with `aiw task start --ticket=TEAM-123`.",
      };
    const { session, ledger } = readWorkflowState(aiw, fs, false);
    const lane =
      session.lane === "light"
        ? [
            `Lane: light — ${session.laneEscalatedAt ? `escalated to the full lane (${session.laneEscalationReason})` : session.laneReason}`,
          ]
        : [];
    const lines = [
      ...(session.ticket
        ? [`Ticket: ${session.ticket}${session.title ? ` — ${session.title}` : ""}`]
        : []),
      ...lane,
      `Workflow: ${session.workflowId} (${session.status})`,
      "Stages:",
      ...processStages(ledger).map(
        (stage) => `- ${stage}: ${ledger.stages[stage]?.status ?? "not-started"}`,
      ),
    ];
    if (session.status === "active" && effectiveLane(session) === "light") {
      lines.push(
        'Next: record validation with `aiw task evidence --validation="<command and result>"`, then `aiw workflow complete`. If scope grows: `aiw task escalate --reason=...`.',
      );
      return { exitCode: 0, output: lines.join("\n") };
    }
    const next = APPROVAL_STAGES.find(
      (stage) => (ledger.stages[stage]?.status ?? "not-started") === "not-started",
    );
    if (session.status === "active" && next)
      lines.push(
        `Next: ${next === "brainstorming" && session.ticket ? `decide brainstorm or record an accepted skip (ticket ${session.ticket} already provides the requirement)` : `advance ${next} (gate, approval)`}.`,
      );
    return { exitCode: 0, output: lines.join("\n") };
  }
  return { exitCode: 1, error: usage };
}

async function handleWorkflow({
  args,
  root,
  aiw,
  fs,
  services,
}: CommandContext): Promise<CommandResult> {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const action = args[1];
  const sessionPath = join(aiw, "workflow.yml");
  if (action === "start") {
    const options = parseNamedOptions(
      args.slice(2).filter((argument) => argument !== "--json"),
      ["id", "process", "rejection-budget"],
    );
    if (!options)
      return {
        exitCode: 1,
        error:
          "Usage: aiw workflow start [--id=workflow-id] [--process=bugfix|idea-assessment] [--rejection-budget=number]",
      };
    const processName = options.process;
    if (processName !== undefined && !isWorkflowProcess(processName))
      return {
        exitCode: 1,
        error: `Unknown process: ${processName}. Known processes: ${PROCESS_IDS.join(", ")}.`,
      };
    const budgetRaw = options["rejection-budget"];
    const rejectionBudget = budgetRaw === undefined ? undefined : Number(budgetRaw);
    if (
      rejectionBudget !== undefined &&
      (!Number.isSafeInteger(rejectionBudget) || rejectionBudget < 1)
    )
      return {
        exitCode: 1,
        error: "--rejection-budget must be an integer of at least 1.",
      };
    return beginWorkflowSession(fs, aiw, {
      id: options.id,
      ...(processName ? { process: processName } : {}),
      ...(rejectionBudget !== undefined ? { rejectionBudget } : {}),
    });
  }
  if (action === "status") {
    if (!fs.exists(sessionPath)) return { exitCode: 0, output: "No SDD workflow is active." };
    const { session, ledger } = readWorkflowState(aiw, fs, false);
    const stages = processStages(ledger).map(
      (stage) => `- ${stage}: ${ledger.stages[stage]?.status ?? "not-started"}`,
    );
    return {
      exitCode: 0,
      output: `Workflow ${session.workflowId} (${session.status})\n${stages.join("\n")}\n${workflowNextAction(ledger)}`,
    };
  }
  if (action === "abandon") {
    const options = parseNamedOptions(args.slice(2), ["reason"]);
    if (!options?.reason)
      return { exitCode: 1, error: "Usage: aiw workflow abandon --reason=why-obsolete" };
    if (options.reason.length > 500 || /[\r\n]/.test(options.reason))
      return {
        exitCode: 1,
        error: "--reason must be a single line of at most 500 bytes.",
      };
    if (!fs.exists(sessionPath))
      return {
        exitCode: 1,
        error:
          "No SDD workflow is active; start one with `aiw workflow start` or `aiw task start --ticket=TEAM-123`. [reason: workflow_not_active] Terminal: no automatic continuation beyond starting a workflow.",
      };
    const { session } = readActiveWorkflow(aiw, fs);
    const ledgerPath = join(aiw, "approvals.yml");
    const sessionArchive = join(aiw, "checkpoints", `workflow-${session.workflowId}-session.yml`);
    const ledgerArchive = join(aiw, "checkpoints", `workflow-${session.workflowId}-approvals.yml`);
    fs.mkdir(join(aiw, "checkpoints"));
    const now = new Date().toISOString();
    const archivedSession = {
      ...session,
      status: "abandoned" as const,
      abandonedReason: options.reason,
      updatedAt: now,
    };
    fs.write(sessionArchive, serializeWorkflowSession(archivedSession));
    if (fs.exists(ledgerPath)) fs.write(ledgerArchive, fs.read(ledgerPath));
    fs.remove?.(sessionPath);
    if (fs.exists(ledgerPath)) fs.remove?.(ledgerPath);
    return {
      exitCode: 0,
      output:
        `Workflow ${session.workflowId} abandoned (${options.reason}).\n` +
        `Session archived: ${sessionArchive}\n` +
        (fs.exists(ledgerArchive) ? `Approval ledger archived: ${ledgerArchive}\n` : "") +
        "Start a new one when ready.",
    };
  }
  if (action === "complete") {
    const { session, ledger } = readActiveWorkflow(aiw, fs);
    if (effectiveLane(session) === "light") {
      const evidencePath = join(aiw, `checkpoints/task-light-${session.workflowId}.yml`);
      const hasEntries = fs.exists(evidencePath)
        ? parseLightEvidence(fs.read(evidencePath)).entries.length > 0
        : false;
      if (!hasEntries)
        throw new BlockingError(
          describeBlockingReason("light_evidence_missing", {
            detail: `Light-lane workflow ${session.workflowId} cannot complete without recorded validation evidence.`,
          }),
        );
      fs.write(
        sessionPath,
        serializeWorkflowSession({
          ...session,
          status: "complete",
          updatedAt: new Date().toISOString(),
        }),
      );
      const lightSummary = await writeCompletionReport(fs, aiw, session, ledger);
      const lightArchive = archiveWorkflowArtifacts(fs, aiw, session.workflowId);
      // OPP-007 REQ-003/004: lane mismatch note (always) + optional model scope-watch.
      const laneNotes: string[] = [];
      const mismatch = laneAdvisory(root, fs, true);
      if (mismatch) laneNotes.push(mismatch);
      const decisionConfig = loadDecisionConfig(fs, aiw);
      if (decisionConfig?.enabled) {
        const provider = services.decisionProvider ?? createOllamaDecisionProvider(decisionConfig);
        try {
          if (await provider.available()) {
            const paths = collectWorkingTreeChanges(root) ?? [];
            const response = await provider.decide(
              buildLaneScopeWatchRequest(paths.join("\n") || "no working-tree changes"),
            );
            laneNotes.push(
              `advisory scope-watch: multi_subsystem=${response.answers.multi_subsystem?.choice ?? "unclear"} (advisory-only)`,
            );
          }
        } catch {
          // Advisory flow: provider failures degrade silently.
        }
      }
      if (laneNotes.length) {
        const evidenceFile = fs.exists(evidencePath)
          ? parseLightEvidence(fs.read(evidencePath))
          : null;
        const advisories = laneNotes;
        fs.write(
          evidencePath,
          stringify(
            {
              ...(evidenceFile ?? {
                schema: 1,
                workflowId: session.workflowId,
                ...(session.ticket ? { ticket: session.ticket } : {}),
                lane: "light",
                ...(session.laneReason ? { laneReason: session.laneReason } : {}),
                entries: [],
              }),
              advisories,
            },
            { lineWidth: 0 },
          ),
        );
      }
      return {
        exitCode: 0,
        output:
          `Workflow completed (light lane): ${session.workflowId}. Evidence: ${evidencePath}\n` +
          `${lightSummary}\n` +
          `Report: ${join(aiw, `generated/reports/usage-${session.workflowId}.md`)}` +
          (lightArchive.length
            ? `\nArchived ${lightArchive.length} workflow artifact(s) to checkpoints/workflow-${session.workflowId}-artifacts/.`
            : "") +
          (laneNotes.length ? `\n${laneNotes.join("\n")}` : ""),
      };
    }
    const unresolved = processStages(ledger).filter(
      (stage) =>
        ledger.stages[stage]?.status !== "approved" && ledger.stages[stage]?.status !== "skipped",
    );
    if (unresolved.length)
      return {
        exitCode: 1,
        error: `Workflow cannot complete before every stage is approved or explicitly skipped: ${unresolved.join(", ")}.`,
      };
    fs.write(
      sessionPath,
      serializeWorkflowSession({
        ...session,
        status: "complete",
        updatedAt: new Date().toISOString(),
      }),
    );
    const fullSummary = await writeCompletionReport(fs, aiw, session, ledger);
    const fullArchive = archiveWorkflowArtifacts(fs, aiw, session.workflowId);
    return {
      exitCode: 0,
      output:
        `Workflow completed: ${session.workflowId}.\n` +
        `${fullSummary}\n` +
        `Report: ${join(aiw, `generated/reports/usage-${session.workflowId}.md`)}` +
        (fullArchive.length
          ? `\nArchived ${fullArchive.length} workflow artifact(s) to checkpoints/workflow-${session.workflowId}-artifacts/.`
          : ""),
    };
  }
  return {
    exitCode: 1,
    error: "Usage: aiw workflow <start|status|complete> [options]",
  };
}

function handleApprovalDecision(
  command: "approve" | "reject" | "skip",
  { args, aiw, fs }: CommandContext,
): CommandResult {
  const stage = args[1];
  if (!stage || !APPROVAL_STAGES.includes(stage as HumanApprovalStage))
    return { exitCode: 1, error: `Usage: aiw ${command} <workflow-stage> [options]` };
  const rest = args.slice(2).filter((argument) => argument !== "--json");
  const { session, ledger } = readActiveWorkflow(aiw, fs);
  if (effectiveLane(session) === "light")
    throw new BlockingError(
      describeBlockingReason("lane_escalation_required", {
        detail: `Light-lane workflow ${session.workflowId} does not approve stages; escalate to the full lane to continue.`,
      }),
    );
  const workflowStage = stage as HumanApprovalStage;
  if (command === "skip") {
    const options = parseNamedOptions(rest, ["reason"]);
    if (!options?.reason)
      return {
        exitCode: 1,
        error: "Usage: aiw skip <optional-stage> --reason=human-approved-reason",
      };
    const updated = skipOptionalStage(ledger, workflowStage, {
      reason: options.reason,
      humanAccepted: true,
      updatedAt: new Date().toISOString(),
    });
    fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(updated));
    return { exitCode: 0, output: `Human-approved skip recorded for ${workflowStage}.` };
  }
  const artifact = approvalArtifactPath(fs, aiw, workflowStage);
  if (!artifact || !fs.exists(artifact))
    throw new BlockingError(
      describeBlockingReason("approval_evidence_missing", {
        stage: workflowStage,
        artifactPath: stageArtifactWritePath(fs, aiw, workflowStage),
        detail: `Approval evidence is missing for ${workflowStage}.`,
      }),
    );
  const artifactHash = stageFingerprint(fs.read(artifact));
  if (command === "approve") {
    if (ledger.stages[workflowStage]?.artifactHash !== artifactHash) {
      const invalidated = invalidateStageAndDescendants(
        ledger,
        workflowStage,
        new Date().toISOString(),
      );
      fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(invalidated));
      const existing = ledger.stages[workflowStage];
      if (existing)
        throw new BlockingError(
          describeBlockingReason("approval_stale", {
            stage: workflowStage,
            artifactPath: artifact,
            detail: `The ${workflowStage} artifact changed after review; its approval is stale. Rerun the quality gate and request approval again.`,
          }),
        );
      throw new BlockingError(
        describeBlockingReason("approval_gate_missing", {
          stage: workflowStage,
          artifactPath: artifact,
          detail: `No passing quality gate recorded for ${workflowStage}. Run aiw gate ${workflowStage} before approving.`,
        }),
      );
    }
    const updated = approveStage(ledger, workflowStage, {
      artifactHash,
      updatedAt: new Date().toISOString(),
    });
    fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(updated));
    fs.mkdir(join(aiw, "digests"));
    fs.write(
      digestPath(aiw, workflowStage),
      serializeDigest(extractDigest(workflowStage, fs.read(artifact), artifactHash)),
    );
    return {
      exitCode: 0,
      output: `Human approval recorded for ${workflowStage}. Digest available: aiw digest --stage=${workflowStage}`,
    };
  }
  const options = parseNamedOptions(rest, ["reason"]);
  if (!options?.reason)
    return { exitCode: 1, error: "Usage: aiw reject <stage> --reason=human-feedback" };
  const updated = rejectStage(ledger, workflowStage, options.reason, new Date().toISOString());
  fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(updated));
  const updatedRecord = updated.stages[workflowStage];
  const budget = rejectionBudgetFor(ledger);
  const escalation = updatedRecord?.escalated
    ? `\nEscalation: ${workflowStage} has now been rejected ${updatedRecord.rejectionCount} consecutive time(s) (budget ${budget}). Further gates for this stage are blocked until you either approve a revision or authorize a new attempt with aiw resolve --stage=${workflowStage}. Rejection reasons: ${(updatedRecord.rejectionReasons ?? []).join(" | ")}`
    : `\nRejection ${updatedRecord?.rejectionCount ?? 1} of ${budget} for ${workflowStage} before escalation.`;
  return {
    exitCode: 0,
    output: `Human rejection recorded for ${workflowStage}. Revise this stage.${escalation}`,
  };
}

export const sddLifecycleCommands: Record<string, CommandHandler> = {
  task: handleTask,
  workflow: handleWorkflow,
  approve: (ctx: CommandContext): CommandResult => handleApprovalDecision("approve", ctx),
  reject: (ctx: CommandContext): CommandResult => handleApprovalDecision("reject", ctx),
  skip: (ctx: CommandContext): CommandResult => handleApprovalDecision("skip", ctx),
};

import { join } from "node:path";
import { normalizeTarget } from "../adapter.js";
import { serializeAdapterCapabilities } from "../adapter-contract.js";
import { resolveStageArtifact } from "../artifact-paths.js";
import { BlockingError, describeBlockingReason } from "../blocking-reasons.js";
import { digestFreshness, formatDigestLine } from "../digest.js";
import {
  APPROVAL_STAGES,
  beginStageApproval,
  processStages,
  serializeApprovalLedger,
  stageDefinition,
  stageFingerprint,
  validateTaskTicket,
} from "../human-approval.js";
import {
  forecastIntegration,
  parseOrchestrationPlan,
  parseOrchestrationResults,
} from "../orchestration.js";
import { evaluateQualityGate, triageAdvisories, type QualityGateStage } from "../quality-gates.js";
import { runRiskAssess } from "../risk-assess.js";
import { serializeSelfValidationEvidence, validateTicketId } from "../self-validation.js";
import { buildTraceabilityGraph, serializeTraceabilityGraph } from "../traceability.js";
import type { CommandResult, HumanApprovalStage } from "../types.js";
import { nodeCommandExecutor } from "../vercel-skills.js";
import { installationRequired } from "./shared.js";
import type { CommandContext, CommandHandler } from "./types.js";
import {
  activeWorkflowId,
  approvalArtifactPath,
  assertStageReady,
  compareVerificationPairs,
  nextAdrStamp,
  readActiveWorkflow,
  readWorkflowState,
  recordObserveDecision,
  stageArtifactWritePath,
} from "./workflow-state.js";

function handleBrainstorm({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "brainstorming");
  const title = args.find((arg) => arg.startsWith("--title="))?.slice(8) || "Untitled Brainstorm";
  const path = stageArtifactWritePath(fs, aiw, "brainstorming");
  fs.write(
    path,
    `# ${title}\n\n## Goal\n\n## Users\n\n## Facts\n\n## Assumptions\n\n## Hypotheses\n\n## Constraints\n\n## Risks\n\n## Non-goals\n\n## Open Questions\n\n`,
  );
  return { exitCode: 0, output: `Brainstorm artifact created: ${path}` };
}

function handlePrd({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "product-requirements");
  const title =
    args.find((argument) => argument.startsWith("--title="))?.slice(8) || "Untitled PRD";
  const path = stageArtifactWritePath(fs, aiw, "product-requirements");
  fs.write(
    path,
    `# ${title}\n\n## Problem\n\n## Users\n\n## Outcomes\n\n## Non-goals\n\n## Success Signals\n\n`,
  );
  return { exitCode: 0, output: `Product requirements artifact created: ${path}` };
}

function handlePr({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "pr");
  const title =
    args.find((argument) => argument.startsWith("--title="))?.slice(8) || "Pull Request";
  const path = stageArtifactWritePath(fs, aiw, "pr");
  fs.write(
    path,
    `# ${title}\n\n## PR Reference\n\n<PR number or URL, e.g. #42 or https://github.com/org/repo/pull/42>\n\n## Branch\n\n<feature branch> → <base branch>\n\n## CI Evidence\n\n<command, result, link — e.g. gh pr checks --view compact: all pass>\n\n## Review Comments\n\n<total comments, resolved evidence, and a line: unresolved: 0>\n\n## Conflict Check\n\n<merge state — clean / no conflicts, or conflicts with a resolution plan>\n\n## Merge-Ready Checklist\n\n- [ ] CI green on the PR\n- [ ] All review comments resolved (unresolved: 0)\n- [ ] No merge conflicts with the base branch\n- [ ] Human-only: branch protection and required approvals satisfied\n\n`,
  );
  return {
    exitCode: 0,
    output: `PR readiness artifact created: ${path}. Host-side steps (the CLI never runs these): push the branch (git push -u origin <branch>), open the PR (gh pr create --base <base> --title <title>), watch CI (gh pr checks), resolve review comments (triage: auto-fixable may be automated; judgment-required surface to the human), re-check conflicts (aiw orchestrate integrate or the forge's update-branch), then fill the report and run aiw gate pr.`,
  };
}

function handleSpec({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "specification");
  const title =
    args.find((arg) => arg.startsWith("--title="))?.slice(8) || "Untitled Specification";
  const ticket = args.find((arg) => arg.startsWith("--ticket="))?.slice(9);
  if (ticket !== undefined) validateTaskTicket(ticket);
  const path = stageArtifactWritePath(fs, aiw, "specification");
  fs.write(
    path,
    `# ${title}\n${ticket ? `\n> Ticket: ${ticket}\n` : ""}\n## Context\n\n## Requirements\n\n### REQ-001: Requirement title\n\n- **Description:**\n- **Acceptance criteria:**\n  - Given\n  - When\n  - Then\n\n## Non-functional Requirements\n\n## Constraints\n\n## Open Questions\n\n`,
  );
  return { exitCode: 0, output: `Specification artifact created: ${path}` };
}

function handleAdr({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "technical-design");
  const explicitId = args.find((arg) => arg.startsWith("--id="))?.slice(5);
  const title = args.find((arg) => arg.startsWith("--title="))?.slice(8) || "Untitled Decision";
  // Unix-time (ms) default: chronological sequence, collision-resistant.
  // A monotonic guard guarantees distinct ids even within the same
  // millisecond; same-ms creations bump until the path is free.
  const slug = title.toLowerCase().replaceAll(" ", "-");
  let stamp = nextAdrStamp();
  if (!explicitId)
    while (fs.exists(join(root, ".context/adrs", `ADR-${stamp}-${slug}.md`)))
      stamp = nextAdrStamp();
  const id = explicitId ?? String(stamp);
  const path = join(root, ".context/adrs", `ADR-${id}-${slug}.md`);
  fs.write(
    path,
    `# ADR-${id}: ${title}\n\n- **Status:** proposed\n- **Related artifacts:**\n  - .aiw/generated/specs/\n\n## Context\n\n## Alternatives\n\n1. **Alternative A** — Description and trade-offs.\n2. **Alternative B** — Description and trade-offs.\n\n## Decision\n\n## Rationale\n\n## Consequences\n\n`,
  );
  return { exitCode: 0, output: `Architecture decision record created: ${path}` };
}

function handlePlan({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "plan");
  const title =
    args.find((arg) => arg.startsWith("--title="))?.slice(8) || "Untitled Implementation Plan";
  const path = stageArtifactWritePath(fs, aiw, "plan");
  fs.write(
    path,
    `# ${title}\n\n## Linked Requirements\n\n- REQ-001: Link to the specification requirement.\n\n## Tasks\n\n- [ ] TASK-001: Implement the first increment.\n  - Requirement: REQ-001\n  - Code: src/\n  - Tests: src/**/*.test.ts\n  - Validation: npm test → exit 0\n  - Regression: <optional — touched existing behavior → the test proving it holds>\n  - Evidence: Record the passing command output and changed files.\n\n## Validation Commands\n\n- npm run check\n\n## Risks and Dependencies\n\n- Dependencies: List prerequisite tasks, packages, or decisions.\n- Risks: Record delivery, compatibility, and validation risks with mitigations.\n\n## Completion Evidence\n\n- TASK-001: Link code changes, test results, and validation output.\n\n`,
  );
  return { exitCode: 0, output: `Implementation plan created: ${path}` };
}

function handleVerify({ aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "verification");
  const specPath = resolveStageArtifact(fs, aiw, "specification", activeWorkflowId(fs, aiw)).path;
  const planPath = resolveStageArtifact(fs, aiw, "plan", activeWorkflowId(fs, aiw)).path;
  const issues: string[] = [];
  let regressionNotice: string | undefined;
  let specification = "";
  if (!fs.exists(specPath)) issues.push("Specification artifact is missing.");
  else {
    specification = fs.read(specPath);
    if (!specification.toLowerCase().includes("acceptance criteria"))
      issues.push("Requirements have no acceptance criteria.");
  }
  if (!fs.exists(planPath)) issues.push("Implementation plan is missing.");
  else {
    const plan = fs.read(planPath);
    if (!plan.includes("Validation"))
      issues.push("Requirements have no linked validation commands.");
    const requirements = [...new Set([...specification.matchAll(/REQ-\d+/g)].map(String))];
    const uncovered = requirements.filter((requirement) => !plan.includes(requirement));
    if (uncovered.length > 0) issues.push(`Untested requirements: ${uncovered.join(", ")}.`);
    const validationCount = (plan.match(/Validation:/g) ?? []).length;
    const regressionCount = (plan.match(/Regression:/g) ?? []).length;
    regressionNotice =
      validationCount > regressionCount
        ? `${validationCount - regressionCount} of ${validationCount} plan tasks declare no regression coverage for touched existing behavior.`
        : undefined;
  }
  return issues.length
    ? { exitCode: 1, error: `Verification failed: ${issues.join(" ")}` }
    : {
        exitCode: 0,
        output:
          "Verification passed: requirements have acceptance criteria and validation coverage." +
          (regressionNotice ? ` Advisory: ${regressionNotice}` : ""),
      };
}

function handleTrace({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "traceability");
  const specPath = resolveStageArtifact(fs, aiw, "specification", activeWorkflowId(fs, aiw)).path;
  const planPath = resolveStageArtifact(fs, aiw, "plan", activeWorkflowId(fs, aiw)).path;
  if (!fs.exists(specPath) || !fs.exists(planPath))
    return {
      exitCode: 1,
      error: "Traceability requires a specification and implementation plan.",
    };
  const adrDirectory = join(root, ".context/adrs");
  const decisions = (fs.list?.(adrDirectory) ?? [])
    .filter((file) => /^ADR-.+\.md$/.test(file))
    .map((file) => ({
      id: file.replace(/\.md$/, "").split("-").slice(0, 2).join("-"),
      content: fs.read(join(adrDirectory, file)),
    }));
  const graph = buildTraceabilityGraph({
    specification: fs.read(specPath),
    plan: fs.read(planPath),
    decisions,
  });
  const requirement = args.find((arg) => arg.startsWith("--requirement="))?.slice(14);
  const serialized = serializeTraceabilityGraph(graph, requirement);
  if (requirement) return { exitCode: 0, output: serialized };
  const path = stageArtifactWritePath(fs, aiw, "traceability");
  fs.write(path, serialized);
  return { exitCode: 0, output: `Traceability graph created: ${path}` };
}

function handleDigest({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const stageArg = args.find((argument) => argument.startsWith("--stage="))?.slice(8);
  const stages = stageArg
    ? [stageArg as HumanApprovalStage]
    : fs.exists(join(aiw, "workflow.yml"))
      ? processStages(readWorkflowState(aiw, fs, false).ledger)
      : [...APPROVAL_STAGES];
  const lines: string[] = [];
  let served = 0;
  for (const stage of stages) {
    const artifactPath = approvalArtifactPath(fs, aiw, stage);
    const freshness = digestFreshness(aiw, fs, stage, artifactPath ?? undefined);
    if (freshness.state === "missing") continue;
    lines.push(formatDigestLine(freshness));
    served += 1;
  }
  if (lines.length === 0)
    return {
      exitCode: 0,
      output:
        "No digests yet: digests appear when stages pass their gate and receive human approval.",
    };
  lines.push(`served: ${served} digest${served === 1 ? "" : "s"} (full reads on demand)`);
  return { exitCode: 0, output: lines.join("\n") };
}

function handleDiagnosis({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "diagnosis");
  const title =
    args.find((argument) => argument.startsWith("--title="))?.slice(8) || "Untitled Diagnosis";
  const path = stageArtifactWritePath(fs, aiw, "diagnosis");
  fs.write(
    path,
    `# ${title}\n\n## Reproduction\n\n- Command: \`<command that reproduces the bug>\`\n- Observed: <what actually happens>\n\n## Expected\n\n- <the correct behavior>\n\n## Root Cause\n\n- <evidence-backed cause, file:line when known>\n\n## Scope\n\n- In scope: <files and behavior this fix touches>\n- Out of scope: <explicitly excluded>\n`,
  );
  return { exitCode: 0, output: `Diagnosis artifact created: ${path}` };
}

function handleAssess({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  assertStageReady(aiw, fs, "assessment");
  const title =
    args.find((argument) => argument.startsWith("--title="))?.slice(8) || "Untitled Assessment";
  const path = stageArtifactWritePath(fs, aiw, "assessment");
  fs.write(
    path,
    `# ${title}\n\n## Evidence\n\n- <attributed evidence: source, finding>\n\n## Outcome\n\ngo | clarify | stop\n\n## Rationale\n\n- <why this outcome follows from the evidence>\n\n## Next Step\n\n- <go: recommended feature scope · clarify: the open questions · stop: conditions that would reopen>\n`,
  );
  return { exitCode: 0, output: `Assessment artifact created: ${path}` };
}

async function handleRisk({ args, root, fs, services }: CommandContext): Promise<CommandResult> {
  if (args[1] !== "assess")
    return { exitCode: 1, error: "Usage: aiw risk assess [--base-ref=ref] [--json]" };
  return runRiskAssess(args.slice(2), root, fs, services.embeddingProvider);
}

function handleGate({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const stage = args[1];
  if (!stage || !APPROVAL_STAGES.includes(stage as HumanApprovalStage))
    return {
      exitCode: 1,
      error: `Usage: aiw gate <${APPROVAL_STAGES.join("|")}>`,
    };
  const workflowStage = stage as HumanApprovalStage;
  const observe = args.slice(2).includes("--observe");
  if (!observe) assertStageReady(aiw, fs, workflowStage);
  const { ledger: gateLedger } = readActiveWorkflow(aiw, fs);
  const stageRecord = gateLedger.stages[workflowStage];
  if (stageRecord?.escalated && !observe)
    throw new BlockingError(
      describeBlockingReason("stage_escalated", {
        stage,
        detail: `Stage ${stage} is escalated after ${stageRecord.rejectionCount} consecutive rejection(s). The gate is blocked until a human records an explicit decision: approve a revision as-is, or authorize a new attempt with aiw resolve --stage=${stage}. Rejections so far: ${(stageRecord.rejectionReasons ?? []).join(" | ")}`,
      }),
    );
  const artifactPath = approvalArtifactPath(fs, aiw, workflowStage);
  if (!artifactPath || !fs.exists(artifactPath))
    throw new BlockingError(
      describeBlockingReason("gate_evidence_missing", {
        stage,
        artifactPath: stageArtifactWritePath(fs, aiw, workflowStage),
        detail: `Quality gate blocked: required evidence is missing for ${stage}.`,
      }),
    );
  const hasQualityGate = stageDefinition(workflowStage).requiresQualityGate;
  const gateIssues = hasQualityGate
    ? evaluateQualityGate(stage as QualityGateStage, fs.read(artifactPath))
    : [];
  // REQ-004: ADR links declared by the design must exist on disk.
  if (workflowStage === "technical-design")
    for (const match of fs.read(artifactPath).matchAll(/\.context\/adrs\/(ADR-[^\s)]+\.md)/g)) {
      const adrPath = join(root, ".context/adrs", match[1]);
      if (!fs.exists(adrPath))
        gateIssues.push(`Consequential decision links a missing ADR file: ${match[1]}`);
    }
  // REQ-001 (AIW-002): auto-consume the orchestration merge forecast for
  // the PR stage — but only from a plan whose task branches match the PR
  // report's declared branch; recorded evidence remains the fallback.
  if (workflowStage === "pr") {
    const checkpointDir = join(aiw, "checkpoints");
    const orchestrationFiles = (fs.list?.(checkpointDir) ?? []).filter(
      (file) => file.startsWith("orchestration-") && file.endsWith(".yml"),
    );
    if (orchestrationFiles.length > 0) {
      // The declared feature branch, e.g. "feature/x → main" or "aiw/plan1/TASK-001".
      const branchSection = fs
        .read(artifactPath)
        .match(/^## Branch\s*$([\s\S]*?)(?=^## |(?![\s\S]))/im)?.[1]
        ?.trim();
      const declaredBranch = branchSection?.split(/[\n\u2192]/)[0]?.trim() ?? "";
      const planIds = orchestrationFiles
        .map((file) => /^orchestration-([a-z0-9-]+)\.yml$/.exec(file)?.[1])
        .filter((id): id is string => Boolean(id));
      const planCandidates = [
        ...(fs.exists(join(root, "orchestration.yml"))
          ? [parseOrchestrationPlan(fs.read(join(root, "orchestration.yml")))]
          : []),
        ...planIds.flatMap((id) => {
          const planPath = join(root, `orchestration-${id}.yml`);
          if (!fs.exists(planPath)) return [];
          try {
            return [parseOrchestrationPlan(fs.read(planPath))];
          } catch {
            return [];
          }
        }),
      ];
      for (const plan of planCandidates) {
        // Only consume the plan whose task branches relate to the PR's branch.
        if (declaredBranch && !declaredBranch.startsWith(`aiw/${plan.id}/`)) continue;
        const checkpoint = orchestrationFiles.find(
          (file) => file === `orchestration-${plan.id}.yml`,
        );
        if (!checkpoint) continue;
        try {
          const results = parseOrchestrationResults(fs.read(join(checkpointDir, checkpoint)));
          const forecast = forecastIntegration(root, plan, results);
          const conflicts = forecast.filter((line) => line.state === "conflict");
          if (conflicts.length > 0)
            gateIssues.push(
              `Orchestration merge forecast reports conflicts: ${conflicts
                .map((line) => `${line.taskId} (${(line.conflicts ?? []).join(", ")})`)
                .join("; ")}`,
            );
        } catch {
          // Not a git repository or the checkpoint drifted: fall back to recorded evidence.
        }
      }
    }
  }
  const pairIssues =
    hasQualityGate && (workflowStage === "implementation" || workflowStage === "verification")
      ? compareVerificationPairs(aiw, fs, workflowStage)
      : [];
  if (observe) {
    const path = recordObserveDecision(
      aiw,
      fs,
      workflowStage,
      gateIssues.length + pairIssues.length === 0 ? "pass" : "fail",
      [...gateIssues, ...pairIssues],
    );
    const findings = [...gateIssues, ...pairIssues];
    return {
      exitCode: 0,
      output: `Observe mode: gate would ${findings.length ? `fail for ${stage} (${findings.length} issue(s))` : `pass for ${stage}`}. No workflow state was changed; run aiw gate ${stage} to record the real decision. Findings logged to ${path}.`,
    };
  }
  if (gateIssues.length)
    throw new BlockingError(
      describeBlockingReason("gate_incomplete", {
        stage,
        artifactPath,
        gateIssues,
        detail: `Quality gate blocked: ${gateIssues.join(" ")}`,
      }),
    );
  if (pairIssues.length)
    throw new BlockingError(
      describeBlockingReason("gate_incomplete", {
        stage,
        artifactPath,
        gateIssues: pairIssues,
        detail: `Quality gate blocked: ${pairIssues.join(" ")}`,
      }),
    );
  const { ledger } = readActiveWorkflow(aiw, fs);
  const advisories = hasQualityGate
    ? triageAdvisories(stage as QualityGateStage, fs.read(artifactPath))
    : [];
  const updated = beginStageApproval(ledger, workflowStage, {
    artifactHash: stageFingerprint(fs.read(artifactPath)),
    qualityGate: hasQualityGate ? "passed" : "not-applicable",
    updatedAt: new Date().toISOString(),
  });
  fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(updated));
  return {
    exitCode: 0,
    output: `${hasQualityGate ? `Quality gate passed for ${stage}.` : `Evidence recorded for ${stage}; no automated quality gate applies.`} Human approval is still required: run aiw approve ${stage}.${resolveStageArtifact(fs, aiw, workflowStage, activeWorkflowId(fs, aiw)).legacyFallback ? ` Advisory: ${stage} artifact read from the legacy fixed path; new writes go to the workflow-scoped path.` : ""}${advisories.length ? ` ${advisories.join(" ")}` : ""}`,
  };
}

async function handleSelfValidate({
  args,
  root,
  aiw,
  fs,
  services,
}: CommandContext): Promise<CommandResult> {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const ticket = args.find((arg) => arg.startsWith("--ticket="))?.slice(9);
  if (!ticket) return { exitCode: 1, error: "Usage: aiw self-validate --ticket=TYPE-000" };
  validateTicketId(ticket);
  const requiredState = ["manifest.yml", "profile.yml", "lock.yml"];
  const missing = requiredState.filter((path) => !fs.exists(join(aiw, path)));
  if (missing.length)
    return { exitCode: 1, error: `Self-validation state is missing: ${missing.join(", ")}` };
  const result = await (services.selfValidation ?? nodeCommandExecutor).execute([
    "npm",
    "--prefix",
    root,
    "run",
    "check",
  ]);
  const generatedRoot = join(aiw, "generated");
  const generatedArtifacts = (fs.listFiles?.(generatedRoot) ?? []).map(
    (path) => `.aiw/generated/${path}`,
  );
  const evidencePath = join(aiw, `checkpoints/self-validation-${ticket.toLowerCase()}.yml`);
  fs.write(
    evidencePath,
    serializeSelfValidationEvidence({
      ticket,
      command: "npm run check",
      exitCode: result.exitCode,
      requiredState: requiredState.map((path) => `.aiw/${path}`),
      generatedArtifacts,
    }),
  );
  return result.exitCode === 0
    ? { exitCode: 0, output: `Self-validation passed: ${evidencePath}` }
    : { exitCode: 1, error: `Self-validation failed: ${result.stdout}` };
}

function handleCapabilities({ args }: CommandContext): CommandResult {
  const rawTarget = args.find((arg) => arg.startsWith("--target="))?.slice(9) ?? "universal";
  return { exitCode: 0, output: serializeAdapterCapabilities(normalizeTarget(rawTarget)) };
}

export const sddArtifactsCommands: Record<string, CommandHandler> = {
  brainstorm: handleBrainstorm,
  prd: handlePrd,
  pr: handlePr,
  spec: handleSpec,
  adr: handleAdr,
  plan: handlePlan,
  verify: handleVerify,
  trace: handleTrace,
  digest: handleDigest,
  diagnosis: handleDiagnosis,
  assess: handleAssess,
  risk: handleRisk,
  gate: handleGate,
  "self-validate": handleSelfValidate,
  capabilities: handleCapabilities,
};

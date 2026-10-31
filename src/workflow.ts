import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { BASE_DIRECTORIES, WORKFLOW_DIRECTORY } from "./constants.js";
import {
  detectTarget,
  isTarget,
  renderAiInit,
  describeResource,
  renderAiInitPath,
  renderResourcePath,
} from "./adapter.js";
import { loadBundledResources } from "./bundled-resources.js";
import {
  assertSafeProjectPath,
  withSafeProjectWrites,
  writeProjectFilesAtomically,
} from "./files.js";
import { parseProjectProfile, profileProject } from "./profile.js";
import type { ProjectProfile } from "./profile.js";
import type { CommandResult, FileSystem, HumanApprovalStage } from "./types.js";
import type { FactOverride } from "./confirmation.js";
import { applyOverrides } from "./confirmation.js";
import { mergeFacts } from "./intelligence.js";
import { configureOptionalModels } from "./model-onboarding.js";
import {
  createInterpretationRequest,
  createOpenAiCompatibleProvider,
  createProjectInterpreter,
  type AiProviderUsage,
  buildInterpreterQuery,
  loadAiProviderConfig,
  selectInterpreterKeyFiles,
} from "./interpreter.js";
import {
  recommendCapabilities,
  rankRecommendations,
  resourcesForCapabilities,
  serializeRecommendations,
  type RankedRecommendations,
} from "./recommendations.js";
import { selectRecommendations } from "./selection.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

async function readStdin(): Promise<string> {
  const terminal = createInterface({ input: stdin });
  try {
    return await new Promise<string>((resolve, reject) => {
      let data = "";
      stdin.on("data", (chunk) => (data += chunk));
      stdin.on("end", () => resolve(data));
      stdin.on("error", reject);
    });
  } finally {
    terminal.close();
  }
}
import { generateProjectResources } from "./generator.js";
import { detectDrift } from "./drift.js";
import { parseManifest, serializeManifest } from "./manifest.js";
import {
  createOwnedFile,
  parseOwnership,
  serializeOwnership,
  type OwnershipMetadata,
} from "./ownership.js";
import type { WorkflowDependencies } from "./services.js";
import { validatePackageContract } from "./package-contract.js";
import { parseLock, resolvePackage, serializeLock } from "./lockfile.js";
import { executeVercelSkills, installVercelSkill, nodeCommandExecutor } from "./vercel-skills.js";
import { scanProject } from "./scanner.js";
import { readFactOverrides, saveSettingOverrides, saveSettingsSection } from "./settings.js";
import {
  buildEvidenceTriageRequest,
  buildRecommendationRankingRequest,
  buildSemanticRerankRequest,
  createOllamaDecisionProvider,
  loadDecisionConfig,
} from "./decision.js";
import {
  buildSemanticIndex,
  createOllamaEmbeddingProvider,
  loadSemanticConfig,
  parseSemanticIndex,
  querySemanticIndex,
  rerankSemanticMatches,
  type RerankedMatch,
  SEMANTIC_INDEX_PATH,
  serializeSemanticIndex,
} from "./semantic.js";
import {
  assertKnownPermissions,
  assertPermissions,
  assertPackagePermissions,
  serializePermissionReview,
} from "./package-audit.js";
import { planPackageUpdate } from "./package-updates.js";
import { searchRegistry, serializeRegistry, type RegistryPackage } from "./registry.js";
import {
  checksumPackage,
  checksumPackageSnapshot,
  verifyPackageProvenance,
} from "./package-integrity.js";
import { nodePackageSourceLoader, requiresExternalNetwork, resolveProvider } from "./providers.js";
import { serializeSelfValidationEvidence, validateTicketId } from "./self-validation.js";
import {
  enforceOrganizationPolicy,
  parseOrganizationPolicy,
  serializeOrganizationPolicy,
  type PackagePolicySubject,
} from "./organization-policy.js";
import {
  composeContext,
  CONTEXT_LAYERS,
  readContextStore,
  writeContextLayer,
  type ContextLayer,
} from "./context-store.js";
import { loadContextDelta, retrieveTaskContext } from "./context-retrieval.js";
import {
  createSummaryCache,
  isSummaryFresh,
  parseSummaryCache,
  serializeSummaryCache,
} from "./context-cache.js";
import {
  parseTokenUsage,
  recordTokenUsage,
  serializeTokenUsage,
  summarizeUsageByModel,
} from "./token-usage.js";
import {
  APPROVAL_STAGES,
  assertWorkflowId,
  validateTaskTicket,
  approveStage,
  beginStageApproval,
  createApprovalLedger,
  getUnresolvedPrerequisites,
  invalidateStageAndDescendants,
  parseApprovalLedger,
  parseWorkflowSession,
  rejectStage,
  serializeApprovalLedger,
  serializeWorkflowSession,
  skipOptionalStage,
  stageDefinition,
  stageFingerprint,
  type ApprovalLedger,
  type WorkflowSession,
  effectiveLane,
} from "./human-approval.js";
import { parse as parseYaml, stringify } from "yaml";
import { measureContextQuality, serializeContextQuality } from "./context-quality.js";
import {
  collectContextBench,
  compareContextBench,
  parseContextBench,
  serializeContextBench,
} from "./context-benchmark.js";
import {
  materializeParityTask,
  parseParityTask,
  runParitySuite,
  serializeParitySuite,
  TASK_ASSEMBLER,
} from "./task-parity.js";
import {
  appendUsageSidecarEntry,
  parseUsageSidecar,
  serializeUsageSidecar,
  serializeUsageSidecarSummary,
  summarizeUsageSidecar,
  USAGE_SIDECAR_PATH,
  USAGE_TIERS,
  type UsageSidecarEntry,
} from "./usage-sidecar.js";
import {
  mergeImportedEvents,
  parseClaudeCodeTranscript,
  parseCodexSession,
  parseGeminiTranscript,
  parsePiSession,
  summarizeImport,
  type ImportResult,
  type ImportSource,
} from "./usage-import.js";
import {
  describeHeartbeatOutcome,
  emptyHeartbeatState,
  HEARTBEAT_STATE_PATH,
  HEARTBEAT_TTL_SECONDS,
  HEARTBEAT_WARN_SECONDS,
  parseHeartbeatState,
  recordBeat,
  serializeHeartbeatCheckpoint,
  serializeHeartbeatState,
  validateHeartbeatThresholds,
} from "./heartbeat.js";
import {
  installHeartbeatHooks,
  parseClaudeSettings,
  writeClaudeSettings,
} from "./hook-installer.js";
import {
  computeCostAttribution,
  serializeCostAttribution,
  serializeTaskUsage,
  summarizeTaskUsage,
} from "./cost-attribution.js";
import {
  defaultRoutingTable,
  parseRoutingTable,
  resolveRoute,
  ROUTING_TABLE_PATH,
  serializeResolvedRoute,
  serializeRoutingTable,
} from "./model-routing.js";
import { parseTraceabilityGraph } from "./traceability.js";
import { serializeAdapterCapabilities } from "./adapter-contract.js";
import { buildTraceabilityGraph, serializeTraceabilityGraph } from "./traceability.js";
import { evaluateQualityGate, type QualityGateStage } from "./quality-gates.js";
import { BlockingError, blockingResultToJson, describeBlockingReason } from "./blocking-reasons.js";
import { runRiskAssess } from "./risk-assess.js";
import {
  type MigrationSnapshot,
  type ResourceMigration,
  type MigrationDiagnostic,
  parseMigrationCheckpoint,
  planNeutralResourceMigration,
  readResourceBytes,
  serializeMigrationPreview,
  serializeMigrationCheckpoint,
  validateNeutralResourceDocument,
  writeResourceBytes,
} from "./migration.js";
import {
  parsePrivateRegistries,
  parseTeamPreset,
  serializePrivateRegistries,
  serializeTeamPreset,
  fetchPrivateRegistryClient,
} from "./team-configuration.js";
import { enforcePolicyGate, gitPolicyTracking } from "./policy-gate.js";
import {
  DEFAULT_TELEMETRY_CONFIG,
  loadTelemetryConfig,
  offerTelemetryConsent,
  parseTelemetryConfig,
  purgeTelemetryBuffer,
  readTelemetryBuffer,
  serializeTelemetryMapping,
  TELEMETRY_BUFFER_CAP,
  TELEMETRY_BUFFER_FILE,
} from "./telemetry.js";
import {
  createPluginScaffold,
  validatePluginDirectory,
  writePluginScaffold,
} from "./plugin-sdk.js";
import {
  executeOrchestrationPlan,
  parseOrchestrationPlan,
  serializeOrchestrationPreview,
  serializeOrchestrationResults,
  validateOrchestrationParallelism,
} from "./orchestration.js";

export type WorkflowServices = WorkflowDependencies;

function beginWorkflowSession(
  fs: FileSystem,
  aiw: string,
  options: {
    id?: string;
    ticket?: string;
    title?: string;
    lane?: "light";
    laneReason?: string;
  },
): CommandResult {
  const sessionPath = join(aiw, "workflow.yml");
  const ledgerPath = join(aiw, "approvals.yml");
  if (fs.exists(sessionPath)) {
    const previous = parseWorkflowSession(fs.read(sessionPath));
    if (previous.status === "active")
      return {
        exitCode: 1,
        error: `Workflow ${previous.workflowId} is still active. Complete it before starting another.`,
      };
    if (!fs.exists(ledgerPath))
      return { exitCode: 1, error: "Completed workflow is missing its approval ledger." };
    const archive = join(aiw, `checkpoints/workflow-${previous.workflowId}-approvals.yml`);
    if (fs.exists(archive))
      return { exitCode: 1, error: `Workflow approval archive already exists: ${archive}` };
    fs.mkdir(join(aiw, "checkpoints"));
    fs.write(archive, fs.read(ledgerPath));
  } else if (fs.exists(ledgerPath)) {
    return {
      exitCode: 1,
      error: "Approval ledger exists without a workflow session; run doctor.",
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
  });
  fs.write(ledgerPath, serializeApprovalLedger(ledger));
  fs.write(sessionPath, serializeWorkflowSession(session));
  return { exitCode: 0, output: `Workflow started: ${workflowId}.` };
}

export async function runCommand(
  args: string[],
  root: string,
  fs: FileSystem,
  services: WorkflowServices = {},
): Promise<CommandResult> {
  const aiw = join(root, WORKFLOW_DIRECTORY);
  try {
    fs = withSafeProjectWrites(fs, root);
    const command = args[0] ?? "help";
    if (command === "task") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const usage =
        "Usage: aiw task start --ticket=TEAM-123 [--title=text] [--id=workflow-id] [--lane=light --lane-reason=text] | aiw task status | aiw task escalate --reason=text | aiw task evidence --validation=text";
      const action = args[1];
      const sessionPath = join(aiw, "workflow.yml");
      if (action === "start") {
        const options = parseNamedOptions(args.slice(2), [
          "ticket",
          "title",
          "id",
          "lane",
          "lane-reason",
        ]);
        if (!options?.ticket) return { exitCode: 1, error: usage };
        validateTaskTicket(options.ticket);
        if (options.lane !== undefined && options.lane !== "light")
          return { exitCode: 1, error: "Only --lane=light exists; omit it for the full lane." };
        const laneReason = options["lane-reason"];
        if (options.lane === "light") {
          if (!laneReason)
            return {
              exitCode: 1,
              error:
                "--lane=light requires --lane-reason: the resume-test call, recorded for audit.",
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
          ticket: options.ticket,
          ...(options.title ? { title: options.title } : {}),
          ...(lane ? { lane, laneReason: laneReason! } : {}),
        });
        if (result.exitCode !== 0) return result;
        const title = options.title ? ` titled "${options.title}"` : "";
        if (lane)
          return {
            exitCode: 0,
            output:
              `Task started for ticket ${options.ticket}${title} (light lane): ${result.output}\n` +
              "Resume test: this work is small when it is understood, risk is contained, and the work could be resumed from your request plus `git diff`.\n" +
              `Rationale recorded: ${laneReason}\n` +
              'No durable spec/plan artifacts are required. Record validation with `aiw task evidence --validation="<command and result>"`, then complete with `aiw workflow complete`. If scope grows, escalate with `aiw task escalate --reason=...`.',
          };
        return {
          exitCode: 0,
          output:
            `Task started for ticket ${options.ticket}${title}: ${result.output}\n` +
            `Next steps: ask the user whether the requirement is clear enough to skip brainstorming (record an accepted skip with \`aiw skip brainstorming --reason="Requirement provided by ticket ${options.ticket}"\`), then create the specification with \`aiw spec --ticket=${options.ticket} --title=...\`.`,
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
          ...APPROVAL_STAGES.map(
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
    if (command === "workflow") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const action = args[1];
      const sessionPath = join(aiw, "workflow.yml");
      if (action === "start") {
        const options = parseNamedOptions(args.slice(2), ["id"]);
        if (!options) return { exitCode: 1, error: "Usage: aiw workflow start [--id=workflow-id]" };
        return beginWorkflowSession(fs, aiw, { id: options.id });
      }
      if (action === "status") {
        if (!fs.exists(sessionPath)) return { exitCode: 0, output: "No SDD workflow is active." };
        const { session, ledger } = readWorkflowState(aiw, fs, false);
        const stages = APPROVAL_STAGES.map(
          (stage) => `- ${stage}: ${ledger.stages[stage]?.status ?? "not-started"}`,
        );
        return {
          exitCode: 0,
          output: `Workflow ${session.workflowId} (${session.status})\n${stages.join("\n")}\n${workflowNextAction(ledger)}`,
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
          return {
            exitCode: 0,
            output: `Workflow completed (light lane): ${session.workflowId}. Evidence: ${evidencePath}`,
          };
        }
        const unresolved = APPROVAL_STAGES.filter(
          (stage) =>
            ledger.stages[stage]?.status !== "approved" &&
            ledger.stages[stage]?.status !== "skipped",
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
        return { exitCode: 0, output: `Workflow completed: ${session.workflowId}.` };
      }
      return {
        exitCode: 1,
        error: "Usage: aiw workflow <start|status|complete> [options]",
      };
    }
    if (command === "approve" || command === "reject" || command === "skip") {
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
      const artifact = approvalArtifactPath(aiw, workflowStage);
      if (!artifact || !fs.exists(artifact))
        throw new BlockingError(
          describeBlockingReason("approval_evidence_missing", {
            stage: workflowStage,
            artifactPath: artifact ?? undefined,
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
        return { exitCode: 0, output: `Human approval recorded for ${workflowStage}.` };
      }
      const options = parseNamedOptions(rest, ["reason"]);
      if (!options?.reason)
        return { exitCode: 1, error: "Usage: aiw reject <stage> --reason=human-feedback" };
      const updated = rejectStage(ledger, workflowStage, options.reason, new Date().toISOString());
      fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(updated));
      return {
        exitCode: 0,
        output: `Human rejection recorded for ${workflowStage}. Revise this stage.`,
      };
    }
    if (command === "ui") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const parsed = parseNamedOptions(args.slice(1), ["port"]);
      if (!parsed || (parsed.port !== undefined && !/^\d+$/.test(parsed.port)))
        return { exitCode: 1, error: "Usage: aiw ui [--port=number]" };
      const port = parsed.port === undefined ? 0 : Number(parsed.port);
      if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
        return { exitCode: 1, error: "Dashboard port must be between 0 and 65535." };
      if (!services.dashboard) return { exitCode: 1, error: "Dashboard service is unavailable." };
      const dashboard = await services.dashboard.start(root, port);
      return { exitCode: 0, output: `AI Workflow dashboard: ${dashboard.url}` };
    }
    if (command === "orchestrate") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const executeCount = args.filter((arg) => arg === "--execute").length;
      if (executeCount > 1)
        return {
          exitCode: 1,
          error: "Usage: aiw orchestrate --plan=path [--execute] [--max-parallel=number]",
        };
      const execute = executeCount === 1;
      const named = args.slice(1).filter((arg) => arg !== "--execute");
      const parsed = parseNamedOptions(named, ["plan", "max-parallel"]);
      if (!parsed?.plan)
        return {
          exitCode: 1,
          error: "Usage: aiw orchestrate --plan=path [--execute] [--max-parallel=number]",
        };
      const planPath = safeProjectFile(root, parsed.plan, fs);
      const plan = parseOrchestrationPlan(fs.read(planPath));
      const maxParallel = validateOrchestrationParallelism(
        parsed["max-parallel"] === undefined ? 2 : Number(parsed["max-parallel"]),
      );
      if (!execute) return { exitCode: 0, output: serializeOrchestrationPreview(plan) };
      if (!services.orchestrator)
        return { exitCode: 1, error: "No multi-agent orchestrator is configured." };
      const checkpoint = join(aiw, `checkpoints/orchestration-${plan.id}.yml`);
      const reservation = `${checkpoint}.lock`;
      if (!fs.createExclusive)
        return { exitCode: 1, error: "The filesystem does not support atomic orchestration." };
      if (fs.exists(checkpoint) || !fs.createExclusive(reservation, "schema: 1\nstate: running\n"))
        return {
          exitCode: 1,
          error: `Orchestration checkpoint already exists; use a new plan id: ${checkpoint}`,
        };
      try {
        const results = await executeOrchestrationPlan(plan, services.orchestrator, maxParallel);
        fs.write(checkpoint, serializeOrchestrationResults(plan, results));
        const failed = results.filter(({ status }) => status !== "passed");
        return failed.length
          ? {
              exitCode: 1,
              error: `Orchestration finished with ${failed.length} failed or blocked tasks: ${checkpoint}`,
            }
          : { exitCode: 0, output: `Orchestration passed: ${checkpoint}` };
      } finally {
        fs.remove?.(reservation);
      }
    }
    if (command === "install") {
      const flag = args.indexOf("--target");
      const requestedTarget = flag >= 0 ? args[flag + 1] : undefined;
      const target = requestedTarget || detectTarget(root, fs) || "codex";
      if (!isTarget(target)) throw new Error(`Unsupported target: ${target}`);
      const manifestPath = join(aiw, "manifest.yml");
      assertSafeProjectPath(fs, root, manifestPath);
      if (fs.pathType?.(manifestPath) === "file") {
        const manifest = fs.read(manifestPath);
        const active = manifest.match(/^\s*active:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
        return {
          exitCode: 0,
          output: `AI Workflow is already installed for target: ${active}. Existing state preserved.`,
        };
      }
      const aiInitPath = join(root, renderAiInitPath(target));
      const neutralAiInitPath = join(aiw, "resources/skills/ai-init.md");
      const aiInitContent = renderAiInit(target);
      const desiredResources = new Map<string, string>([[aiInitPath, aiInitContent]]);
      const ownershipMetadata = new Map<string, OwnershipMetadata>();
      ownershipMetadata.set(aiInitPath, {
        kind: "ai-init",
        target,
        resourceType: "skills",
        resourceId: "ai-init",
      });
      if (neutralAiInitPath !== aiInitPath) {
        desiredResources.set(neutralAiInitPath, aiInitContent);
        ownershipMetadata.set(neutralAiInitPath, {
          kind: "neutral-resource",
          target: "universal",
          resourceType: "skills",
          resourceId: "ai-init",
        });
      }
      const conflicts: string[] = [];
      const pendingWrites = new Map<string, string>();
      const inspectDesiredFile = (path: string, content: string, allowExisting = false): void => {
        assertSafeProjectPath(fs, root, path);
        const type = fs.pathType?.(path);
        if (type === "missing") {
          pendingWrites.set(path, content);
          return;
        }
        if (type === "file" && (allowExisting || fs.read(path) === content)) return;
        conflicts.push(path);
      };

      for (const [path, content] of desiredResources) inspectDesiredFile(path, content);
      if (conflicts.length)
        return {
          exitCode: 1,
          error: `Installation would overwrite an existing file: ${conflicts.join(", ")}. Move it or merge its contents, then retry.`,
        };

      inspectDesiredFile(join(aiw, "profile.yml"), "schema: 1\nstatus: pending-scan\n");
      inspectDesiredFile(join(aiw, "lock.yml"), "schema: 1\npackages:\n");
      inspectDesiredFile(manifestPath, "");
      const adrIndex = join(root, ".context/adrs/INDEX.md");
      assertSafeProjectPath(fs, root, adrIndex);
      if (fs.pathType?.(adrIndex) === "missing")
        pendingWrites.set(adrIndex, "# Architecture Decision Records\n\n");

      const ownershipPath = join(aiw, "ownership.yml");
      assertSafeProjectPath(fs, root, ownershipPath);
      if (fs.exists(ownershipPath)) conflicts.push(ownershipPath);
      if (conflicts.length)
        return {
          exitCode: 1,
          error: `Installation found conflicting project state: ${conflicts.join(", ")}. Review and move it before retrying.`,
        };
      const ownedPaths = new Set(desiredResources.keys());
      if (pendingWrites.has(adrIndex)) ownedPaths.add(adrIndex);
      const ownedFiles = [...ownedPaths]
        .filter((path) => pendingWrites.has(path))
        .map((path) =>
          createOwnedFile(
            relative(root, path).split(sep).join("/"),
            pendingWrites.get(path)!,
            ownershipMetadata.get(path) ?? { kind: "supporting-file" },
          ),
        );
      pendingWrites.set(ownershipPath, serializeOwnership(ownedFiles));
      pendingWrites.delete(manifestPath);
      pendingWrites.set(
        manifestPath,
        `schema: 1\nproject:\n  name: ${root.split("/").pop()}\ntarget:\n  active: ${target}\npolicies:\n  artifact_language: en\n`,
      );
      writeProjectFilesAtomically(
        fs,
        root,
        [...pendingWrites].map(([path, content]) => ({ path, content })),
        [...BASE_DIRECTORIES.map((directory) => join(aiw, directory)), join(root, ".context/adrs")],
      );
      let optionalModels: string[] = [];
      let telemetryEnabled: boolean | undefined;
      if (stdin.isTTY) {
        const terminal = createInterface({ input: stdin, output: stdout });
        try {
          optionalModels = await configureOptionalModels(fs, aiw, (question) =>
            terminal.question(question),
          );
          telemetryEnabled = await offerTelemetryConsent(fs, aiw, (question) =>
            terminal.question(question),
          );
        } finally {
          terminal.close();
        }
      }
      return {
        exitCode: 0,
        output:
          `AI Workflow initialized for target: ${target} with only the ai-init skill. Run /ai-init to scan the project and choose which resources to install.` +
          (optionalModels.length
            ? ` Optional models enabled: ${optionalModels.join(", ")}. They activate once the models are available.`
            : "") +
          (telemetryEnabled !== undefined
            ? telemetryEnabled
              ? " Telemetry enabled (command name and outcome only); disable anytime with `aiw telemetry disable`."
              : " Telemetry disabled; enable anytime with `aiw telemetry enable`."
            : ""),
      };
    }
    if (command === "telemetry") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const usage =
        "Usage: aiw telemetry <status|show|enable|disable> [--verbose] [--commands=include|exclude] [--outcomes=include|exclude]";
      const action = args[1];
      if (!action) return { exitCode: 1, error: usage };
      const telemetryConfig = loadTelemetryConfig(fs, aiw);
      const actionArgs = args.slice(2).filter((arg) => arg !== "--verbose");
      const verbose = args.includes("--verbose");
      if (action === "show") {
        if (actionArgs.length !== 0) return { exitCode: 1, error: usage };
        const buffered = readTelemetryBuffer(fs, aiw);
        const byCommand = new Map<string, { success: number; failure: number }>();
        for (const event of buffered) {
          const key = event.command ?? "unknown";
          const entry = byCommand.get(key) ?? { success: 0, failure: 0 };
          if (event.outcome === "failure") entry.failure += 1;
          else entry.success += 1;
          byCommand.set(key, entry);
        }
        const lines = [
          `Telemetry is ${telemetryConfig.enabled ? "enabled" : "disabled"}.`,
          `Buffered events: ${buffered.length}/${TELEMETRY_BUFFER_CAP} (.aiw/${TELEMETRY_BUFFER_FILE}).`,
        ];
        if (buffered.length > 0) {
          lines.push("By command:");
          for (const [command, { success, failure }] of [...byCommand].sort((a, b) =>
            a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
          ))
            lines.push(`- ${command}: ${success} success, ${failure} failure`);
        }
        if (verbose && buffered.length > 0) {
          lines.push("Events:");
          lines.push(...buffered.map((event) => `- ${JSON.stringify(event)}`));
        }
        if (!telemetryConfig.enabled)
          lines.push(
            "Note: telemetry is disabled, so no new events are recorded; the buffer keeps previously collected events until purged.",
          );
        return { exitCode: 0, output: lines.join("\n") };
      }
      if (action === "status") {
        if (actionArgs.length !== 0) return { exitCode: 1, error: usage };
        const config = telemetryConfig;
        const buffered = verbose ? readTelemetryBuffer(fs, aiw) : undefined;
        return {
          exitCode: 0,
          output:
            `Telemetry is ${config.enabled ? "enabled" : "disabled"}. Command collection: ${config.includeCommand ? "included" : "excluded"}. Outcome collection: ${config.includeOutcome ? "included" : "excluded"}.` +
            (buffered !== undefined
              ? `\nLocal buffer: ${buffered.length} event${buffered.length === 1 ? "" : "s"} (cap ${TELEMETRY_BUFFER_CAP}, .aiw/${TELEMETRY_BUFFER_FILE}).` +
                (buffered.length > 0
                  ? `\n${buffered.map((event) => `- ${JSON.stringify(event)}`).join("\n")}`
                  : "")
              : ""),
        };
      }
      if (action === "disable") {
        if (actionArgs.length !== 0) return { exitCode: 1, error: usage };
        purgeTelemetryBuffer(fs, aiw);
        saveSettingsSection(
          fs,
          aiw,
          "telemetry",
          serializeTelemetryMapping(DEFAULT_TELEMETRY_CONFIG),
        );
        return { exitCode: 0, output: "Telemetry disabled." };
      }
      if (action === "enable") {
        const options = args.slice(2).filter((arg) => arg !== "--verbose");
        if (
          options.some((option) => !/^--(?:commands|outcomes)=(?:include|exclude)$/.test(option)) ||
          new Set(options.map((option) => option.slice(0, option.indexOf("=")))).size !==
            options.length
        )
          return { exitCode: 1, error: usage };
        const privacyValue = (name: string): boolean => !options.includes(`--${name}=exclude`);
        saveSettingsSection(
          fs,
          aiw,
          "telemetry",
          serializeTelemetryMapping({
            schema: 1,
            enabled: true,
            includeCommand: privacyValue("commands"),
            includeOutcome: privacyValue("outcomes"),
          }),
        );
        return { exitCode: 0, output: "Telemetry enabled with explicit privacy preferences." };
      }
      return {
        exitCode: 1,
        error: usage,
      };
    }
    if (command === "plugin") {
      const usage =
        "Usage: aiw plugin create --directory=path --id=owner/name --version=1.0.0 --description=text | aiw plugin validate --directory=path";
      const action = args[1];
      const options = args.slice(2);
      if (action === "create") {
        const allowed = ["directory", "id", "version", "description"];
        const parsed = parseNamedOptions(options, allowed);
        if (!parsed || allowed.some((name) => !parsed[name])) return { exitCode: 1, error: usage };
        const scaffold = createPluginScaffold(root, parsed.directory, {
          id: parsed.id,
          version: parsed.version,
          description: parsed.description,
        });
        writePluginScaffold(fs, scaffold);
        return { exitCode: 0, output: `Plugin scaffold created: ${scaffold.root}` };
      }
      if (action === "validate") {
        const parsed = parseNamedOptions(options, ["directory"]);
        if (!parsed?.directory) return { exitCode: 1, error: usage };
        const contract = validatePluginDirectory(fs, root, parsed.directory);
        return {
          exitCode: 0,
          output: `Plugin package is valid: ${contract.id}@${contract.version}`,
        };
      }
      return { exitCode: 1, error: usage };
    }
    if (command === "context-bench") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const saveCount = args.filter((arg) => arg === "--save").length;
      if (saveCount > 1)
        return { exitCode: 1, error: "Usage: aiw context-bench [--baseline=path] [--save]" };
      const save = saveCount === 1;
      const parsed = parseNamedOptions(
        args.slice(1).filter((arg) => arg !== "--save"),
        ["baseline"],
      );
      if (!parsed)
        return { exitCode: 1, error: "Usage: aiw context-bench [--baseline=path] [--save]" };
      const report = collectContextBench(root, fs);
      const serialized = serializeContextBench(report);
      const lines: string[] = [serialized.trimEnd()];
      if (parsed.baseline) {
        const baselinePath = safeProjectFile(root, parsed.baseline, fs);
        if (!fs.exists(baselinePath))
          return { exitCode: 1, error: `Baseline not found: ${parsed.baseline}` };
        const comparison = compareContextBench(parseContextBench(fs.read(baselinePath)), report);
        lines.push(
          `Baseline: ${parsed.baseline} (bundle ${comparison.bundleChanged ? "changed" : "identical"}, token delta ${comparison.totalTokenDelta >= 0 ? "+" : ""}${comparison.totalTokenDelta})`,
        );
        if (comparison.regressions.length)
          return {
            exitCode: 1,
            error: `Standing context regressed against baseline:\n${comparison.regressions.map((regression) => `- ${regression}`).join("\n")}`,
            output: lines.join("\n"),
          };
        lines.push("No regressions against baseline.");
      }
      if (save) {
        const checkpoint = join(aiw, `checkpoints/context-bench-${report.bundleHash}.yml`);
        if (!fs.createExclusive)
          return { exitCode: 1, error: "The filesystem does not support atomic checkpoints." };
        if (!fs.createExclusive(checkpoint, serialized)) {
          if (fs.read(checkpoint) !== serialized)
            return {
              exitCode: 1,
              error: `Checkpoint already exists with different content: ${checkpoint}`,
            };
          lines.push(`Checkpoint already recorded: ${checkpoint}`);
        } else {
          lines.push(`Checkpoint saved: ${checkpoint}`);
        }
      }
      return { exitCode: 0, output: lines.join("\n") };
    }
    if (command === "parity") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const parsed = parseNamedOptions(args.slice(1), ["tasks"]);
      if (!parsed) return { exitCode: 1, error: "Usage: aiw parity [--tasks=directory]" };
      const tasksPath = parsed.tasks;
      if (tasksPath && (isAbsolute(tasksPath) || tasksPath.split(/[\\/]/).includes("..")))
        return {
          exitCode: 1,
          error: "Parity tasks directory must be a safe project-relative path.",
        };
      const tasksDirectory = tasksPath ? join(root, tasksPath) : join(aiw, "parity");
      if (fs.pathType?.(tasksDirectory) !== "directory" || !fs.list)
        return {
          exitCode: 1,
          error: `Parity tasks directory not found: ${relative(root, tasksDirectory).split(sep).join("/")}. Add YAML tasks (see docs/token-efficiency.md).`,
        };
      const taskFiles = (fs.list(tasksDirectory) ?? [])
        .filter((name) => name.endsWith(".yml"))
        .sort();
      if (!taskFiles.length)
        return {
          exitCode: 1,
          error: `No parity tasks found in ${relative(root, tasksDirectory).split(sep).join("/")}. Each task is one YAML file with schema, id, layers, critical_facts, and completion_markers.`,
        };
      const tasks = taskFiles.map((name) => {
        const path = join(tasksDirectory, name);
        try {
          return materializeParityTask(parseParityTask(fs.read(path)), (source) => {
            const absolute = join(root, source);
            if (fs.pathType?.(absolute) !== "file") throw new Error("source is not a file");
            return fs.read(absolute);
          });
        } catch (error) {
          throw new Error(`${name}: ${(error as Error).message}`, { cause: error });
        }
      });
      const suite = runParitySuite(tasks, TASK_ASSEMBLER);
      const serialized = serializeParitySuite(suite);
      if (suite.failed)
        return {
          exitCode: 1,
          output: serialized.trimEnd(),
          error: `Task parity failed for ${suite.failed} of ${suite.total} task(s): critical facts or completion markers were lost by the ${TASK_ASSEMBLER.name} assembler. Fix context assembly or move the facts to a retrieved layer; do not delete the expectations.`,
        };
      return {
        exitCode: 0,
        output:
          serialized.trimEnd() +
          `\nTask parity passed: every critical fact survived the ${TASK_ASSEMBLER.name} assembler.`,
      };
    }
    if (command === "scan") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const profile = await (services.profiler?.profile(root) ?? profileProject(root));
      let interpreter = services.interpreter;
      let interpreterModel: string | undefined;
      let interpreterUsage: AiProviderUsage | undefined;
      if (!interpreter) {
        const aiConfig = loadAiProviderConfig(fs, aiw);
        if (aiConfig?.enabled) {
          interpreter = createProjectInterpreter(
            root,
            services.aiProvider ?? createOpenAiCompatibleProvider(aiConfig),
            undefined,
            {
              onUsage: (usage) => {
                interpreterUsage = usage;
              },
            },
          );
          interpreterModel = aiConfig.model;
        }
      } else interpreterModel = "host-injected";
      const modelUsage: { label: string; tokens: number; detail: string; model: string }[] = [];
      if (interpreter) {
        const scan = await (services.scanner?.scan(root) ?? scanProject(root));
        let scopedFiles = scan.files;
        let priorityFiles: string[] | undefined;
        const contextConfig = loadSemanticConfig(fs, aiw);
        const contextIndexPath = join(aiw, SEMANTIC_INDEX_PATH);
        if (contextConfig?.enabled && fs.exists(contextIndexPath)) {
          try {
            const index = parseSemanticIndex(fs.read(contextIndexPath));
            if (index.model === contextConfig.model && index.chunks.length > 0) {
              const embedding =
                services.embeddingProvider ?? createOllamaEmbeddingProvider(contextConfig);
              if (await embedding.available()) {
                const matches = await querySemanticIndex(
                  index,
                  buildInterpreterQuery(profile),
                  embedding,
                  contextConfig,
                );
                priorityFiles = [
                  ...selectInterpreterKeyFiles(scan.files),
                  ...matches.map((match) => match.file),
                ];
                const allowed = new Set(priorityFiles);
                scopedFiles = scan.files.filter((file) => allowed.has(file));
                modelUsage.push({
                  label: "embedding",
                  tokens: Math.ceil(buildInterpreterQuery(profile).length / 4),
                  detail: `${contextConfig.model} — scoped interpreter context to ${matches.length} semantic matches`,
                  model: contextConfig.model,
                });
              }
            }
          } catch {
            // An unreadable index keeps the scan deterministic with alphabetical scoping.
          }
        }
        const interpretationRequest = createInterpretationRequest(
          profile,
          scopedFiles,
          4000,
          priorityFiles,
        );
        const inferred = await interpreter.interpret(interpretationRequest);
        profile.facts = mergeFacts(profile.facts, inferred);
        const actualTokens = interpreterUsage
          ? interpreterUsage.promptTokens + interpreterUsage.completionTokens
          : undefined;
        modelUsage.push({
          label: "interpreter",
          tokens: actualTokens ?? interpretationRequest.estimatedTokens,
          detail: `${interpreterModel} — ${inferred.length} facts from ${interpretationRequest.files.length} files${actualTokens !== undefined ? " (measured)" : ""}`,
          model: interpreterModel ?? "unknown",
        });
      }
      const overrides = readFactOverrides(fs, aiw);
      const rejectedKeys = new Set(
        overrides
          .filter((override) => override.action === "reject")
          .map((override) => override.key),
      );
      profile.facts = profile.facts.filter((fact) => !rejectedKeys.has(fact.key));
      profile.facts = mergeFacts(profile.facts, applyOverrides(profile.facts, overrides));
      profile.facts = profile.facts.filter((fact) => !rejectedKeys.has(fact.key));
      const evidence = profile.facts
        .map(
          (fact) =>
            `  - key: ${fact.key}\n    value: ${fact.value}\n    state: ${fact.state}\n    method: ${fact.method}\n    confidence: ${fact.confidence}${fact.requiresConfirmation === undefined ? "" : `\n    requires_confirmation: ${fact.requiresConfirmation}`}\n    evidence: [${fact.evidence.map((item) => `"${item.source}"`).join(", ")}]`,
        )
        .join("\n");
      fs.write(
        join(aiw, "profile.yml"),
        `schema: 1\nstatus: scanned\nfacts:\n${evidence}\nruntime:\n  languages: [${profile.runtime.languages.join(", ")}]\nframeworks: [${profile.frameworks.join(", ")}]\npackage_manager: ${profile.packageManager}\nquality:\n  linter: ${profile.quality.linter?.name ?? "unknown"}\n  linter_command: ${profile.quality.linter?.command ?? "unknown"}\n  formatter: ${profile.quality.formatter?.name ?? "unknown"}\n  formatter_command: ${profile.quality.formatter?.command ?? "unknown"}\n  typecheck: ${profile.quality.typecheck?.name ?? "unknown"}\n  typecheck_command: ${profile.quality.typecheck?.command ?? "unknown"}\ntesting: ${profile.testing?.name ?? "unknown"}\ntesting_command: ${profile.testing?.command ?? "unknown"}\nci: [${profile.ci.join(", ")}]\nworkspaces: [${profile.workspaces.join(", ")}]\nproject_modules: ${JSON.stringify(profile.modules ?? [])}\npolicies:\n  artifact_language: en\n`,
      );
      const semanticConfig = loadSemanticConfig(fs, aiw);
      if (semanticConfig?.enabled) {
        const provider =
          services.embeddingProvider ?? createOllamaEmbeddingProvider(semanticConfig);
        if (!(await provider.available()))
          return {
            exitCode: 1,
            error: `Semantic model ${semanticConfig.model} is not available at ${semanticConfig.baseUrl}.`,
          };
        const scanFiles = await (services.scanner?.scan(root) ?? scanProject(root));
        const index = await buildSemanticIndex(
          scanFiles.files,
          async (file) => {
            const absolute = join(root, file);
            try {
              return new TextDecoder("utf-8", { fatal: true }).decode(
                fs.readBytes?.(absolute) ?? Buffer.from(fs.read(absolute), "utf8"),
              );
            } catch {
              return undefined;
            }
          },
          provider,
          semanticConfig,
        );
        fs.mkdir(join(aiw, "semantic"));
        fs.write(join(aiw, SEMANTIC_INDEX_PATH), serializeSemanticIndex(index));
        const indexedChars = index.chunks.reduce((total, chunk) => total + chunk.text.length, 0);
        modelUsage.push({
          label: "embedding",
          tokens: Math.ceil(indexedChars / 4),
          detail: `${semanticConfig.model} — indexed ${index.chunks.length} chunks in ${Math.ceil(index.chunks.length / 64)} batch requests`,
          model: semanticConfig.model,
        });
      }
      if (modelUsage.length > 0) {
        const usagePath = join(aiw, "usage.yml");
        const entries = fs.exists(usagePath) ? parseTokenUsage(fs.read(usagePath)) : [];
        let next = entries;
        for (const usage of modelUsage)
          next = recordTokenUsage(next, {
            stage: `scan.${usage.label}`,
            budget: usage.tokens,
            used: usage.tokens,
            model: usage.model,
          });
        fs.write(usagePath, serializeTokenUsage(next));
        const sidecarPath = join(aiw, USAGE_SIDECAR_PATH);
        const ledger = fs.exists(sidecarPath) ? parseUsageSidecar(fs.read(sidecarPath)) : [];
        let sidecar = ledger;
        for (const usage of modelUsage) {
          const measured = usage.detail.includes("(measured)");
          const isInterpreter = usage.label === "interpreter" && measured && interpreterUsage;
          sidecar = appendUsageSidecarEntry(sidecar, {
            command: `scan.${usage.label}`,
            label: measured ? "measured" : "estimated",
            tiers: isInterpreter
              ? {
                  "cache-read": 0,
                  "fresh-input": interpreterUsage!.promptTokens,
                  "cache-write": 0,
                  output: interpreterUsage!.completionTokens,
                }
              : { "cache-read": 0, "fresh-input": usage.tokens, "cache-write": 0, output: 0 },
            model: usage.model,
            harness: "aiw-cli",
          });
        }
        fs.write(sidecarPath, serializeUsageSidecar(sidecar));
      }
      return {
        exitCode: 0,
        output:
          "Project profile generated." +
          (modelUsage.length > 0
            ? `\nModels used:\n${modelUsage
                .map(
                  (usage) =>
                    `- ${usage.label}: ${usage.detail} (~${usage.tokens.toLocaleString("en-US")} tokens)`,
                )
                .join("\n")}`
            : "\nModels used: none (deterministic scan)."),
      };
    }
    if (command === "decision") {
      const usage = "Usage: aiw decision triage --artifact=<path> | aiw decision status";
      const action = args[1];
      const config = loadDecisionConfig(fs, aiw);
      if (action === "status") {
        if (!config)
          return {
            exitCode: 0,
            output: `Decision model is not configured. Add a decision section to .aiw/settings.yml to enable it.`,
          };
        return {
          exitCode: 0,
          output: `Decision model ${config.enabled ? "enabled" : "disabled"}: ${config.model} at ${config.baseUrl}`,
        };
      }
      if (action === "triage") {
        const parsed = parseNamedOptions(args.slice(2), ["artifact"]);
        if (!parsed?.artifact) return { exitCode: 1, error: usage };
        if (!config?.enabled)
          return {
            exitCode: 1,
            error: "Decision model is disabled. Set decision.enabled=true in .aiw/decision.yml.",
          };
        const artifactPath = safeProjectFile(root, parsed.artifact, fs);
        if (!fs.exists(artifactPath))
          return { exitCode: 1, error: `Artifact not found: ${parsed.artifact}` };
        const provider = createOllamaDecisionProvider(config);
        if (!(await provider.available()))
          return {
            exitCode: 1,
            error: `Decision model ${config.model} is not available at ${config.baseUrl}.`,
          };
        const decision = await provider.decide(buildEvidenceTriageRequest(fs.read(artifactPath)));
        const gate = decision.answers.gate;
        const evidence = decision.answers.evidence_complete;
        return {
          exitCode: 0,
          output: [
            "Advisory decision (never replaces human approval):",
            `  gate: ${gate?.choice ?? "unknown"} (confidence ${formatConfidence(gate?.confidence)})`,
            `  evidence_complete: ${formatNoul(evidence?.noul)}`,
          ].join("\n"),
        };
      }
      return { exitCode: 1, error: usage };
    }
    if (command === "semantic") {
      const usage = "Usage: aiw semantic query --text=<query> [--rerank] | aiw semantic status";
      const action = args[1];
      if (action === "status") {
        const config = loadSemanticConfig(fs, aiw);
        if (!config)
          return {
            exitCode: 0,
            output: `Semantic mapping is not configured. Add a semantic section to .aiw/settings.yml to enable it.`,
          };
        const indexPath = join(aiw, SEMANTIC_INDEX_PATH);
        const built = fs.exists(indexPath)
          ? `indexed chunks: ${parseSemanticIndex(fs.read(indexPath)).chunks.length}`
          : "index: not built (run aiw scan)";
        return {
          exitCode: 0,
          output: `Semantic mapping ${config.enabled ? "enabled" : "disabled"}: model ${config.model} at ${config.baseUrl}\n${built}`,
        };
      }
      if (action === "query") {
        const queryArgs = args.slice(2).filter((arg) => arg !== "--rerank");
        const rerankRequested = args.slice(2).includes("--rerank");
        const parsed = parseNamedOptions(queryArgs, ["text"]);
        if (!parsed?.text) return { exitCode: 1, error: usage };
        const config = loadSemanticConfig(fs, aiw);
        if (!config?.enabled)
          return {
            exitCode: 1,
            error: "Semantic mapping is disabled. Set semantic.enabled=true in .aiw/semantic.yml.",
          };
        const indexPath = join(aiw, SEMANTIC_INDEX_PATH);
        if (!fs.exists(indexPath))
          return { exitCode: 1, error: "Semantic index is missing. Run `aiw scan` first." };
        const provider = createOllamaEmbeddingProvider(config);
        if (!(await provider.available()))
          return {
            exitCode: 1,
            error: `Semantic model ${config.model} is not available at ${config.baseUrl}.`,
          };
        const matches = await querySemanticIndex(
          parseSemanticIndex(fs.read(indexPath)),
          parsed.text,
          provider,
          config,
        );
        let ranked: RerankedMatch[] = matches.map((match) => ({ ...match }));
        let influence: string | undefined;
        if (rerankRequested) {
          const decisionConfig = loadDecisionConfig(fs, aiw);
          if (!decisionConfig?.enabled)
            return {
              exitCode: 1,
              error:
                "Decision model is disabled. Set decision.enabled=true in .aiw/settings.yml to use --rerank.",
            };
          const decisionProvider = createOllamaDecisionProvider(decisionConfig);
          if (!(await decisionProvider.available()))
            return {
              exitCode: 1,
              error: `Decision model ${decisionConfig.model} is not available at ${decisionConfig.baseUrl}.`,
            };
          const outcome = await rerankSemanticMatches(
            matches,
            parsed.text,
            async (query, candidates) => {
              const response = await decisionProvider.decide(
                buildSemanticRerankRequest(query, candidates),
              );
              const scores: Record<string, number | undefined> = {};
              for (const [id, answer] of Object.entries(response.answers))
                scores[id] = typeof answer.score === "number" ? answer.score : undefined;
              return scores;
            },
          );
          ranked = outcome.matches;
          influence = `rerank influence: ${outcome.changedPositions}/${outcome.matches.length} positions reordered (advisory; cosine recall unchanged)`;
        }
        return {
          exitCode: 0,
          output:
            ranked.length === 0
              ? "No semantic matches."
              : `${ranked
                  .map(
                    (match) =>
                      `- ${match.file} (score ${match.score.toFixed(3)}${match.rerankScore !== undefined ? `, rerank ${match.rerankScore.toFixed(3)}` : ""})\n  ${match.excerpt}`,
                  )
                  .join("\n")}${influence ? `\n${influence}` : ""}`,
        };
      }
      return { exitCode: 1, error: usage };
    }
    if (command === "target") {
      const target = args[1];
      if (!target) return { exitCode: 1, error: "Usage: aiw target <target>" };
      if (!isTarget(target)) return { exitCode: 1, error: `Unsupported target: ${target}` };
      const manifestPath = join(aiw, "manifest.yml");
      if (!fs.exists(manifestPath)) return { exitCode: 1, error: "Run `aiw install` first." };
      const dryRun = args.includes("--dry-run");
      const targetPath = join(root, renderAiInitPath(target));
      const neutralAiInit = join(aiw, "resources/skills/ai-init.md");
      assertSafeProjectPath(fs, root, manifestPath);
      const manifest = parseManifest(fs.read(manifestPath));
      const previousTarget = manifest.target.active;
      const previousTargetPath = join(root, renderAiInitPath(previousTarget));
      const inventoryPath = join(aiw, "ownership.yml");
      if (!fs.exists(inventoryPath))
        return {
          exitCode: 1,
          error: "AIW ownership inventory is required for safe target migration.",
        };
      assertSafeProjectPath(fs, root, inventoryPath);
      if (fs.pathType?.(inventoryPath) !== "file")
        return { exitCode: 1, error: "AIW ownership inventory is not a regular project file." };
      const inventory = parseOwnership(fs.read(inventoryPath));
      const ownedByPath = new Map(inventory.map((entry) => [entry.path, entry]));
      const resourceRoot = join(aiw, "resources");
      if (fs.exists(resourceRoot)) assertSafeProjectPath(fs, root, resourceRoot);
      const relativeFiles = fs.exists(resourceRoot)
        ? (fs.listFiles?.(resourceRoot) ?? []).filter((path) => path !== "skills/ai-init.md")
        : [];
      const plan = planNeutralResourceMigration(resourceRoot, relativeFiles ?? [], target);
      const diagnostics: MigrationDiagnostic[] = [...plan.diagnostics];
      if (fs.exists(resourceRoot) && !fs.listFiles)
        diagnostics.push({
          path: ".aiw/resources",
          reason: "filesystem cannot enumerate neutral resources safely",
        });
      const migrations: ResourceMigration[] = [];
      const migrationBytes = new Map<string, Uint8Array>();
      for (const migration of plan.migrations) {
        const relativeSource = relative(resourceRoot, migration.source).split(sep).join("/");
        try {
          assertSafeProjectPath(fs, root, migration.source);
          if (!fs.exists(migration.source) || fs.pathType?.(migration.source) !== "file") {
            diagnostics.push({
              path: relativeSource,
              reason: "resource is missing or is not a regular file",
            });
            continue;
          }
          const bytes = readResourceBytes(fs, migration.source);
          const reason = validateNeutralResourceDocument(relativeSource, bytes);
          if (reason) {
            diagnostics.push({ path: relativeSource, reason });
            continue;
          }
          migrations.push(migration);
          migrationBytes.set(migration.source, bytes);
        } catch {
          diagnostics.push({ path: relativeSource, reason: "resource cannot be read safely" });
        }
      }

      const conflicts = new Set<string>();
      const removals = new Set<string>();
      const fileChanges = new Map<string, Uint8Array | undefined>();
      const resourceDestinations = new Set<string>();
      for (const migration of migrations) {
        const destination = join(root, migration.destination);
        resourceDestinations.add(destination);
        const desiredBytes = migrationBytes.get(migration.source)!;
        inspectMigrationDestination(destination, desiredBytes);
      }
      const hasNeutralAiInit = fs.exists(neutralAiInit);
      let aiInitBytes: Uint8Array = Buffer.from(renderAiInit(target), "utf8");
      if (hasNeutralAiInit) {
        try {
          assertSafeProjectPath(fs, root, neutralAiInit);
          if (fs.pathType?.(neutralAiInit) !== "file")
            diagnostics.push({
              path: ".aiw/resources/skills/ai-init.md",
              reason: "resource is not a regular file",
            });
          else aiInitBytes = readResourceBytes(fs, neutralAiInit);
        } catch {
          diagnostics.push({
            path: ".aiw/resources/skills/ai-init.md",
            reason: "resource cannot be read safely",
          });
        }
      }
      const aiInitDiagnostic = validateNeutralResourceDocument(
        "skills/ai-init/SKILL.md",
        aiInitBytes,
      );
      if (hasNeutralAiInit && aiInitDiagnostic)
        diagnostics.push({ path: ".aiw/resources/skills/ai-init.md", reason: aiInitDiagnostic });
      const targetAiPath = targetPath;
      resourceDestinations.add(targetAiPath);
      if (targetAiPath === neutralAiInit) fileChanges.set(targetAiPath, aiInitBytes);
      else inspectMigrationDestination(targetAiPath, aiInitBytes);

      const previousTargetEntries =
        previousTarget === "universal"
          ? []
          : inventory.filter(
              (entry) =>
                (entry.kind === "target-resource" || entry.kind === "ai-init") &&
                entry.target === previousTarget,
            );
      const oldTargetPaths = new Set(previousTargetEntries.map(({ path }) => resolve(root, path)));
      if (previousTarget !== "universal") {
        for (const migration of migrations) {
          const oldPath = join(
            root,
            renderResourcePath(
              previousTarget,
              migration.type as Parameters<typeof renderResourcePath>[1],
              migration.id,
            ),
          );
          oldTargetPaths.add(oldPath);
          if (oldPath !== join(root, migration.destination)) inspectOwnedRemoval(oldPath);
        }
        if (previousTargetPath !== targetPath) inspectOwnedRemoval(previousTargetPath);
      }
      for (const oldPath of oldTargetPaths) {
        if (resourceDestinations.has(oldPath)) continue;
        if (fs.exists(oldPath)) inspectOwnedRemoval(oldPath);
        else removals.add(relative(root, oldPath).split(sep).join("/"));
      }

      const existingDestinations = [...resourceDestinations]
        .filter((path) => fs.exists(path))
        .map((path) => relative(root, path).split(sep).join("/"));
      const conflictPaths = [...conflicts].map((path) => relative(root, path).split(sep).join("/"));
      const removalPaths = [...removals];
      const previewActions = [
        target === "universal" && hasNeutralAiInit
          ? "keep: .aiw/resources/skills/ai-init.md (neutral source)"
          : `${fs.exists(targetAiPath) ? "update" : "add"}: ${relative(root, targetAiPath).split(sep).join("/")}`,
        ...(hasNeutralAiInit && target !== "universal"
          ? ["keep: .aiw/resources/skills/ai-init.md (neutral source)"]
          : []),
      ];
      const preview = serializeMigrationPreview(
        target,
        migrations,
        existingDestinations,
        removalPaths,
        diagnostics,
        conflictPaths,
        previewActions,
      );
      if (dryRun)
        return { exitCode: diagnostics.length || conflicts.size ? 1 : 0, output: preview };
      if (diagnostics.length || conflicts.size)
        return {
          exitCode: 1,
          error: `Migration blocked. Review the dry-run diagnostics:\n${preview}`,
        };
      if ([...fileChanges.values()].some((value) => value === undefined) && !fs.remove)
        return { exitCode: 1, error: "Filesystem cannot remove obsolete target resources." };

      const nextInventory = new Map(inventory.map((entry) => [entry.path, entry]));
      for (const relativePath of removals) nextInventory.delete(relativePath);
      for (const [path, bytes] of fileChanges) {
        if (bytes === undefined) continue;
        const relativePath = relative(root, path).split(sep).join("/");
        const matchingMigration = migrations.find(
          (entry) => join(root, entry.destination) === path,
        );
        const metadata =
          path === targetAiPath
            ? {
                kind: "ai-init" as const,
                target,
                resourceType: "skills" as const,
                resourceId: "ai-init",
              }
            : matchingMigration
              ? {
                  kind: "target-resource" as const,
                  target,
                  resourceType: matchingMigration.type,
                  resourceId: matchingMigration.id,
                }
              : {};
        nextInventory.set(relativePath, createOwnedFile(relativePath, bytes, metadata));
      }
      const inventoryBytes = Buffer.from(serializeOwnership([...nextInventory.values()]), "utf8");
      fileChanges.set(inventoryPath, inventoryBytes);
      fileChanges.set(
        manifestPath,
        Buffer.from(serializeManifest({ ...manifest, target: { active: target } }), "utf8"),
      );

      const changes = [...fileChanges].map(([path, content]) => ({ path, content }));
      const snapshots = snapshotProjectFiles(
        fs,
        root,
        changes.map(({ path }) => path),
      );
      const backupPath = join(aiw, "checkpoints/migration-backup.yml");
      assertSafeProjectPath(fs, root, backupPath);
      const previousBackup = fs.exists(backupPath) ? readResourceBytes(fs, backupPath) : undefined;
      const postMigrationSnapshots = expectedMigrationSnapshots(root, changes);
      const backupContent = serializeMigrationCheckpoint(snapshots, postMigrationSnapshots);
      fs.write(backupPath, backupContent);
      try {
        applyProjectFileChanges(fs, root, changes);
      } catch (error) {
        if (error instanceof Error && error.message.includes("automatic rollback was incomplete"))
          throw error;
        try {
          if (previousBackup) writeResourceBytes(fs, backupPath, previousBackup);
          else if (fs.exists(backupPath)) fs.remove?.(backupPath);
        } catch {
          throw new Error("Migration failed and its prior checkpoint could not be restored.", {
            cause: error,
          });
        }
        throw error;
      }
      return {
        exitCode: 0,
        output: `Target changed to ${target}; rendered ${migrations.length} neutral resources and removed ${removals.size} obsolete resources.`,
      };

      function inspectMigrationDestination(destination: string, desired: Uint8Array): void {
        try {
          assertSafeProjectPath(fs, root, destination);
          if (!fs.exists(destination)) {
            fileChanges.set(destination, desired);
            return;
          }
          if (fs.pathType?.(destination) !== "file") {
            conflicts.add(destination);
            return;
          }
          const currentBytes = readResourceBytes(fs, destination);
          const currentChecksum = `sha256-${checksumPackage(currentBytes)}`;
          const relativeDestination = relative(root, destination).split(sep).join("/");
          const owner = ownedByPath.get(relativeDestination);
          if (Buffer.compare(Buffer.from(currentBytes), Buffer.from(desired)) === 0) {
            if (owner && owner.checksum !== currentChecksum) conflicts.add(destination);
            return;
          }
          if (!owner || owner.checksum !== currentChecksum) {
            conflicts.add(destination);
            return;
          }
          fileChanges.set(destination, desired);
        } catch {
          conflicts.add(destination);
        }
      }

      function inspectOwnedRemoval(path: string): void {
        try {
          assertSafeProjectPath(fs, root, path);
          if (!fs.exists(path)) {
            removals.add(relative(root, path).split(sep).join("/"));
            return;
          }
          if (fs.pathType?.(path) !== "file") {
            conflicts.add(path);
            return;
          }
          const relativePath = relative(root, path).split(sep).join("/");
          const owner = ownedByPath.get(relativePath);
          const actual = `sha256-${checksumPackage(readResourceBytes(fs, path))}`;
          if (!owner || owner.checksum !== actual) {
            conflicts.add(path);
            return;
          }
          removals.add(relativePath);
          fileChanges.set(path, undefined);
        } catch {
          conflicts.add(path);
        }
      }
    }
    if (command === "rollback") {
      const backup = join(aiw, "checkpoints/migration-backup.yml");
      assertSafeProjectPath(fs, root, backup);
      if (!fs.exists(backup)) return { exitCode: 1, error: "No migration backup is available." };
      const content = fs.read(backup);
      if (fs.pathType?.(backup) !== "file")
        return { exitCode: 1, error: "Migration backup is not a regular project file." };
      const checkpoint = parseMigrationCheckpoint(content);
      const { snapshots, postMigrationSnapshots } = checkpoint;
      const backupRelative = relative(root, backup).split(sep).join("/");
      if (snapshots.some(({ path }) => path === backupRelative))
        return { exitCode: 1, error: "Migration backup cannot contain itself as a snapshot." };
      if (!postMigrationSnapshots)
        return {
          exitCode: 1,
          error:
            "Migration backup does not include validated post-migration state; refusing unsafe rollback.",
        };
      if (
        postMigrationSnapshots.length !== snapshots.length ||
        postMigrationSnapshots.some((snapshot, index) => snapshot.path !== snapshots[index]?.path)
      )
        return { exitCode: 1, error: "Migration backup post-migration state is invalid." };
      const conflicts: string[] = [];
      const restorable: MigrationSnapshot[] = [];
      for (const [index, snapshot] of snapshots.entries()) {
        const path = resolve(root, snapshot.path);
        try {
          assertSafeProjectPath(fs, root, path);
          const expected = postMigrationSnapshots?.[index];
          if (!expected || migrationSnapshotMatches(fs, path, expected)) restorable.push(snapshot);
          else conflicts.push(snapshot.path);
        } catch {
          conflicts.push(snapshot.path);
        }
      }
      if (
        restorable.some(
          (snapshot) => !snapshot.existed && fs.exists(resolve(root, snapshot.path)),
        ) &&
        !fs.remove
      )
        return { exitCode: 1, error: "Filesystem cannot remove obsolete migration resources." };
      const rollbackChanges: ProjectFileChange[] = restorable.map((snapshot) => ({
        path: resolve(root, snapshot.path),
        content: snapshot.existed ? Buffer.from(snapshot.contentBase64, "base64") : undefined,
      }));
      if (conflicts.length) {
        const remaining = snapshots.filter((snapshot) => conflicts.includes(snapshot.path));
        const remainingPostMigration = postMigrationSnapshots.filter((snapshot) =>
          conflicts.includes(snapshot.path),
        );
        rollbackChanges.push({
          path: backup,
          content: Buffer.from(
            serializeMigrationCheckpoint(remaining, remainingPostMigration),
            "utf8",
          ),
        });
      } else {
        rollbackChanges.push({ path: backup, content: undefined });
      }
      applyProjectFileChanges(fs, root, rollbackChanges);
      if (conflicts.length) {
        return {
          exitCode: 1,
          error: `Migration rollback preserved modified/conflicting files: ${[...new Set(conflicts)].sort().join(", ")}`,
        };
      }
      return {
        exitCode: 0,
        output:
          "Migration rolled back; prior resources, ownership, and target state were restored.",
      };
    }
    if (command === "confirm") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const overrides: FactOverride[] = [];
      const accept = args.indexOf("--accept");
      if (accept >= 0 && args[accept + 1])
        overrides.push({ key: args[accept + 1], action: "accept" });
      const reject = args.indexOf("--reject");
      if (reject >= 0 && args[reject + 1])
        overrides.push({ key: args[reject + 1], action: "reject" });
      const edit = args.indexOf("--edit");
      if (edit >= 0 && args[edit + 1]?.includes("=")) {
        const [key, value] = args[edit + 1].split("=", 2);
        if (key && value) overrides.push({ key, action: "edit", value });
      }
      if (overrides.length === 0)
        return {
          exitCode: 1,
          error: "Usage: aiw confirm --accept key | --reject key | --edit key=value",
        };
      saveSettingOverrides(fs, aiw, overrides);
      return { exitCode: 0, output: "Fact overrides saved." };
    }
    if (command === "recommend") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const profile = await (services.profiler?.profile(root) ?? profileProject(root));
      const recommendations =
        services.recommender?.recommend(profile) ?? recommendCapabilities(profile);
      let ordered = recommendations;
      let ranked: RankedRecommendations | undefined;
      const rankingConfig = loadDecisionConfig(fs, aiw);
      if (rankingConfig?.enabled) {
        const decisionProvider =
          services.decisionProvider ?? createOllamaDecisionProvider(rankingConfig);
        if (!(await decisionProvider.available()))
          return {
            exitCode: 1,
            error: `Decision model ${rankingConfig.model} is not available at ${rankingConfig.baseUrl}.`,
          };
        let decisionTokens = 0;
        ranked = await rankRecommendations(recommendations, profile, async (scoped, recs) => {
          const request = buildRecommendationRankingRequest(profileSummaryForRanking(scoped), recs);
          decisionTokens += Math.ceil(
            (request.state.length +
              Object.values(request.questions).reduce(
                (total, question) => total + question.instructions.length,
                0,
              )) /
              4,
          );
          const response = await decisionProvider.decide(request);
          const answers: Record<string, { relevance?: number; confidence?: number }> = {};
          for (const [id, answer] of Object.entries(response.answers))
            answers[id] =
              typeof answer.score === "number"
                ? {
                    relevance: answer.score,
                    ...(typeof answer.confidence === "number"
                      ? { confidence: answer.confidence }
                      : {}),
                  }
                : {};
          return answers;
        });
        const usagePath = join(aiw, "usage.yml");
        const entries = fs.exists(usagePath) ? parseTokenUsage(fs.read(usagePath)) : [];
        fs.write(
          usagePath,
          serializeTokenUsage(
            recordTokenUsage(entries, {
              stage: "recommend.decision",
              budget: decisionTokens,
              used: decisionTokens,
              model: rankingConfig.model,
            }),
          ),
        );
        ordered = ranked.items;
      }
      const selectedOption = args.find((arg) => arg.startsWith("--select="));
      const selectedArg = selectedOption?.slice("--select=".length) ?? "";
      let selection: string[];
      if (selectedOption !== undefined)
        selection = await selectRecommendations(
          recommendations,
          async () => "n",
          selectedArg ? selectedArg.split(",") : [],
        );
      else if (!stdin.isTTY) selection = [];
      else {
        const terminal = createInterface({ input: stdin, output: stdout });
        selection = await selectRecommendations(ordered, (question) => terminal.question(question));
        terminal.close();
      }
      fs.write(
        join(aiw, "recommendations.yml"),
        serializeRecommendations(ordered, selection, ranked?.ranking),
      );
      const rankingNote = ranked
        ? ` Advisory decision-model ranking applied (${ranked.changedPositions} positions reordered); evidence states are unchanged.`
        : "";
      return {
        exitCode: 0,
        output: `${ordered.length} recommendations generated${
          selectedOption === undefined && !stdin.isTTY
            ? " without selection; review .aiw/recommendations.yml, then record user choices with --select=id,id."
            : "."
        }${rankingNote}`,
      };
    }
    if (command === "skills") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const action = args[1];
      const executor = services.externalSkills ?? nodeCommandExecutor;
      const approvedPermissions = parseApprovedPermissions(args);
      assertKnownPermissions(approvedPermissions);
      if (action === "search") {
        const query = args.find((arg) => arg.startsWith("--query="))?.slice(8) ?? "";
        return {
          exitCode: 0,
          output: await executeVercelSkills(executor, { command: "find", skill: query }),
        };
      }
      const source = args.find((arg) => arg.startsWith("--source="))?.slice(9);
      const skill = args.find((arg) => arg.startsWith("--skill="))?.slice(8);
      if (action === "inspect") {
        if (!source)
          return { exitCode: 1, error: "Usage: aiw skills inspect --source=owner/repository" };
        return {
          exitCode: 0,
          output: await executeVercelSkills(executor, { command: "inspect", source }),
        };
      }
      if (action === "install") {
        if (!source || !skill)
          return {
            exitCode: 1,
            error:
              "Usage: aiw skills install --source=owner/repository --skill=name --allow=network:external",
          };
        if (!approvedPermissions.includes("network:external"))
          return { exitCode: 1, error: "Package permissions require approval: network:external" };
        enforceConfiguredOrganizationPolicy(fs, aiw, {
          provider: "vercel-skills",
          source,
          permissions: ["network:external"],
        });
        const target = parseManifest(fs.read(join(aiw, "manifest.yml"))).target.active;
        const output = await installVercelSkill(executor, source, skill, target);
        writeVercelSkillLock(fs, root, aiw, source, skill);
        return { exitCode: 0, output };
      }
      if (action === "check" || action === "update") {
        if (!approvedPermissions.includes("network:external"))
          return { exitCode: 1, error: "Package permissions require approval: network:external" };
        const lockPath = join(aiw, "lock.yml");
        if (fs.exists(lockPath)) {
          parseLock(fs.read(lockPath))
            .filter(({ provider }) => provider === "vercel-skills")
            .forEach((locked) =>
              enforceConfiguredOrganizationPolicy(fs, aiw, {
                ...locked,
                permissions: [...new Set([...(locked.permissions ?? []), "network:external"])],
              }),
            );
        }
        const output = await executeVercelSkills(executor, { command: action });
        if (action === "update") refreshVercelSkillLocks(fs, root, aiw);
        return { exitCode: 0, output };
      }
      return {
        exitCode: 1,
        error: "Usage: aiw skills <search|inspect|install|check|update> [options]",
      };
    }
    if (command === "generate" || command === "sync") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const profilePath = join(aiw, "profile.yml");
      const persistedProfile = fs.exists(profilePath) ? fs.read(profilePath) : "";
      const profile = /^status:\s*scanned$/m.test(persistedProfile)
        ? parseProjectProfile(persistedProfile)
        : await profileProject(root);
      const selectedArg = args.find((arg) => arg.startsWith("--select="))?.split("=", 2)[1];
      const selected =
        selectedArg?.split(",") ?? (command === "sync" ? readSelectedRecommendations(fs, aiw) : []);
      if (command === "sync") {
        const previewOnly = args.includes("--preview");
        const planApprovals = args.filter((arg) => arg.startsWith("--approve-plan="));
        if (planApprovals.length > 1 || (previewOnly && planApprovals.length > 0))
          return {
            exitCode: 1,
            error: "Usage: aiw sync [--preview | --approve-plan=sha256-fingerprint]",
          };
        const approval = planApprovals[0]?.slice("--approve-plan=".length);
        const result = syncSelectedResources(
          fs,
          root,
          aiw,
          profile,
          selected,
          !previewOnly,
          approval,
        );
        if (result.error) return { exitCode: 1, error: result.error };
        if (previewOnly) return { exitCode: 0, output: result.preview };
        if (!approval)
          return {
            exitCode: 1,
            error: `Sync is read-only until the exact preview is approved. Review the plan, then rerun with --approve-plan=${result.fingerprint}.`,
          };
        if (approval !== result.fingerprint)
          return {
            exitCode: 1,
            error: `The sync plan changed after review. Run aiw sync --preview again and approve the new fingerprint (${result.fingerprint}).`,
          };
        if (result.conflicts?.length)
          return {
            exitCode: 1,
            error: `Sync plan has conflicts and made no changes: ${result.conflicts.join(", ")}`,
          };
        const messages = [result.output ?? "Selected bundled resources synchronized."];
        if (selected.includes("react-best-practices")) {
          let pendingReason = "network:external was not approved";
          try {
            enforceConfiguredOrganizationPolicy(fs, aiw, {
              provider: "vercel-skills",
              source: "vercel-labs/agent-skills",
              permissions: ["network:external"],
            });
          } catch (error) {
            pendingReason = error instanceof Error ? error.message : String(error);
          }
          messages.push(
            `Remote skill pending: ${pendingReason}. Install it separately with aiw skills install.`,
          );
        }
        return { exitCode: 0, output: messages.join(" ") };
      }
      if (selected.includes("react-best-practices")) {
        const approvedPermissions = parseApprovedPermissions(args);
        if (!approvedPermissions.includes("network:external"))
          return { exitCode: 1, error: "Package permissions require approval: network:external" };
        enforceConfiguredOrganizationPolicy(fs, aiw, {
          provider: "vercel-skills",
          source: "vercel-labs/agent-skills",
          permissions: ["network:external"],
        });
        const target =
          fs
            .read(join(aiw, "manifest.yml"))
            .match(/^\s*active:\s*(.+)$/m)?.[1]
            ?.trim() ?? "universal";
        await installVercelSkill(
          services.externalSkills ?? nodeCommandExecutor,
          "vercel-labs/agent-skills",
          "vercel-react-best-practices",
          target,
        );
        writeVercelSkillLock(
          fs,
          root,
          aiw,
          "vercel-labs/agent-skills",
          "vercel-react-best-practices",
        );
      }
      const conflicts: string[] = [];
      generateProjectResources(profile, selected, (path, content) => {
        const destination = join(aiw, path);
        if (fs.exists(destination)) {
          if (detectDrift(content, fs.read(destination))) conflicts.push(path);
          return;
        }
        fs.write(destination, content);
      });
      return {
        exitCode: conflicts.length ? 1 : 0,
        output: conflicts.length
          ? `Generated resources have manual changes: ${conflicts.join(", ")}`
          : "Project-specific resources generated.",
      };
    }
    if (command === "status") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 0, output: "AI Workflow is not installed." };
      try {
        const manifest = fs.read(join(aiw, "manifest.yml"));
        parseManifest(manifest);
        const workflowPath = join(aiw, "workflow.yml");
        if (!fs.exists(workflowPath)) return { exitCode: 0, output: manifest };
        const { session, ledger } = readWorkflowState(aiw, fs, false);
        return {
          exitCode: 0,
          output: `${manifest}\nSDD workflow ${session.workflowId} (${session.status})\n${workflowNextAction(ledger)}`,
        };
      } catch (error) {
        return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
      }
    }
    if (command === "doctor") {
      const required = ["manifest.yml", "profile.yml", "lock.yml", "ownership.yml"];
      const missing = required.filter((file) => !fs.exists(join(aiw, file)));
      if (missing.length)
        return { exitCode: 1, error: `Missing AI Workflow files: ${missing.join(", ")}` };
      try {
        parseManifest(fs.read(join(aiw, "manifest.yml")));
        parseOwnership(fs.read(join(aiw, "ownership.yml")));
        if (fs.exists(join(aiw, "team-preset.yml")))
          parseTeamPreset(fs.read(join(aiw, "team-preset.yml")));
        if (fs.exists(join(aiw, "registries.yml")))
          parsePrivateRegistries(fs.read(join(aiw, "registries.yml")));
        if (fs.exists(join(aiw, "telemetry.yml")))
          parseTelemetryConfig(fs.read(join(aiw, "telemetry.yml")));
        loadTelemetryConfig(fs, aiw);
      } catch (error) {
        return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
      }
      return { exitCode: 0, output: "AI Workflow health check passed." };
    }
    if (command === "repair") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "AI Workflow is not installed." };
      BASE_DIRECTORIES.forEach((dir) => fs.mkdir(join(aiw, dir)));
      if (!fs.exists(join(root, ".context/adrs/INDEX.md")))
        fs.write(join(root, ".context/adrs/INDEX.md"), "# Architecture Decision Records\n\n");
      return { exitCode: 0, output: "AI Workflow state repaired." };
    }
    if (command === "uninstall") {
      const manifestPath = join(aiw, "manifest.yml");
      assertSafeProjectPath(fs, root, manifestPath);
      if (!fs.exists(manifestPath)) return { exitCode: 1, error: "AI Workflow is not installed." };
      const ownershipPath = join(aiw, "ownership.yml");
      assertSafeProjectPath(fs, root, ownershipPath);
      if (!fs.exists(ownershipPath))
        return {
          exitCode: 1,
          error:
            "AIW ownership inventory is missing; refusing to remove resources whose ownership cannot be verified.",
        };
      if (fs.pathType?.(ownershipPath) !== "file")
        throw new Error("AIW ownership inventory is not a regular in-project file.");
      const ownedFiles = parseOwnership(fs.read(ownershipPath));
      const stateFiles = [
        "manifest.yml",
        "profile.yml",
        "lock.yml",
        "overrides.yml",
        "settings.yml",
        "recommendations.yml",
        "team-preset.yml",
        "registries.yml",
        "telemetry.yml",
        "checkpoints/migration-backup.yml",
      ];
      const dryRun = args.includes("--dry-run");
      if (!dryRun && !fs.remove)
        return { exitCode: 1, error: "Filesystem cannot remove AIW-owned files." };
      const removable: string[] = [];
      const conflicts: string[] = [];
      for (const file of ownedFiles) {
        const path = resolve(root, file.path);
        try {
          assertSafeProjectPath(fs, root, path);
          if (!fs.exists(path)) continue;
          if (fs.pathType?.(path) !== "file") {
            conflicts.push(file.path);
            continue;
          }
          const actual = `sha256-${checksumPackage(fs.readBytes?.(path) ?? fs.read(path))}`;
          if (actual === file.checksum) removable.push(path);
          else conflicts.push(file.path);
        } catch {
          conflicts.push(file.path);
        }
      }
      const statePaths: string[] = [];
      for (const file of stateFiles) {
        const path = join(aiw, file);
        if (!fs.exists(path)) continue;
        assertSafeProjectPath(fs, root, path);
        if (fs.pathType?.(path) !== "file") conflicts.push(`${WORKFLOW_DIRECTORY}/${file}`);
        else statePaths.push(path);
      }
      const uniqueConflicts = [...new Set(conflicts)].sort();
      const allRemovable = [...new Set([...removable, ...statePaths, ownershipPath])];
      const relativeRemovable = allRemovable
        .map((path) => relative(root, path).split(sep).join("/"))
        .sort();
      if (dryRun) {
        const report = [`Would remove: ${relativeRemovable.join(", ") || "none"}`];
        if (uniqueConflicts.length)
          report.push(`Would preserve modified/conflicting files: ${uniqueConflicts.join(", ")}`);
        return { exitCode: uniqueConflicts.length ? 1 : 0, output: report.join("\n") };
      }
      removable.forEach((path) => fs.remove?.(path));
      statePaths
        .filter((path) => !path.endsWith(`${sep}manifest.yml`))
        .forEach((path) => fs.remove?.(path));
      if (statePaths.includes(manifestPath)) fs.remove?.(manifestPath);
      fs.remove?.(ownershipPath);
      const removed = relativeRemovable.filter((path) => !uniqueConflicts.includes(path));
      return {
        exitCode: uniqueConflicts.length ? 1 : 0,
        output: [
          `AI Workflow-owned files removed: ${removed.join(", ") || "none"}.`,
          ...(uniqueConflicts.length
            ? [`Preserved modified/conflicting files: ${uniqueConflicts.join(", ")}`]
            : []),
        ].join("\n"),
      };
    }
    if (command === "brainstorm") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      assertStageReady(aiw, fs, "brainstorming");
      const title =
        args.find((arg) => arg.startsWith("--title="))?.slice(8) || "Untitled Brainstorm";
      const path = join(aiw, "generated/specs/brainstorm.md");
      fs.write(
        path,
        `# ${title}\n\n## Goal\n\n## Users\n\n## Facts\n\n## Assumptions\n\n## Hypotheses\n\n## Constraints\n\n## Risks\n\n## Non-goals\n\n## Open Questions\n\n`,
      );
      return { exitCode: 0, output: `Brainstorm artifact created: ${path}` };
    }
    if (command === "spec") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      assertStageReady(aiw, fs, "specification");
      const title =
        args.find((arg) => arg.startsWith("--title="))?.slice(8) || "Untitled Specification";
      const ticket = args.find((arg) => arg.startsWith("--ticket="))?.slice(9);
      if (ticket !== undefined) validateTaskTicket(ticket);
      const path = join(aiw, "generated/specs/specification.md");
      fs.write(
        path,
        `# ${title}\n${ticket ? `\n> Ticket: ${ticket}\n` : ""}\n## Context\n\n## Requirements\n\n### REQ-001: Requirement title\n\n- **Description:**\n- **Acceptance criteria:**\n  - Given\n  - When\n  - Then\n\n## Non-functional Requirements\n\n## Constraints\n\n## Open Questions\n\n`,
      );
      return { exitCode: 0, output: `Specification artifact created: ${path}` };
    }
    if (command === "adr") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      assertStageReady(aiw, fs, "technical-design");
      const id = args.find((arg) => arg.startsWith("--id="))?.slice(5) || "001";
      const title = args.find((arg) => arg.startsWith("--title="))?.slice(8) || "Untitled Decision";
      const path = join(
        root,
        ".context/adrs",
        `ADR-${id}-${title.toLowerCase().replaceAll(" ", "-")}.md`,
      );
      fs.write(
        path,
        `# ADR-${id}: ${title}\n\n- **Status:** proposed\n- **Related artifacts:**\n  - .aiw/generated/specs/\n\n## Context\n\n## Alternatives\n\n1. **Alternative A** — Description and trade-offs.\n2. **Alternative B** — Description and trade-offs.\n\n## Decision\n\n## Rationale\n\n## Consequences\n\n`,
      );
      return { exitCode: 0, output: `Architecture decision record created: ${path}` };
    }
    if (command === "plan") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      assertStageReady(aiw, fs, "plan");
      const title =
        args.find((arg) => arg.startsWith("--title="))?.slice(8) || "Untitled Implementation Plan";
      const path = join(aiw, "generated/plans/implementation-plan.md");
      fs.write(
        path,
        `# ${title}\n\n## Linked Requirements\n\n- REQ-001: Link to the specification requirement.\n\n## Tasks\n\n- [ ] TASK-001: Implement the first increment.\n  - Requirement: REQ-001\n  - Code: src/\n  - Tests: src/**/*.test.ts\n  - Validation: npm test\n  - Evidence: Record the passing command output and changed files.\n\n## Validation Commands\n\n- npm run check\n\n## Risks and Dependencies\n\n- Dependencies: List prerequisite tasks, packages, or decisions.\n- Risks: Record delivery, compatibility, and validation risks with mitigations.\n\n## Completion Evidence\n\n- TASK-001: Link code changes, test results, and validation output.\n\n`,
      );
      return { exitCode: 0, output: `Implementation plan created: ${path}` };
    }
    if (command === "verify") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      assertStageReady(aiw, fs, "verification");
      const specPath = join(aiw, "generated/specs/specification.md");
      const planPath = join(aiw, "generated/plans/implementation-plan.md");
      const issues: string[] = [];
      let specification = "";
      if (!fs.exists(specPath)) issues.push("Specification artifact is missing.");
      else {
        specification = fs.read(specPath);
        if (!specification.includes("Acceptance criteria"))
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
      }
      return issues.length
        ? { exitCode: 1, error: `Verification failed: ${issues.join(" ")}` }
        : {
            exitCode: 0,
            output:
              "Verification passed: requirements have acceptance criteria and validation coverage.",
          };
    }
    if (command === "trace") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      assertStageReady(aiw, fs, "traceability");
      const specPath = join(aiw, "generated/specs/specification.md");
      const planPath = join(aiw, "generated/plans/implementation-plan.md");
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
      const path = join(aiw, "generated/artifacts/traceability.yml");
      fs.write(path, serialized);
      return { exitCode: 0, output: `Traceability graph created: ${path}` };
    }
    if (command === "risk") {
      if (args[1] !== "assess")
        return { exitCode: 1, error: "Usage: aiw risk assess [--base-ref=ref] [--json]" };
      return runRiskAssess(args.slice(2), root, fs);
    }
    if (command === "gate") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const stage = args[1];
      if (!stage || !APPROVAL_STAGES.includes(stage as HumanApprovalStage))
        return {
          exitCode: 1,
          error: `Usage: aiw gate <${APPROVAL_STAGES.join("|")}>`,
        };
      const workflowStage = stage as HumanApprovalStage;
      assertStageReady(aiw, fs, workflowStage);
      const artifactPath = approvalArtifactPath(aiw, workflowStage);
      if (!artifactPath || !fs.exists(artifactPath))
        throw new BlockingError(
          describeBlockingReason("gate_evidence_missing", {
            stage,
            artifactPath: artifactPath ?? undefined,
            detail: `Quality gate blocked: required evidence is missing for ${stage}.`,
          }),
        );
      const hasQualityGate = stageDefinition(workflowStage).requiresQualityGate;
      if (hasQualityGate) {
        const issues = evaluateQualityGate(stage as QualityGateStage, fs.read(artifactPath));
        if (issues.length)
          throw new BlockingError(
            describeBlockingReason("gate_incomplete", {
              stage,
              artifactPath,
              gateIssues: issues,
              detail: `Quality gate blocked: ${issues.join(" ")}`,
            }),
          );
      }
      const { ledger } = readActiveWorkflow(aiw, fs);
      const updated = beginStageApproval(ledger, workflowStage, {
        artifactHash: stageFingerprint(fs.read(artifactPath)),
        qualityGate: hasQualityGate ? "passed" : "not-applicable",
        updatedAt: new Date().toISOString(),
      });
      fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(updated));
      return {
        exitCode: 0,
        output: `${hasQualityGate ? `Quality gate passed for ${stage}.` : `Evidence recorded for ${stage}; no automated quality gate applies.`} Human approval is still required: run aiw approve ${stage}.`,
      };
    }
    if (command === "validate") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "AI Workflow is not installed." };
      parseManifest(fs.read(join(aiw, "manifest.yml")));
      const packageArg = args.find((arg) => arg.startsWith("--package="));
      if (packageArg)
        validatePackageContract(
          fs.read(join(root, packageArg.slice(10))),
          (path) =>
            !fs.exists(join(root, "resources")) ||
            fs.exists(join(root, path)) ||
            fs.exists(join(root, "resources", path)),
        );
      return {
        exitCode: 0,
        output: "Configuration is valid.",
      };
    }
    if (command === "resolve") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const packageArg = args.find((arg) => arg.startsWith("--package="));
      const sourceArg = args.find((arg) => arg.startsWith("--source="));
      if (!packageArg && !sourceArg)
        return { exitCode: 1, error: "Usage: aiw resolve --package=path | --source=source" };
      const approvedPermissions = parseApprovedPermissions(args);
      if (sourceArg) {
        const source = resolveProvider(sourceArg.slice(9), root);
        const networkPermissions = requiresExternalNetwork(source) ? ["network:external"] : [];
        enforceConfiguredOrganizationPolicy(fs, aiw, {
          ...source,
          permissions: networkPermissions,
        });
        assertPermissions(networkPermissions, approvedPermissions);
      }
      const loaded = sourceArg
        ? (services.packageSources ?? nodePackageSourceLoader).load(sourceArg.slice(9), root)
        : undefined;
      try {
        const manifestPath = packageArg ? resolve(root, packageArg.slice(10)) : undefined;
        const directManifestBytes = loaded ? undefined : fs.readBytes?.(manifestPath!);
        const manifestContent =
          loaded?.manifest ??
          (directManifestBytes
            ? Buffer.from(directManifestBytes).toString("utf8")
            : fs.read(manifestPath!));
        const pkg = validatePackageContract(
          manifestContent,
          loaded ? (path): boolean => fs.exists(join(loaded.root, path)) : undefined,
        );
        const resolved = loaded
          ? {
              ...pkg,
              provider: loaded.provider,
              source: loaded.source,
              provenance: { ...pkg.provenance, source: loaded.source },
            }
          : pkg;
        enforceConfiguredOrganizationPolicy(fs, aiw, resolved);
        assertPackagePermissions(resolved, approvedPermissions);
        const packageRoot = loaded?.root ?? dirname(manifestPath!);
        const manifestBytes = loaded
          ? (loaded.manifestBytes ?? Buffer.from(loaded.manifest, "utf8"))
          : (directManifestBytes ?? Buffer.from(manifestContent, "utf8"));
        const integrity = checksumPackageSnapshot(
          manifestBytes,
          resolved,
          packageRoot,
          fs,
          loaded ? "package.yaml" : basename(manifestPath!),
        );
        const lockPath = join(aiw, "lock.yml");
        const locked = fs.exists(lockPath) ? parseLock(fs.read(lockPath)) : [];
        fs.write(
          lockPath,
          serializeLock([
            ...locked.filter(({ id }) => id !== resolved.id),
            resolvePackage(resolved, integrity),
          ]),
        );
        return { exitCode: 0, output: `Package resolved: ${resolved.id}@${resolved.version}` };
      } finally {
        loaded?.release();
      }
    }
    if (command === "audit-package") {
      const packageArg = args.find((arg) => arg.startsWith("--package="));
      if (!packageArg) return { exitCode: 1, error: "Usage: aiw audit-package --package=path" };
      const pkg = validatePackageContract(fs.read(join(root, packageArg.slice(10))));
      return { exitCode: 0, output: serializePermissionReview(pkg) };
    }
    if (command === "organization-policy") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const fileArg = args.find((arg) => arg.startsWith("--file="));
      if (!fileArg)
        return { exitCode: 1, error: "Usage: aiw organization-policy --file=path [--replace]" };
      const destination = join(aiw, "organization.yml");
      if (fs.exists(destination) && !args.includes("--replace"))
        return {
          exitCode: 1,
          error: "Organization policy already exists. Use --replace to update it explicitly.",
        };
      const policy = parseOrganizationPolicy(fs.read(join(root, fileArg.slice(7))));
      fs.write(destination, serializeOrganizationPolicy(policy));
      return { exitCode: 0, output: `Organization policy configured: ${policy.name}` };
    }
    if (command === "policy-check") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const policyPath = join(aiw, "organization.yml");
      if (!fs.exists(policyPath))
        return { exitCode: 1, error: "Organization policy is required for the CI policy gate." };
      if (!(services.policyTracking ?? gitPolicyTracking).isTracked(root, policyPath))
        return { exitCode: 1, error: "Organization policy must be tracked by Git." };
      const packageArgs = args.filter((arg) => arg.startsWith("--package="));
      if (!packageArgs.length)
        return { exitCode: 1, error: "Usage: aiw policy-check --package=path [--package=path]" };
      const packages = packageArgs.map((argument) =>
        validatePackageContract(fs.read(join(root, argument.slice(10)))),
      );
      const subjects: PackagePolicySubject[] = packages.map((pkg) => ({
        provider: pkg.provider,
        source: pkg.source,
        permissions: pkg.permissions,
      }));
      const lock = fs.read(join(aiw, "lock.yml"));
      subjects.push(
        ...parseLock(lock).map((locked) => ({
          provider: locked.provider,
          source: locked.source,
          permissions: locked.permissions ?? [],
        })),
      );
      const registriesPath = join(aiw, "registries.yml");
      if (fs.exists(registriesPath))
        subjects.push(
          ...parsePrivateRegistries(fs.read(registriesPath)).registries.map((registry) => ({
            provider: "private-registry",
            source: registry.url,
            permissions: ["network:external"],
          })),
        );
      const policy = parseOrganizationPolicy(fs.read(policyPath));
      subjects.forEach((subject) => assertKnownPermissions(subject.permissions));
      enforcePolicyGate(policy, subjects);
      return {
        exitCode: 0,
        output: `Organization policy gate passed: ${policy.name} (${subjects.length} subjects).`,
      };
    }
    if (command === "preset") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const fileArg = args.find((arg) => arg.startsWith("--file="));
      if (!fileArg) return { exitCode: 1, error: "Usage: aiw preset --file=path [--replace]" };
      const destination = join(aiw, "team-preset.yml");
      if (fs.exists(destination) && !args.includes("--replace"))
        return {
          exitCode: 1,
          error: "Team preset already exists. Use --replace to update it explicitly.",
        };
      const preset = parseTeamPreset(fs.read(join(root, fileArg.slice(7))));
      fs.write(destination, serializeTeamPreset(preset));
      return { exitCode: 0, output: `Team preset configured: ${preset.name}` };
    }
    if (command === "update") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const packageArg = args.find((arg) => arg.startsWith("--package="));
      if (!packageArg)
        return { exitCode: 1, error: "Usage: aiw update --package=path --target=target" };
      const manifestPath = resolve(root, packageArg.slice(10));
      const manifestBytes = fs.readBytes?.(manifestPath);
      const manifestContent = manifestBytes
        ? Buffer.from(manifestBytes).toString("utf8")
        : fs.read(manifestPath);
      const pkg = validatePackageContract(manifestContent);
      enforceConfiguredOrganizationPolicy(fs, aiw, pkg);
      assertPackagePermissions(pkg, parseApprovedPermissions(args));
      const target = args.find((arg) => arg.startsWith("--target="))?.slice(9) ?? "universal";
      if (!isTarget(target)) return { exitCode: 1, error: `Unsupported target: ${target}` };
      const lock = fs.exists(join(aiw, "lock.yml")) ? fs.read(join(aiw, "lock.yml")) : "";
      const lockedPackages = lock ? parseLock(lock) : [];
      const current = lockedPackages.find(({ id }) => id === pkg.id);
      const integrity = checksumPackageSnapshot(
        manifestBytes ?? Buffer.from(manifestContent, "utf8"),
        pkg,
        dirname(manifestPath),
        fs,
        basename(manifestPath),
      );
      if (current?.version === pkg.version && current.integrity !== integrity)
        throw new Error(
          `Package integrity mismatch for ${pkg.id}@${pkg.version}; package bytes changed.`,
        );
      const plan = planPackageUpdate(
        current ? { id: pkg.id, version: current.version } : undefined,
        pkg,
        target,
        new Map(
          lockedPackages.filter(({ id }) => id !== pkg.id).map(({ id, version }) => [id, version]),
        ),
      );
      if (plan.status !== "update")
        return { exitCode: 1, error: plan.reason ?? `Update blocked: ${plan.status}.` };
      const existingPackages = lockedPackages.filter(({ id }) => id !== pkg.id);
      fs.write(
        join(aiw, "lock.yml"),
        serializeLock([...existingPackages, resolvePackage(pkg, integrity)]),
      );
      return { exitCode: 0, output: `Package updated: ${pkg.id}@${pkg.version}` };
    }
    if (command === "registry") {
      if (args[1] === "configure") {
        if (!fs.exists(join(aiw, "manifest.yml")))
          return { exitCode: 1, error: "Run `aiw install` first." };
        const fileArg = args.find((arg) => arg.startsWith("--file="));
        if (!fileArg)
          return {
            exitCode: 1,
            error: "Usage: aiw registry configure --file=path [--replace]",
          };
        const destination = join(aiw, "registries.yml");
        if (fs.exists(destination) && !args.includes("--replace"))
          return {
            exitCode: 1,
            error:
              "Private registry configuration already exists. Use --replace to update it explicitly.",
          };
        const registries = parsePrivateRegistries(fs.read(join(root, fileArg.slice(7))));
        fs.write(destination, serializePrivateRegistries(registries));
        return {
          exitCode: 0,
          output: `Private registries configured: ${registries.registries.map(({ name }) => name).join(", ")}`,
        };
      }
      const query = args.find((arg) => arg.startsWith("--search="))?.slice(9) ?? "";
      const privateName = args.find((arg) => arg.startsWith("--private="))?.slice(10);
      if (privateName) {
        const configurationPath = join(aiw, "registries.yml");
        if (!fs.exists(configurationPath))
          return { exitCode: 1, error: "Configure private registries first." };
        const configuration = parsePrivateRegistries(fs.read(configurationPath));
        const registry = configuration.registries.find(({ name }) => name === privateName);
        if (!registry) return { exitCode: 1, error: "Unknown private registry." };
        enforceConfiguredOrganizationPolicy(fs, aiw, {
          provider: "private-registry",
          source: registry.url,
          permissions: ["network:external"],
        });
        const token = (services.environment ?? process.env)[registry.tokenEnv];
        if (!token)
          return {
            exitCode: 1,
            error: `Private registry credential is missing from environment variable: ${registry.tokenEnv}`,
          };
        let payload: unknown;
        try {
          payload = await (services.privateRegistries ?? fetchPrivateRegistryClient).search(
            registry,
            query,
            token,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Private registry request failed.";
          throw new Error(message.split(token).join("[REDACTED]"), { cause: error });
        }
        if (containsCredential(payload, token))
          throw new Error("Private registry response contains sensitive credential data.");
        const packages = parsePrivateRegistryPackages(payload, registry.url).sort((a, b) =>
          `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`),
        );
        packages.forEach((pkg) => assertKnownPermissions(pkg.permissions));
        return { exitCode: 0, output: serializeRegistry(packages) };
      }
      return { exitCode: 0, output: serializeRegistry(searchRegistry(query)) };
    }
    if (command === "verify-package") {
      const packageArg = args.find((arg) => arg.startsWith("--package="));
      const checksumArg = args.find((arg) => arg.startsWith("--checksum="));
      if (!packageArg || !checksumArg)
        return { exitCode: 1, error: "Usage: aiw verify-package --package=path --checksum=sha256" };
      const content = fs.read(join(root, packageArg.slice(10)));
      verifyPackageProvenance(content, { checksum: checksumArg.slice(11) });
      return { exitCode: 0, output: `Package provenance verified: ${checksumPackage(content)}` };
    }
    if (command === "context") {
      const layer = args.find((arg) => arg.startsWith("--layer="))?.slice(8) as
        ContextLayer | undefined;
      const content = args.find((arg) => arg.startsWith("--content="))?.slice(10);
      const store = readContextStore(root, fs);
      if (layer && CONTEXT_LAYERS.includes(layer) && content !== undefined) {
        writeContextLayer(root, fs, layer, content);
        return { exitCode: 0, output: `Context layer written: ${layer}` };
      }
      if (!layer && content === undefined) {
        const delta = args.find((arg) => arg.startsWith("--delta-from="));
        if (delta) {
          const reusableLayers = [store.layers.project, store.layers.task]
            .filter(Boolean)
            .join("\n\n");
          return {
            exitCode: 0,
            output: loadContextDelta(
              store.layers[delta.slice(13) as ContextLayer] ?? "",
              reusableLayers,
            ),
          };
        }
        const output = args.includes("--task") ? retrieveTaskContext(store) : composeContext(store);
        return { exitCode: 0, output };
      }
      return { exitCode: 1, error: "Usage: aiw context [--layer=project --content=text]" };
    }
    if (command === "context-summary") {
      const summaryArg = args.find((arg) => arg.startsWith("--summary="))?.slice(10);
      if (summaryArg === undefined)
        return { exitCode: 1, error: "Usage: aiw context-summary --summary=text" };
      const context = composeContext(readContextStore(root, fs));
      const cachePath = join(aiw, "context/summary.yml");
      if (fs.exists(cachePath)) {
        const cache = parseSummaryCache(fs.read(cachePath));
        if (isSummaryFresh(context, cache)) return { exitCode: 0, output: cache.summary };
      }
      fs.write(cachePath, serializeSummaryCache(createSummaryCache(context, summaryArg)));
      return { exitCode: 0, output: summaryArg };
    }
    if (command === "routing") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const usage = "Usage: aiw routing init | show | resolve --category=name";
      const action = args[1];
      const routingPath = join(aiw, ROUTING_TABLE_PATH);
      if (action === "init") {
        if (fs.exists(routingPath))
          return {
            exitCode: 1,
            error: `Routing table already exists: .aiw/${ROUTING_TABLE_PATH}. Edit it directly instead of re-initializing.`,
          };
        fs.write(
          routingPath,
          serializeRoutingTable(defaultRoutingTable()) +
            "# Add one rule per task category (dot-separated kebab-case, e.g. scan.interpreter).\n" +
            "# Name the evidence behind every rule — a benchmark, parity run, or ADR — before trusting it.\n" +
            "# Routing is advisory: humans can always override the resolved model.\n",
        );
        return {
          exitCode: 0,
          output: `Routing table created: .aiw/${ROUTING_TABLE_PATH}. Add rules with named evidence, then resolve with \`aiw routing resolve --category=...\`.`,
        };
      }
      if (action === "show") {
        if (!fs.exists(routingPath))
          return {
            exitCode: 1,
            error: `No routing table found. Run \`aiw routing init\` to create .aiw/${ROUTING_TABLE_PATH}.`,
          };
        return {
          exitCode: 0,
          output: serializeRoutingTable(parseRoutingTable(fs.read(routingPath))).trimEnd(),
        };
      }
      if (action === "resolve") {
        const category = args.find((arg) => arg.startsWith("--category="))?.slice(11);
        if (!category) return { exitCode: 1, error: usage };
        if (!fs.exists(routingPath))
          return {
            exitCode: 1,
            error: `No routing table found. Run \`aiw routing init\` first.`,
          };
        let route;
        try {
          route = resolveRoute(parseRoutingTable(fs.read(routingPath)), category);
        } catch (error) {
          throw new Error(`Routing failed: ${(error as Error).message}`, { cause: error });
        }
        return {
          exitCode: 0,
          output:
            serializeResolvedRoute(route) +
            "\noverride: advisory only — a human may choose a different model at any time.",
        };
      }
      return { exitCode: 1, error: usage };
    }
    if (command === "task-usage") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const parsed = parseNamedOptions(args.slice(1), ["workflow"]);
      if (!parsed) return { exitCode: 1, error: "Usage: aiw task-usage [--workflow=id-or-ticket]" };
      const sidecarPath = join(aiw, USAGE_SIDECAR_PATH);
      if (!fs.exists(sidecarPath))
        return {
          exitCode: 1,
          error:
            "No usage sidecar recorded yet. Correlate runs with `aiw usage-sidecar record --workflow=<id-or-ticket>` or run `aiw scan`.",
        };
      const sessionPath = join(aiw, "workflow.yml");
      const workflow =
        parsed.workflow ??
        (fs.exists(sessionPath)
          ? (parseWorkflowSession(fs.read(sessionPath)).ticket ??
            parseWorkflowSession(fs.read(sessionPath)).workflowId)
          : undefined);
      if (!workflow)
        return {
          exitCode: 1,
          error: "No workflow specified and no active SDD task. Pass --workflow=<id-or-ticket>.",
        };
      const summary = summarizeTaskUsage(parseUsageSidecar(fs.read(sidecarPath)), workflow);
      return {
        exitCode: 0,
        output: serializeTaskUsage(summary),
      };
    }
    if (command === "cost-report") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const sidecarPath = join(aiw, USAGE_SIDECAR_PATH);
      if (!fs.exists(sidecarPath))
        return {
          exitCode: 1,
          error:
            "No usage sidecar recorded yet. Record runs with `aiw usage-sidecar record` or run `aiw scan`.",
        };
      const tracePath = join(aiw, "generated/artifacts/traceability.yml");
      if (!fs.exists(tracePath))
        return {
          exitCode: 1,
          error:
            "Traceability graph is missing. Run `aiw trace` to build it from the approved specification and plan.",
        };
      const attribution = computeCostAttribution(
        parseUsageSidecar(fs.read(sidecarPath)),
        parseTraceabilityGraph(fs.read(tracePath)),
      );
      return {
        exitCode: 0,
        output:
          serializeCostAttribution(attribution) +
          "\nSources: .aiw/checkpoints/usage-sidecar.yml + .aiw/generated/artifacts/traceability.yml (verified = linked evidence present).",
      };
    }
    if (command === "heartbeat") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const parsed = parseNamedOptions(args.slice(1), ["session", "warn", "ttl"]);
      if (!parsed)
        return {
          exitCode: 1,
          error: "Usage: aiw heartbeat --session=id [--warn=seconds] [--ttl=seconds]",
        };
      const warnSeconds = parsed.warn === undefined ? HEARTBEAT_WARN_SECONDS : Number(parsed.warn);
      const ttlSeconds = parsed.ttl === undefined ? HEARTBEAT_TTL_SECONDS : Number(parsed.ttl);
      try {
        validateHeartbeatThresholds(warnSeconds, ttlSeconds);
      } catch (error) {
        return { exitCode: 1, error: (error as Error).message };
      }
      let session = parsed.session;
      if (!session && !stdin.isTTY) {
        // Claude Code hooks deliver a JSON payload with session_id on stdin.
        try {
          const payload: unknown = JSON.parse(await readStdin());
          if (
            payload &&
            typeof payload === "object" &&
            typeof (payload as { session_id?: unknown }).session_id === "string"
          )
            session = (payload as { session_id: string }).session_id;
        } catch {
          // No parseable payload: fall through to the explicit error below.
        }
      }
      if (!session)
        return {
          exitCode: 1,
          error:
            "A session id is required: pass --session=id or pipe a harness hook JSON payload on stdin.",
        };
      const statePath = join(aiw, HEARTBEAT_STATE_PATH);
      const state = fs.exists(statePath)
        ? parseHeartbeatState(fs.read(statePath))
        : emptyHeartbeatState();
      const { state: nextState, outcome } = recordBeat(
        state,
        session,
        new Date(),
        warnSeconds,
        ttlSeconds,
      );
      fs.write(statePath, serializeHeartbeatState(nextState));
      const lines = [describeHeartbeatOutcome(outcome)];
      if (outcome.checkpoint) {
        const checkpointPath = join(
          aiw,
          `checkpoints/heartbeat-${session}-${outcome.checkpoint.index}.yml`,
        );
        fs.write(
          checkpointPath,
          serializeHeartbeatCheckpoint(outcome.checkpoint, outcome.gapSeconds ?? 0, ttlSeconds),
        );
        lines.push(`checkpoint: ${relative(root, checkpointPath).split(sep).join("/")}`);
      }
      return { exitCode: 0, output: lines.join("\n") };
    }
    if (command === "hooks") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const action = args[1];
      if (action !== "install")
        return {
          exitCode: 1,
          error:
            "Usage: aiw hooks install --target=claude-code (codex and gemini adapters follow the same command)",
        };
      const parsed = parseNamedOptions(args.slice(2), ["target"]);
      if (!parsed?.target)
        return { exitCode: 1, error: "Usage: aiw hooks install --target=claude-code" };
      if (parsed.target !== "claude-code")
        return {
          exitCode: 1,
          error: `Harness hook adapter not available yet for: ${parsed.target}. Claude Code is wired; codex and gemini follow the same pattern.`,
        };
      const settingsPath = join(root, ".claude/settings.json");
      let settings;
      try {
        settings = parseClaudeSettings(fs.exists(settingsPath) ? fs.read(settingsPath) : "");
      } catch (error) {
        return {
          exitCode: 1,
          error: `Existing .claude/settings.json is not a valid hooks file; fix or move it first: ${(error as Error).message}`,
        };
      }
      const result = installHeartbeatHooks(settings);
      if (fs.pathType?.(settingsPath) === "symlink")
        return {
          exitCode: 1,
          error: ".claude/settings.json is a symbolic link; install hooks manually.",
        };
      writeClaudeSettings(fs, settingsPath, result.settings);
      return {
        exitCode: 0,
        output:
          `Heartbeat hooks installed into .claude/settings.json (project-scoped):\n` +
          [...result.added, ...result.alreadyPresent]
            .map(
              (event) =>
                `- ${event}: ${result.added.includes(event) ? "added" : "already present"} → aiw heartbeat on every event`,
            )
            .join("\n") +
          "\nSessions now record beats; idle gaps inside the warn window save a compact checkpoint while the cache is still warm.",
      };
    }
    if (command === "usage-sidecar") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const usage =
        "Usage: aiw usage-sidecar record --command=name (--cache-read=N | --fresh-input=N | --cache-write=N | --output=N) [--model=name] [--harness=name] [--harness-version=text] [--estimated] | aiw usage-sidecar report";
      const action = args[1];
      const sidecarPath = join(aiw, USAGE_SIDECAR_PATH);
      if (action === "report") {
        const entries = fs.exists(sidecarPath) ? parseUsageSidecar(fs.read(sidecarPath)) : [];
        return {
          exitCode: 0,
          output:
            serializeUsageSidecarSummary(summarizeUsageSidecar(entries)) +
            (entries.length
              ? `\nLedger: .aiw/${USAGE_SIDECAR_PATH} (${entries.length} entries, sequence-ordered, no timestamps)`
              : ""),
        };
      }
      if (action === "import") {
        const parsed = parseNamedOptions(args.slice(2), ["from", "path"]);
        const source = parsed?.from as ImportSource | undefined;
        if (!parsed || !source || !["claude-code", "codex", "gemini", "pi"].includes(source))
          return {
            exitCode: 1,
            error:
              "Usage: aiw usage-sidecar import --from=claude-code|codex|gemini|pi [--path=logs-directory]",
          };
        if (!fs.list)
          return { exitCode: 1, error: "The filesystem cannot enumerate harness logs." };
        const home = homedir();
        const defaultRoot =
          source === "claude-code"
            ? join(home, ".claude/projects", root.split("/").join("-"))
            : source === "codex"
              ? join(home, ".codex/sessions")
              : source === "pi"
                ? join(home, ".pi/agent/sessions")
                : join(home, ".gemini/antigravity-cli/brain");
        const scanRoot = parsed.path ? resolve(parsed.path) : defaultRoot;
        if (fs.pathType?.(scanRoot) !== "directory")
          return {
            exitCode: 1,
            error: `Harness log directory not found: ${scanRoot}. Pass --path to point at the ${source} logs.`,
          };
        const wanted = (name: string): boolean =>
          source === "claude-code"
            ? name.endsWith(".jsonl")
            : source === "codex"
              ? /^rollout-.*\.jsonl$/.test(name)
              : name === "transcript_full.jsonl";
        const files: string[] = [];
        const listDirectory = fs.list;
        if (source === "pi") {
          // Pi groups sessions into directories named after the project path.
          const munged = root.split("/").join("-");
          for (const name of listDirectory(scanRoot) ?? []) {
            if (!name.includes(munged)) continue;
            const directory = join(scanRoot, name);
            if (fs.pathType?.(directory) !== "directory") continue;
            for (const file of listDirectory(directory) ?? [])
              if (file.endsWith(".jsonl") && fs.pathType?.(join(directory, file)) === "file")
                files.push(join(directory, file));
          }
        } else {
          const walk = (directory: string, depth: number): void => {
            if (depth > 6) return;
            for (const name of listDirectory(directory) ?? []) {
              const absolute = join(directory, name);
              const type = fs.pathType?.(absolute);
              if (type === "directory") walk(absolute, depth + 1);
              else if (type === "file" && wanted(name)) files.push(absolute);
            }
          };
          walk(scanRoot, 0);
        }
        files.sort();
        const events = [];
        for (const file of files) {
          const content = fs.read(file);
          if (source === "claude-code") events.push(...parseClaudeCodeTranscript(content));
          else if (source === "codex") {
            const parsedEvents = parseCodexSession(content, root);
            if (parsedEvents) events.push(...parsedEvents);
          } else if (source === "pi") events.push(...parsePiSession(content));
          else events.push(...parseGeminiTranscript(content));
        }
        let ledger: UsageSidecarEntry[];
        try {
          ledger = fs.exists(sidecarPath) ? parseUsageSidecar(fs.read(sidecarPath)) : [];
        } catch (error) {
          throw new Error(`Usage sidecar is unreadable: ${(error as Error).message}`, {
            cause: error,
          });
        }
        const merged = mergeImportedEvents(ledger, events);
        fs.write(sidecarPath, serializeUsageSidecar(merged.ledger));
        const result: ImportResult = {
          source,
          files: files.length,
          events: events.length,
          imported: merged.imported,
          skipped: merged.skipped,
        };
        return {
          exitCode: 0,
          output:
            summarizeImport(result) +
            (source === "gemini"
              ? "\nnote: Gemini transcripts do not record a working directory, so imports cannot be scoped to this project."
              : "") +
            `\nLedger: .aiw/${USAGE_SIDECAR_PATH} (rerun safely: already-imported events are skipped).`,
        };
      }
      if (action === "record") {
        const recordArgs = args.slice(2).filter((arg) => arg !== "--estimated");
        if (recordArgs.some((arg) => arg !== "--estimated" && !arg.startsWith("--")))
          return { exitCode: 1, error: usage };
        const parsed = parseNamedOptions(recordArgs, [
          "command",
          "model",
          "harness",
          "harness-version",
          "requirement",
          "workflow",
          ...USAGE_TIERS,
        ]);
        if (!parsed?.command) return { exitCode: 1, error: usage };
        const tierValues = USAGE_TIERS.map((tier) => [tier, parsed[tier]] as const).filter(
          ([, value]) => value !== undefined,
        );
        if (!tierValues.length)
          return {
            exitCode: 1,
            error:
              "At least one token tier is required: --cache-read, --fresh-input, --cache-write, or --output.",
          };
        for (const [, value] of tierValues)
          if (!/^\d+$/.test(value))
            return { exitCode: 1, error: "Token tiers must be non-negative integers." };
        const entry = {
          command: parsed.command,
          label: (args.includes("--estimated") ? "estimated" : "measured") as
            "measured" | "estimated",
          tiers: Object.fromEntries(
            USAGE_TIERS.map((tier) => [tier, Number(parsed[tier] ?? 0)]),
          ) as Record<(typeof USAGE_TIERS)[number], number>,
          ...(parsed.model ? { model: parsed.model } : {}),
          ...(parsed.harness ? { harness: parsed.harness } : {}),
          ...(parsed["harness-version"] ? { harnessVersion: parsed["harness-version"] } : {}),
          ...(parsed.requirement ? { requirement: parsed.requirement } : {}),
          ...(parsed.workflow ? { workflow: parsed.workflow } : {}),
        };
        let ledger: UsageSidecarEntry[];
        try {
          ledger = fs.exists(sidecarPath) ? parseUsageSidecar(fs.read(sidecarPath)) : [];
        } catch (error) {
          throw new Error(`Usage sidecar is unreadable: ${(error as Error).message}`, {
            cause: error,
          });
        }
        const next = appendUsageSidecarEntry(ledger, entry);
        fs.write(sidecarPath, serializeUsageSidecar(next));
        return {
          exitCode: 0,
          output: `Usage recorded (seq ${next[next.length - 1].seq}, ${entry.label}): ${entry.command} — ${USAGE_TIERS.filter(
            (tier) => entry.tiers[tier] > 0,
          )
            .map((tier) => `${tier} ${entry.tiers[tier].toLocaleString("en-US")}`)
            .join(", ")}`,
        };
      }
      return { exitCode: 1, error: usage };
    }
    if (command === "token-usage") {
      const usagePath = join(aiw, "usage.yml");
      const entries = fs.exists(usagePath) ? parseTokenUsage(fs.read(usagePath)) : [];
      const stage = args.find((arg) => arg.startsWith("--stage="))?.slice(8);
      const budget = args.find((arg) => arg.startsWith("--budget="))?.slice(9);
      const used = args.find((arg) => arg.startsWith("--used="))?.slice(7);
      if (stage !== undefined || budget !== undefined || used !== undefined) {
        if (stage === undefined || budget === undefined || used === undefined)
          return {
            exitCode: 1,
            error: "Usage: aiw token-usage --stage=name --budget=number --used=number",
          };
        const next = recordTokenUsage(entries, {
          stage,
          budget: Number(budget),
          used: Number(used),
        });
        fs.write(usagePath, serializeTokenUsage(next));
        return { exitCode: 0, output: `Token usage recorded: ${stage} (${used}/${budget})` };
      }
      if (entries.length === 0) return { exitCode: 0, output: "No token usage recorded yet." };
      const summary = summarizeUsageByModel(entries);
      return {
        exitCode: 0,
        output: `Token usage by model:\n${summary
          .map(
            (entry) =>
              `- ${entry.model}: ${entry.tokens.toLocaleString("en-US")} tokens (${entry.stages.join(", ")})`,
          )
          .join("\n")}\n\nRaw records:\n${serializeTokenUsage(entries)}`,
      };
    }
    if (command === "context-quality") {
      const metrics = measureContextQuality(readContextStore(root, fs));
      const output = serializeContextQuality(metrics);
      fs.write(join(aiw, "context/quality.yml"), output);
      return { exitCode: 0, output };
    }
    if (command === "self-validate") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
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
    if (command === "capabilities") {
      const target = args.find((arg) => arg.startsWith("--target="))?.slice(9) ?? "universal";
      return { exitCode: 0, output: serializeAdapterCapabilities(target) };
    }
    return {
      exitCode: 0,
      output:
        "aiw install [--target target] | workflow <start|status|complete> [--id=id] | task <start|status> --ticket=TEAM-123 [--title=text] | approve <stage> | reject <stage> --reason=text | skip <optional-stage> --reason=text | ui [--port=number] | orchestrate --plan=path [--execute] [--max-parallel=number] | telemetry <status|show|enable|disable> [privacy options] | plugin <create|validate> [options] | scan | semantic <status|query> | decision <status|triage> | self-validate --ticket=TYPE-000 | organization-policy --file=path [--replace] | policy-check --package=path [--package=path] | preset --file=path [--replace] | context | context-summary | context-quality | capabilities [--target=target] | token-usage [--stage=name --budget=number --used=number] | registry [--search=query] [--private=name] | registry configure --file=path [--replace] | skills <search|inspect|install|check|update> [options] | audit-package --package=path | verify-package --package=path --checksum=sha256 | brainstorm [--title=title] | spec [--title=title] | adr [--id=id --title=title] | plan [--title=title] | verify | trace | gate <stage> | recommend [--select=id,id] | status | doctor | repair | uninstall [--dry-run] | target <target> | rollback | confirm | resolve --package=path | update --package=path --target=target | validate [--package=path]",
    };
  } catch (error) {
    if (error instanceof BlockingError && args.includes("--json")) {
      return { exitCode: 1, output: JSON.stringify(blockingResultToJson(error.result)) };
    }
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
}

function readWorkflowState(
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
    throw new Error("Workflow session and approval ledger IDs do not match; run doctor.");
  if (requireActive && session.status !== "active")
    throw new Error(`Workflow ${session.workflowId} is complete; start a new workflow first.`);
  const changed = APPROVAL_STAGES.find((stage) => {
    const record = ledger.stages[stage];
    if (!record?.artifactHash || !["pending-human", "approved"].includes(record.status))
      return false;
    const artifact = approvalArtifactPath(aiw, stage);
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

function readActiveWorkflow(
  aiw: string,
  fs: FileSystem,
): { session: WorkflowSession; ledger: ApprovalLedger } {
  return readWorkflowState(aiw, fs, true);
}

function workflowNextAction(ledger: ApprovalLedger): string {
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

type LightEvidence = {
  schema: 1;
  workflowId: string;
  ticket?: string;
  lane: "light";
  laneReason?: string;
  entries: { note: string; recordedAt: string }[];
};

function parseLightEvidence(content: string): LightEvidence {
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

function assertStageReady(aiw: string, fs: FileSystem, stage: HumanApprovalStage): void {
  const { session, ledger } = readActiveWorkflow(aiw, fs);
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

function approvalArtifactPath(aiw: string, stage: HumanApprovalStage): string {
  if (stage === "technical-design") return join(aiw, "generated/reports/technical-design.md");
  const paths: Record<Exclude<HumanApprovalStage, "technical-design">, string> = {
    brainstorming: "generated/specs/brainstorm.md",
    specification: "generated/specs/specification.md",
    plan: "generated/plans/implementation-plan.md",
    implementation: "generated/reports/implementation-report.md",
    verification: "generated/reports/verification-report.md",
    review: "generated/reports/code-review.md",
    traceability: "generated/artifacts/traceability.yml",
  };
  return resolve(aiw, paths[stage]);
}

function formatConfidence(confidence: number | undefined): string {
  return confidence === undefined ? "unknown" : confidence.toFixed(3);
}

function formatNoul(noul: number | undefined): string {
  return noul === undefined ? "unknown" : noul.toFixed(3);
}

function parseNamedOptions(args: string[], allowed: string[]): Record<string, string> | undefined {
  const entries = args.map((arg) => arg.match(/^--([a-z-]+)=(.+)$/)?.slice(1));
  if (
    args.some((arg) => arg.indexOf("=") !== arg.lastIndexOf("=")) ||
    entries.some((entry) => !entry || !allowed.includes(entry[0])) ||
    new Set(entries.map((entry) => entry?.[0])).size !== entries.length
  )
    return undefined;
  return Object.fromEntries(entries as string[][]);
}

function safeProjectFile(root: string, path: string, fs: FileSystem): string {
  if (
    !path ||
    isAbsolute(path) ||
    [...path].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    }) ||
    path.split(/[\\/]/).includes("..")
  )
    throw new Error("Orchestration plan must be a safe project-relative file.");
  const projectRoot = fs.realpath?.(resolve(root)) ?? resolve(root);
  const candidate = resolve(root, path);
  const candidateType = fs.pathType?.(candidate) ?? (fs.exists(candidate) ? "file" : "missing");
  if (!isInsidePath(resolve(root), candidate) || candidateType !== "file")
    throw new Error(`Orchestration plan does not exist or is not a file: ${path}`);
  const realCandidate = fs.realpath?.(candidate) ?? candidate;
  if (!isInsidePath(projectRoot, realCandidate))
    throw new Error("Orchestration plan must stay inside the project.");
  return candidate;
}

function isInsidePath(root: string, destination: string): boolean {
  const path = relative(root, destination);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

type ProjectFileChange = { path: string; content: Uint8Array | undefined };

function snapshotProjectFiles(fs: FileSystem, root: string, paths: string[]): MigrationSnapshot[] {
  const snapshots: MigrationSnapshot[] = [];
  for (const path of [...new Set(paths)]) {
    assertSafeProjectPath(fs, root, path);
    const type = fs.pathType?.(path);
    if (type === "missing") {
      snapshots.push({
        path: relative(root, path).split(sep).join("/"),
        existed: false,
        contentBase64: "",
      });
      continue;
    }
    if (type !== "file")
      throw new Error(`Migration path is not a regular project file: ${relative(root, path)}`);
    snapshots.push({
      path: relative(root, path).split(sep).join("/"),
      existed: true,
      contentBase64: Buffer.from(readResourceBytes(fs, path)).toString("base64"),
    });
  }
  return snapshots;
}

function expectedMigrationSnapshots(
  root: string,
  changes: ProjectFileChange[],
): MigrationSnapshot[] {
  return [...new Map(changes.map((change) => [change.path, change])).values()].map(
    ({ path, content }) => ({
      path: relative(root, path).split(sep).join("/"),
      existed: content !== undefined,
      contentBase64: content ? Buffer.from(content).toString("base64") : "",
    }),
  );
}

function migrationSnapshotMatches(
  fs: FileSystem,
  path: string,
  expected: MigrationSnapshot,
): boolean {
  const type = fs.pathType?.(path);
  if (!expected.existed) return type === "missing";
  if (type !== "file") return false;
  return Buffer.from(readResourceBytes(fs, path)).equals(
    Buffer.from(expected.contentBase64, "base64"),
  );
}

function applyProjectFileChanges(fs: FileSystem, root: string, changes: ProjectFileChange[]): void {
  const ordered = [...new Map(changes.map((change) => [change.path, change])).values()];
  if (ordered.some(({ content }) => content === undefined) && !fs.remove)
    throw new Error("Filesystem cannot remove obsolete migration resources.");
  const snapshots = snapshotProjectFiles(
    fs,
    root,
    ordered.map(({ path }) => path),
  );
  try {
    for (const change of ordered) {
      if (change.content === undefined) {
        if (fs.exists(change.path)) fs.remove?.(change.path);
      } else {
        writeResourceBytes(fs, change.path, change.content);
      }
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const snapshot of [...snapshots].reverse()) {
      const path = resolve(root, snapshot.path);
      try {
        if (snapshot.existed)
          writeResourceBytes(fs, path, Buffer.from(snapshot.contentBase64, "base64"));
        else if (fs.exists(path)) fs.remove?.(path);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed)
      throw new Error("Migration failed and automatic rollback was incomplete; use aiw rollback.", {
        cause: error,
      });
    throw error;
  }
}

function parsePrivateRegistryPackages(payload: unknown, registryUrl: string): RegistryPackage[] {
  if (!Array.isArray(payload)) throw new Error("Private registry response must be an array.");
  return payload.map((value, index) => {
    if (!value || typeof value !== "object")
      throw new Error(`Private registry package ${index} is invalid.`);
    const item = value as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.version !== "string" ||
      typeof item.description !== "string" ||
      !Array.isArray(item.permissions) ||
      !item.permissions.every((permission) => typeof permission === "string")
    )
      throw new Error(`Private registry package ${index} is invalid.`);
    if (
      !item.id ||
      !item.version ||
      /[\r\n]/.test(item.id) ||
      /[\r\n]/.test(item.version) ||
      /[\r\n]/.test(item.description)
    )
      throw new Error(`Private registry package ${index} contains unsafe text.`);
    return {
      id: item.id,
      version: item.version,
      description: item.description,
      provider: "private-registry" as const,
      source: `${registryUrl}/${item.id}`,
      permissions: item.permissions as string[],
    };
  });
}

function containsCredential(
  value: unknown,
  credential: string,
  visited: Set<object> = new Set(),
): boolean {
  if (typeof value === "string") return value.includes(credential);
  if (!value || typeof value !== "object" || visited.has(value)) return false;
  visited.add(value);
  return Object.values(value).some((entry) => containsCredential(entry, credential, visited));
}

function syncSelectedResources(
  fs: FileSystem,
  root: string,
  aiw: string,
  profile: ProjectProfile,
  selected: string[],
  apply = false,
  approvedFingerprint?: string,
): {
  output?: string;
  error?: string;
  preview?: string;
  fingerprint?: string;
  conflicts?: string[];
} {
  const target = parseManifest(fs.read(join(aiw, "manifest.yml"))).target.active;
  const resourceSelections = resourcesForCapabilities(selected);
  const bundled = loadBundledResources(target);
  const bundleByKey = new Map(
    bundled.map((resource) => [`${resource.type}/${resource.id}`, resource]),
  );
  const desired = new Map<string, { content: string; metadata: OwnershipMetadata }>();
  const generatedFiles = new Map<string, string>();

  const addOwned = (path: string, content: string, metadata: OwnershipMetadata): void => {
    const previous = desired.get(path);
    if (previous && previous.content !== content)
      throw new Error(`Selected resources render conflicting content at ${path}`);
    desired.set(path, { content, metadata });
  };
  const addResource = (
    type: "skills" | "rules" | "agents" | "hooks" | "templates",
    id: string,
    content: string,
  ): void => {
    const neutralPath = join(root, renderResourcePath("universal", type, id));
    const targetPath = join(root, renderResourcePath(target, type, id));
    addOwned(neutralPath, content, {
      kind: "neutral-resource",
      target: "universal",
      resourceType: type,
      resourceId: id,
    });
    if (targetPath !== neutralPath)
      addOwned(targetPath, content, {
        kind: "target-resource",
        target,
        resourceType: type,
        resourceId: id,
      });
  };

  for (const reference of resourceSelections) {
    const key = `${reference.type}/${reference.id}`;
    const resource = bundleByKey.get(key);
    if (!resource) return { error: `Bundled resource is unavailable: ${key}` };
    addResource(
      reference.type,
      reference.id,
      personalizeBundledResource(reference.type, reference.id, resource.content, profile),
    );
  }

  generateProjectResources(profile, selected, (path, content) => {
    generatedFiles.set(join(aiw, path), content);
    const rule = path.match(/^generated\/rules\/(project-quality|tdd-project-policy)\.md$/);
    if (rule) addResource("rules", rule[1], content);
    const rootContext = path === "generated/context/root-context.md";
    if (rootContext) {
      const neutralContextPath = join(
        root,
        describeResource("universal", "context", "project").path,
      );
      addOwned(neutralContextPath, content, {
        kind: "neutral-resource",
        target: "universal",
        resourceType: "context",
        resourceId: "project",
      });
      const targetContextPath = describeResource(target, "context", "project").path;
      if (targetContextPath !== renderAiInitPath(target)) {
        addOwned(join(root, targetContextPath), content, {
          kind: "target-resource",
          target,
          resourceType: "context",
          resourceId: "project",
        });
      }
    }
  });

  const ownershipPath = join(aiw, "ownership.yml");
  if (fs.pathType?.(ownershipPath) !== "file")
    return {
      error: "AI Workflow ownership inventory is missing or unsafe; reinstall before syncing.",
    };
  const inventory = parseOwnership(fs.read(ownershipPath));
  const nextInventory = new Map(inventory.map((entry) => [entry.path, entry]));
  const changes: ProjectFileChange[] = [];
  const changeActions = new Map<string, "add" | "update">();
  const preserved = new Map<string, { path: string; state: string; contentFingerprint?: string }>();
  const conflicts: string[] = [];
  const preserve = (path: string, type: string | undefined, content?: string): void => {
    preserved.set(path, {
      path,
      state: type ?? "unknown",
      ...(content === undefined ? {} : { contentFingerprint: stageFingerprint(content) }),
    });
  };

  for (const [path, { content, metadata }] of desired) {
    assertSafeProjectPath(fs, root, path);
    const relativePath = relative(root, path).split(sep).join("/");
    const type = fs.pathType?.(path);
    const owned = nextInventory.get(relativePath);
    if (type === "missing") {
      changes.push({ path, content: Buffer.from(content, "utf8") });
      changeActions.set(relativePath, "add");
      nextInventory.set(relativePath, createOwnedFile(relativePath, content, metadata));
      continue;
    }
    if (type !== "file" || !owned) {
      conflicts.push(relativePath);
      preserve(relativePath, type);
      continue;
    }
    const actual = fs.read(path);
    if (createOwnedFile(relativePath, actual).checksum !== owned.checksum) {
      conflicts.push(relativePath);
      preserve(relativePath, type, actual);
      continue;
    }
    if (actual !== content) {
      changes.push({ path, content: Buffer.from(content, "utf8") });
      changeActions.set(relativePath, "update");
    } else preserve(relativePath, type, actual);
    nextInventory.set(relativePath, createOwnedFile(relativePath, content, metadata));
  }

  for (const [path, content] of generatedFiles) {
    assertSafeProjectPath(fs, root, path);
    const type = fs.pathType?.(path);
    const relativePath = relative(root, path).split(sep).join("/");
    if (type === "missing") {
      changes.push({ path, content: Buffer.from(content, "utf8") });
      changeActions.set(relativePath, "add");
    } else if (type !== "file" || fs.read(path) !== content) {
      conflicts.push(relative(root, path).split(sep).join("/"));
      preserve(relativePath, type, type === "file" ? fs.read(path) : undefined);
    } else preserve(relativePath, type, fs.read(path));
  }
  const nextOwnership = serializeOwnership([...nextInventory.values()]);
  if (fs.read(ownershipPath) !== nextOwnership) {
    changes.push({ path: ownershipPath, content: Buffer.from(nextOwnership, "utf8") });
    changeActions.set(relative(root, ownershipPath).split(sep).join("/"), "update");
  }
  const plan = {
    target,
    selected: [...new Set(selected)].sort(),
    changes: changes
      .map(({ path, content }) => ({
        path: relative(root, path).split(sep).join("/"),
        action: changeActions.get(relative(root, path).split(sep).join("/")) ?? "update",
        contentFingerprint: stageFingerprint(content ?? new Uint8Array()),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    preserved: [...preserved.values()].sort((a, b) => a.path.localeCompare(b.path)),
    conflicts: [...new Set(conflicts)].sort(),
    externalPending: selected.includes("react-best-practices")
      ? [
          {
            id: "vercel-react-best-practices",
            source: "vercel-labs/agent-skills",
            permissions: ["network:external"],
            approval: "separate human decision required",
          },
        ]
      : [],
  };
  const fingerprint = stageFingerprint(JSON.stringify(plan));
  const preview = `${JSON.stringify({ plan, fingerprint }, null, 2)}\n`;
  if (!apply) return { preview, fingerprint, conflicts: plan.conflicts };
  if (!approvedFingerprint) return { preview, fingerprint, conflicts: plan.conflicts };
  if (approvedFingerprint !== fingerprint)
    return { error: `The sync plan changed after review; current fingerprint is ${fingerprint}.` };
  if (plan.conflicts.length)
    return { error: `Sync plan has conflicts and made no changes: ${plan.conflicts.join(", ")}` };
  if (changes.length) applyProjectFileChanges(fs, root, changes);
  return {
    output: `Synchronized ${resourceSelections.length} selected bundled resources for ${target} and generated ${generatedFiles.size} project-specific files.`,
    preview,
    fingerprint,
    conflicts: plan.conflicts,
  };
}

function personalizeBundledResource(
  type: "skills" | "rules" | "agents" | "hooks" | "templates",
  id: string,
  content: string,
  profile: ProjectProfile,
): string {
  const contextual =
    (type === "rules" &&
      [
        "quality-gates",
        "tdd-policy",
        "dependency-policy",
        "architecture-policy",
        "data-access-policy",
      ].includes(id)) ||
    (type === "skills" &&
      ["nestjs-development", "prisma-data-access", "vite-frontend"].includes(id)) ||
    (type === "agents" &&
      ["technical-architect", "typescript-engineer", "nestjs-engineer", "prisma-engineer"].includes(
        id,
      ));
  if (!contextual) return content;
  const signals = [
    profile.runtime.languages.length ? `- Languages: ${profile.runtime.languages.join(", ")}` : "",
    profile.frameworks.length ? `- Frameworks: ${profile.frameworks.join(", ")}` : "",
    profile.testing ? `- Test runner: ${profile.testing.name}` : "",
    profile.testing?.command
      ? `- Test command: \`${safeProjectSignal(profile.testing.command)}\``
      : "",
    profile.quality.linter ? `- Linter: ${profile.quality.linter.name}` : "",
    profile.quality.linter?.command
      ? `- Lint command: \`${safeProjectSignal(profile.quality.linter.command)}\``
      : "",
    profile.quality.formatter ? `- Formatter: ${profile.quality.formatter.name}` : "",
    profile.quality.formatter?.command
      ? `- Format command: \`${safeProjectSignal(profile.quality.formatter.command)}\``
      : "",
    ...(profile.modules ?? []).map((module) => {
      const parts = [
        module.name
          ? `${safeProjectSignal(module.name)} (${safeProjectSignal(module.path)})`
          : safeProjectSignal(module.path),
        module.frameworks.length ? `frameworks: ${module.frameworks.join(", ")}` : "",
        ...(module.architecture ?? []).map((item) => `architecture: ${safeProjectSignal(item)}`),
        ...(module.patterns ?? []).map((item) => `patterns: ${safeProjectSignal(item)}`),
        module.testing
          ? `tests: ${module.testing.name}${module.testing.command ? ` (${safeProjectSignal(module.testing.command)})` : ""}`
          : "",
        module.quality.linter
          ? `linter: ${module.quality.linter.name}${module.quality.linter.command ? ` (${safeProjectSignal(module.quality.linter.command)})` : ""}`
          : "",
      ].filter(Boolean);
      const evidence = (module.evidence ?? []).slice(0, 8).map(safeProjectSignal);
      return `- Module ${parts.join("; ")}${evidence.length ? `; evidence: ${evidence.join(", ")}` : ""}`;
    }),
  ].filter(Boolean);
  return signals.length
    ? `${content.trimEnd()}\n\n## Detected project context\n\n${signals.join("\n")}\n`
    : content;
}

function safeProjectSignal(value: string): string {
  return value
    .split("")
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "`"
        ? " "
        : character,
    )
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function profileSummaryForRanking(profile: ProjectProfile): string {
  return [
    `languages: ${profile.runtime.languages.join(", ") || "none"}`,
    `frameworks: ${profile.frameworks.join(", ") || "none"}`,
    `package-manager: ${profile.packageManager}`,
    `testing: ${profile.testing?.name ?? "none"}`,
    `linter: ${profile.quality.linter?.name ?? "none"}`,
  ].join("; ");
}

function readSelectedRecommendations(fs: FileSystem, aiw: string): string[] {
  if (!fs.exists(join(aiw, "recommendations.yml"))) return [];
  const content = fs.read(join(aiw, "recommendations.yml"));
  const selections = content
    .split(/^\s{2}- id: /m)
    .slice(1)
    .flatMap((block) => {
      const id = block.split("\n", 1)[0].trim();
      const selectedCapability = /^\s{4}selected: true$/m.test(block) ? [id] : [];
      const selectedResources =
        block
          .match(/^\s{4}selected_resources: \[([^\]]*)\]$/m)?.[1]
          ?.split(",")
          .map((resource) => resource.trim())
          .filter(Boolean) ?? [];
      return [...selectedCapability, ...selectedResources];
    });
  return [...new Set(selections)];
}

function parseApprovedPermissions(args: string[]): string[] {
  return args
    .filter((arg) => arg.startsWith("--allow="))
    .flatMap((arg) => arg.slice("--allow=".length).split(","))
    .map((permission) => permission.trim())
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enforceConfiguredOrganizationPolicy(
  fs: FileSystem,
  aiw: string,
  subject: PackagePolicySubject,
): void {
  const path = join(aiw, "organization.yml");
  if (fs.exists(path)) enforceOrganizationPolicy(parseOrganizationPolicy(fs.read(path)), subject);
}

function skillIntegrity(fs: FileSystem, root: string, skill: string): string {
  if (!fs.exists(join(root, "skills-lock.json"))) return "unknown";
  const lock = fs.read(join(root, "skills-lock.json"));
  const escaped = escapeRegExp(skill);
  return (
    lock.match(
      new RegExp(
        `"${escaped}"\\s*:\\s*\\{[\\s\\S]*?"(?:computedHash|skillFolderHash)"\\s*:\\s*"([^"]+)"`,
      ),
    )?.[1] ?? "unknown"
  );
}

function writeVercelSkillLock(
  fs: FileSystem,
  root: string,
  aiw: string,
  source: string,
  skill: string,
): void {
  const lockPath = join(aiw, "lock.yml");
  const current = fs.exists(lockPath) ? fs.read(lockPath) : "schema: 1\npackages:\n";
  const id = `${source}/${skill}`;
  const withoutExisting = current.replace(
    new RegExp(`  - id: ${escapeRegExp(id)}\\n(?:    [^\\n]+\\n){4,5}`, "g"),
    "",
  );
  fs.write(
    lockPath,
    `${withoutExisting.replace(/\n*$/, "\n")}  - id: ${id}\n    version: latest\n    provider: vercel-skills\n    source: ${source}\n    integrity: ${skillIntegrity(fs, root, skill)}\n    permissions: [network:external]\n`,
  );
}

function refreshVercelSkillLocks(fs: FileSystem, root: string, aiw: string): void {
  const lockPath = join(aiw, "lock.yml");
  if (!fs.exists(lockPath)) return;
  const content = fs
    .read(lockPath)
    .replace(
      /( {2}- id: ([^\n]+)\n {4}version: latest\n {4}provider: vercel-skills\n {4}source: ([^\n]+)\n {4}integrity: )([^\n]+)/g,
      (_entry, prefix: string, id: string): string =>
        `${prefix}${skillIntegrity(fs, root, id.split("/").at(-1) ?? id)}`,
    );
  fs.write(lockPath, content);
}

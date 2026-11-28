import { join, relative, sep } from "node:path";
import { stdin } from "node:process";
import { BlockingError, describeBlockingReason } from "../blocking-reasons.js";
import { harvestApprovalObservations, monitorSession } from "../eval/monitor.js";
import { createEmptyStore, parseProposalStore, serializeProposalStore } from "../eval/proposals.js";
import {
  HEARTBEAT_STATE_PATH,
  HEARTBEAT_TTL_SECONDS,
  HEARTBEAT_WARN_SECONDS,
  describeHeartbeatOutcome,
  emptyHeartbeatState,
  parseHeartbeatState,
  recordBeat,
  serializeHeartbeatCheckpoint,
  serializeHeartbeatState,
  validateHeartbeatThresholds,
} from "../heartbeat.js";
import {
  installHeartbeatHooks,
  parseClaudeSettings,
  writeClaudeSettings,
} from "../hook-installer.js";
import {
  createCliOrchestrator,
  createTaskWorktrees,
  currentBranch,
  executeOrchestrationPlan,
  forecastIntegration,
  listManagedWorktrees,
  parseOrchestrationPlan,
  parseOrchestrationResults,
  removeWorktrees,
  serializeOrchestrationPreview,
  serializeOrchestrationResults,
  validateOrchestrationParallelism,
} from "../orchestration.js";
import {
  createPluginScaffold,
  validatePluginDirectory,
  writePluginScaffold,
} from "../plugin-sdk.js";
import { saveSettingsSection } from "../settings.js";
import {
  DEFAULT_TELEMETRY_CONFIG,
  TELEMETRY_BUFFER_CAP,
  TELEMETRY_BUFFER_FILE,
  loadTelemetryConfig,
  purgeTelemetryBuffer,
  readTelemetryBuffer,
  serializeTelemetryMapping,
} from "../telemetry.js";
import type { CommandResult } from "../types.js";
import { installationRequired, parseNamedOptions, readStdin, safeProjectFile } from "./shared.js";
import type { CommandContext, CommandHandler } from "./types.js";

async function handleUi({ args, root, aiw, fs, services }: CommandContext): Promise<CommandResult> {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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

async function handleOrchestrate({
  args,
  root,
  aiw,
  fs,
  services,
}: CommandContext): Promise<CommandResult> {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const executeCount = args.filter((arg) => arg === "--execute").length;
  if (executeCount > 1)
    return {
      exitCode: 1,
      error:
        "Usage: aiw orchestrate --plan=path [--execute] [--isolate] [--cleanup] [--max-parallel=number]",
    };
  const execute = executeCount === 1;
  const integrateRequested = args[1] === "integrate";
  if (integrateRequested) {
    const integrateParsed = parseNamedOptions(args.slice(2), ["plan"]);
    if (!integrateParsed?.plan)
      return { exitCode: 1, error: "Usage: aiw orchestrate integrate --plan=path" };
    const planPath = safeProjectFile(root, integrateParsed.plan, fs);
    const plan = parseOrchestrationPlan(fs.read(planPath));
    const checkpoint = join(aiw, `checkpoints/orchestration-${plan.id}.yml`);
    if (!fs.exists(checkpoint))
      throw new BlockingError(
        describeBlockingReason("orchestration_not_executed", {
          detail: `No checkpoint for plan ${plan.id} — the plan has not been executed yet.`,
        }),
      );
    const results = parseOrchestrationResults(fs.read(checkpoint));
    const forecast = forecastIntegration(root, plan, results);
    const lines = [`Integration forecast for plan ${plan.id} → ${currentBranch(root)}`];
    let conflicts = 0;
    for (const line of forecast) {
      if (line.state === "conflict") conflicts += 1;
      lines.push(
        line.state === "conflict"
          ? `wave ${line.wave} · ${line.taskId} (${line.branch}): CONFLICTS — ${(line.conflicts ?? []).join(", ")}`
          : line.state === "missing"
            ? `wave ${line.wave} · ${line.taskId}: branch missing (${line.branch})`
            : line.state === "identical"
              ? `wave ${line.wave} · ${line.taskId}: already integrated`
              : `wave ${line.wave} · ${line.taskId} (${line.branch}): clean merge`,
      );
    }
    lines.push(`conflicts: ${conflicts}`);
    const output = lines.join("\n");
    return conflicts > 0 ? { exitCode: 1, output, error: undefined } : { exitCode: 0, output };
  }
  const isolate = args.includes("--isolate");
  const cleanup = args.includes("--cleanup");
  if (cleanup) {
    const leaked = listManagedWorktrees(root, aiw);
    if (leaked.length === 0) return { exitCode: 0, output: "No managed worktrees to clean." };
    if (!execute)
      return {
        exitCode: 0,
        output: `Managed worktrees found:\n${leaked.map((path) => `- ${path}`).join("\n")}\nRe-run with --execute to remove them.`,
      };
    removeWorktrees(root, leaked, { force: true });
    return { exitCode: 0, output: `Removed ${leaked.length} managed worktree(s).` };
  }
  const named = args
    .slice(1)
    .filter((arg) => arg !== "--execute" && arg !== "--isolate" && arg !== "--cleanup");
  const parsed = parseNamedOptions(named, ["plan", "max-parallel", "runner", "timeout-ms"]);
  if (!parsed?.plan)
    return {
      exitCode: 1,
      error:
        "Usage: aiw orchestrate --plan=path [--execute] [--runner=cli] [--timeout-ms=ms] [--isolate] [--cleanup] [--max-parallel=number]",
    };
  if (parsed.runner !== undefined && parsed.runner !== "cli")
    return {
      exitCode: 1,
      error: `Unsupported orchestration runner: ${parsed.runner}. Supported: cli.`,
    };
  let timeoutMs: number | undefined;
  if (parsed["timeout-ms"] !== undefined) {
    if (!/^\d+$/.test(parsed["timeout-ms"]))
      return {
        exitCode: 1,
        error: "Orchestration --timeout-ms must be an integer in milliseconds.",
      };
    timeoutMs = Number(parsed["timeout-ms"]);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000)
      return { exitCode: 1, error: "Orchestration --timeout-ms must be between 1000 and 3600000." };
  }
  const planPath = safeProjectFile(root, parsed.plan, fs);
  const plan = parseOrchestrationPlan(fs.read(planPath));
  const maxParallel = validateOrchestrationParallelism(
    parsed["max-parallel"] === undefined ? 2 : Number(parsed["max-parallel"]),
  );
  if (!execute) return { exitCode: 0, output: serializeOrchestrationPreview(plan) };
  const orchestrator =
    services.orchestrator ??
    (parsed.runner === "cli" ? createCliOrchestrator({ root, timeoutMs }) : undefined);
  if (!orchestrator)
    return {
      exitCode: 1,
      error: "No multi-agent orchestrator is configured. Pass --runner=cli or inject an adapter.",
    };
  const checkpoint = join(aiw, `checkpoints/orchestration-${plan.id}.yml`);
  const reservation = `${checkpoint}.lock`;
  if (!fs.createExclusive)
    return { exitCode: 1, error: "The filesystem does not support atomic orchestration." };
  if (fs.exists(checkpoint) || !fs.createExclusive(reservation, "schema: 1\nstate: running\n"))
    return {
      exitCode: 1,
      error: `Orchestration checkpoint already exists; use a new plan id: ${checkpoint}`,
    };
  const wallClockStart = Date.now();
  try {
    const isolation = isolate
      ? {
          options: { root, aiw, planId: plan.id },
          worktrees: createTaskWorktrees(root, aiw, plan),
        }
      : undefined;
    const results = await executeOrchestrationPlan(plan, orchestrator, maxParallel, isolation);
    if (isolation) {
      const passedPaths = results
        .filter(({ status, worktree }) => status === "passed" && worktree)
        .map(({ worktree }) => worktree as string);
      removeWorktrees(root, passedPaths);
    }
    fs.write(checkpoint, serializeOrchestrationResults(plan, results, Date.now() - wallClockStart));
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

function handleTelemetry({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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
    saveSettingsSection(fs, aiw, "telemetry", serializeTelemetryMapping(DEFAULT_TELEMETRY_CONFIG));
    return { exitCode: 0, output: "Telemetry disabled." };
  }
  if (action === "enable") {
    const options = args.slice(2).filter((arg) => arg !== "--verbose");
    if (
      options.some((option) => !/^--(?:commands|outcomes)=(?:include|exclude)$/.test(option)) ||
      new Set(options.map((option) => option.slice(0, option.indexOf("=")))).size !== options.length
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

function handlePlugin({ args, root, fs }: CommandContext): CommandResult {
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

async function handleHeartbeat({ args, root, aiw, fs }: CommandContext): Promise<CommandResult> {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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
  // REQ-003 wiring: a new session is the boundary where the previous
  // session's rejections become monitor occurrences. Monitor failures
  // must never break the heartbeat.
  if (outcome.decision === "session-start") {
    try {
      const ledgerPath = join(aiw, "approvals.yml");
      if (fs.exists(ledgerPath)) {
        const artifacts = harvestApprovalObservations(fs.read(ledgerPath));
        if (artifacts.length > 0) {
          const proposalsPath = join(aiw, "proposals.yml");
          const store = fs.exists(proposalsPath)
            ? parseProposalStore(fs.read(proposalsPath))
            : createEmptyStore();
          const { surfaced } = monitorSession(store, artifacts);
          fs.write(proposalsPath, serializeProposalStore(store));
          if (surfaced.length > 0)
            lines.push(
              `monitor: ${surfaced.length} recurring pattern(s) crossed the proposal threshold — run aiw proposals list`,
            );
        }
      }
    } catch {
      // observation is best-effort; heartbeat stays authoritative
    }
  }
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

function handleHooks({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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

export const runtimeToolsCommands: Record<string, CommandHandler> = {
  ui: handleUi,
  orchestrate: handleOrchestrate,
  telemetry: handleTelemetry,
  plugin: handlePlugin,
  heartbeat: handleHeartbeat,
  hooks: handleHooks,
};

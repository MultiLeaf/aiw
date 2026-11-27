import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveStageArtifact } from "../artifact-paths.js";
import { BlockingError, describeBlockingReason } from "../blocking-reasons.js";
import {
  collectContextBench,
  compareContextBench,
  parseContextBench,
  serializeContextBench,
} from "../context-benchmark.js";
import {
  createSummaryCache,
  isSummaryFresh,
  parseSummaryCache,
  serializeSummaryCache,
} from "../context-cache.js";
import { measureContextQuality, serializeContextQuality } from "../context-quality.js";
import { loadContextDelta, retrieveTaskContext } from "../context-retrieval.js";
import {
  composeContext,
  CONTEXT_LAYERS,
  readContextStore,
  writeContextLayer,
  type ContextLayer,
} from "../context-store.js";
import {
  computeCostAttribution,
  serializeCostAttribution,
  serializeTaskUsage,
  summarizeTaskUsage,
} from "../cost-attribution.js";
import { digestFreshness, formatDigestLine } from "../digest.js";
import { parseWorkflowSession, processStages } from "../human-approval.js";
import {
  defaultRoutingTable,
  parseRoutingTable,
  resolveRoute,
  ROUTING_TABLE_PATH,
  serializeResolvedRoute,
  serializeRoutingTable,
} from "../model-routing.js";
import {
  materializeParityTask,
  parseParityTask,
  runParitySuite,
  serializeParitySuite,
  TASK_ASSEMBLER,
} from "../task-parity.js";
import {
  parseTokenUsage,
  recordTokenUsage,
  serializeTokenUsage,
  summarizeUsageByModel,
} from "../token-usage.js";
import { parseTraceabilityGraph } from "../traceability.js";
import type { CommandResult } from "../types.js";
import {
  mergeImportedEvents,
  parseClaudeCodeTranscript,
  parseCodexSession,
  parseGeminiTranscript,
  parsePiSession,
  summarizeImport,
  type ImportResult,
  type ImportSource,
} from "../usage-import.js";
import {
  appendUsageSidecarEntry,
  parseUsageSidecar,
  serializeUsageSidecar,
  serializeUsageSidecarSummary,
  summarizeUsageSidecar,
  USAGE_SIDECAR_PATH,
  USAGE_TIERS,
  type UsageSidecarEntry,
} from "../usage-sidecar.js";
import { installationRequired, parseNamedOptions, safeProjectFile } from "./shared.js";
import type { CommandContext, CommandHandler } from "./types.js";
import {
  activeWorkflowId,
  approvalArtifactPath,
  parseContextBudgets,
  readWorkflowState,
} from "./workflow-state.js";

function handleContextBench({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const saveCount = args.filter((arg) => arg === "--save").length;
  if (saveCount > 1)
    return { exitCode: 1, error: "Usage: aiw context-bench [--baseline=path] [--save]" };
  const save = saveCount === 1;
  const parsed = parseNamedOptions(
    args.slice(1).filter((arg) => arg !== "--save"),
    ["baseline"],
  );
  if (!parsed) return { exitCode: 1, error: "Usage: aiw context-bench [--baseline=path] [--save]" };
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

function handleParity({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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
  const taskFiles = (fs.list(tasksDirectory) ?? []).filter((name) => name.endsWith(".yml")).sort();
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

function handleContext({ args, root, aiw, fs }: CommandContext): CommandResult {
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
      const reusableLayers = [store.layers.project, store.layers.task].filter(Boolean).join("\n\n");
      return {
        exitCode: 0,
        output: loadContextDelta(
          store.layers[delta.slice(13) as ContextLayer] ?? "",
          reusableLayers,
        ),
      };
    }
    const output = args.includes("--task") ? retrieveTaskContext(store) : composeContext(store);
    const stageArg = args.find((argument) => argument.startsWith("--stage="))?.slice(8);
    const digestLines: string[] = [];
    if (fs.exists(join(aiw, "workflow.yml"))) {
      for (const stage of processStages(readWorkflowState(aiw, fs, false).ledger)) {
        const artifactPath = approvalArtifactPath(fs, aiw, stage);
        const freshness = digestFreshness(aiw, fs, stage, artifactPath ?? undefined);
        if (freshness.state !== "missing") digestLines.push(formatDigestLine(freshness));
      }
    }
    const budgetArg = args.find((argument) => argument.startsWith("--budget="))?.slice(9);
    if (stageArg) {
      const budget = Number(budgetArg ?? parseContextBudgets(aiw, fs)[stageArg]);
      if (Number.isFinite(budget) && budget > 0) {
        const estimated = Math.ceil(output.length / 4);
        if (estimated > budget)
          throw new BlockingError(
            describeBlockingReason("context_budget_exceeded", {
              stage: stageArg,
              detail: `Stage ${stageArg} context is ~${estimated} tokens, over the ${budget}-token ceiling.`,
            }),
          );
      }
      const digestBlock = digestLines.length > 0 ? `\n${digestLines.join("\n")}` : "";
      return {
        exitCode: 0,
        output: `${output}${digestBlock}\n\nstage: ${stageArg} · ~${Math.ceil(output.length / 4)} tokens${Number.isFinite(budget) && budget > 0 ? ` · ceiling ${budget}` : " · no ceiling declared"}`,
      };
    }
    return { exitCode: 0, output };
  }
  return {
    exitCode: 1,
    error:
      "Usage: aiw context [--layer=project --content=text] | aiw context --stage=<name> [--budget=tokens]",
  };
}

function handleContextSummary({ args, root, aiw, fs }: CommandContext): CommandResult {
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

function handleRouting({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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

function handleTaskUsage({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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

function handleCostReport({ aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const sidecarPath = join(aiw, USAGE_SIDECAR_PATH);
  if (!fs.exists(sidecarPath))
    return {
      exitCode: 1,
      error:
        "No usage sidecar recorded yet. Record runs with `aiw usage-sidecar record` or run `aiw scan`.",
    };
  const tracePath = resolveStageArtifact(fs, aiw, "traceability", activeWorkflowId(fs, aiw)).path;
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

function handleUsageSidecar({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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
    if (!fs.list) return { exitCode: 1, error: "The filesystem cannot enumerate harness logs." };
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
      label: (args.includes("--estimated") ? "estimated" : "measured") as "measured" | "estimated",
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

function handleTokenUsage({ args, aiw, fs }: CommandContext): CommandResult {
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

function handleContextQuality({ root, aiw, fs }: CommandContext): CommandResult {
  const metrics = measureContextQuality(readContextStore(root, fs));
  const output = serializeContextQuality(metrics);
  fs.write(join(aiw, "context/quality.yml"), output);
  return { exitCode: 0, output };
}

export const contextUsageCommands: Record<string, CommandHandler> = {
  "context-bench": handleContextBench,
  parity: handleParity,
  context: handleContext,
  "context-summary": handleContextSummary,
  routing: handleRouting,
  "task-usage": handleTaskUsage,
  "cost-report": handleCostReport,
  "usage-sidecar": handleUsageSidecar,
  "token-usage": handleTokenUsage,
  "context-quality": handleContextQuality,
};

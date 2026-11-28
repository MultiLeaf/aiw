import { join } from "node:path";
import { applyOverrides } from "../confirmation.js";
import { debugLog } from "../debug.js";
import {
  buildEvidenceTriageRequest,
  buildFindingsTriageRequest,
  buildSemanticRerankRequest,
  checkFindingShapes,
  createOllamaDecisionProvider,
  loadDecisionConfig,
  parseReviewFindings,
} from "../decision.js";
import { mergeFacts } from "../intelligence.js";
import {
  buildInterpreterQuery,
  createInterpretationRequest,
  createOpenAiCompatibleProvider,
  createProjectInterpreter,
  loadAiProviderConfig,
  selectInterpreterKeyFiles,
  type AiProviderUsage,
} from "../interpreter.js";
import { profileProject } from "../profile.js";
import { scanProject } from "../scanner.js";
import {
  buildCoveringTestQuery,
  buildSemanticIndex,
  createOllamaEmbeddingProvider,
  loadSemanticConfig,
  parseSemanticIndex,
  querySemanticIndex,
  renderJudgeContext,
  rerankSemanticMatches,
  SEMANTIC_INDEX_PATH,
  serializeSemanticIndex,
  type RerankedMatch,
  type SemanticIndex,
  type SemanticIndexBuildStats,
} from "../semantic.js";
import { readFactOverrides } from "../settings.js";
import { parseTokenUsage, recordTokenUsage, serializeTokenUsage } from "../token-usage.js";
import type { CommandResult } from "../types.js";
import {
  appendUsageSidecarEntry,
  parseUsageSidecar,
  serializeUsageSidecar,
  USAGE_SIDECAR_PATH,
} from "../usage-sidecar.js";
import {
  formatConfidence,
  formatNoul,
  installationRequired,
  parseNamedOptions,
  safeProjectFile,
} from "./shared.js";
import type { CommandContext, CommandHandler } from "./types.js";

async function handleScan(ctx: CommandContext): Promise<CommandResult> {
  const { root, aiw, fs, services } = ctx;
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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
    overrides.filter((override) => override.action === "reject").map((override) => override.key),
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
  const advisories: string[] = [];
  const semanticConfig = loadSemanticConfig(fs, aiw);
  if (semanticConfig?.enabled) {
    const provider = services.embeddingProvider ?? createOllamaEmbeddingProvider(semanticConfig);
    try {
      if (!(await provider.available())) {
        advisories.push(
          `Advisory: semantic model ${semanticConfig.model} is not available at ${semanticConfig.baseUrl}; skipped semantic index update and kept deterministic profile.`,
        );
      } else {
        const indexPath = join(aiw, SEMANTIC_INDEX_PATH);
        let existingIndex: SemanticIndex | undefined;
        if (fs.exists(indexPath)) {
          try {
            existingIndex = parseSemanticIndex(fs.read(indexPath));
          } catch (error) {
            debugLog(
              "models",
              "existing semantic index unreadable; rebuilding from scratch",
              error,
            );
          }
        }
        let buildStats: SemanticIndexBuildStats | undefined;
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
          {
            existingIndex,
            onStats: (stats) => {
              buildStats = stats;
            },
          },
        );
        fs.mkdir(join(aiw, "semantic"));
        fs.write(join(aiw, SEMANTIC_INDEX_PATH), serializeSemanticIndex(index));
        const embeddedChars =
          buildStats?.embeddedChars ??
          index.chunks.reduce((total, chunk) => total + chunk.text.length, 0);
        const embeddedChunks = buildStats?.embeddedChunks ?? index.chunks.length;
        const reusedChunks = buildStats?.reusedChunks ?? 0;
        const batches = Math.ceil(embeddedChunks / 64);
        const detail =
          reusedChunks > 0
            ? `${semanticConfig.model} — indexed ${index.chunks.length} chunks (${reusedChunks} reused, ${embeddedChunks} embedded in ${batches} batch request${batches === 1 ? "" : "s"})`
            : `${semanticConfig.model} — indexed ${index.chunks.length} chunks in ${batches} batch requests`;
        modelUsage.push({
          label: "embedding",
          tokens: Math.ceil(embeddedChars / 4),
          detail,
          model: semanticConfig.model,
        });
      }
    } catch (error) {
      debugLog("models", "semantic indexing failed during scan; degraded gracefully", error);
      advisories.push(
        `Advisory: semantic indexing failed (${error instanceof Error ? error.message : String(error)}); deterministic profile was still written.`,
      );
    }
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
    let sidecarUpdated = false;
    for (const usage of modelUsage) {
      const measured = usage.detail.includes("(measured)");
      const isInterpreter = usage.label === "interpreter" && measured && interpreterUsage;
      const tiers = isInterpreter
        ? {
            "cache-read": 0,
            "fresh-input": interpreterUsage!.promptTokens,
            "cache-write": 0,
            output: interpreterUsage!.completionTokens,
          }
        : { "cache-read": 0, "fresh-input": usage.tokens, "cache-write": 0, output: 0 };
      if (Object.values(tiers).every((value) => value === 0)) continue;
      sidecar = appendUsageSidecarEntry(sidecar, {
        command: `scan.${usage.label}`,
        label: measured ? "measured" : "estimated",
        tiers,
        model: usage.model,
        harness: "aiw-cli",
      });
      sidecarUpdated = true;
    }
    if (sidecarUpdated) fs.write(sidecarPath, serializeUsageSidecar(sidecar));
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
        : "\nModels used: none (deterministic scan).") +
      (advisories.length > 0 ? `\n${advisories.join("\n")}` : ""),
  };
}

async function handleDecision(ctx: CommandContext): Promise<CommandResult> {
  const { args, root, aiw, fs, services } = ctx;
  const usage =
    "Usage: aiw decision triage --artifact=<path> | aiw decision findings-triage --findings=<path> | aiw decision status";
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
    const provider = services.decisionProvider ?? createOllamaDecisionProvider(config);
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
  if (action === "findings-triage") {
    const parsed = parseNamedOptions(args.slice(2), ["findings"]);
    if (!parsed?.findings) return { exitCode: 1, error: usage };
    const findingsPath = safeProjectFile(root, parsed.findings, fs);
    if (!fs.exists(findingsPath))
      return { exitCode: 1, error: `Findings file not found: ${parsed.findings}` };
    const findings = parseReviewFindings(fs.read(findingsPath));
    const lines: string[] = [];
    const shapeIssues = checkFindingShapes(findings);
    lines.push(
      shapeIssues.length === 0
        ? "Shape check: all findings are well-formed."
        : `Shape check failures (deterministic):\n${shapeIssues.map((i) => `  - ${i}`).join("\n")}`,
    );
    if (config?.enabled) {
      const provider = services.decisionProvider ?? createOllamaDecisionProvider(config);
      try {
        if (await provider.available()) {
          const decision = await provider.decide(buildFindingsTriageRequest(findings));
          lines.push("Advisory evidence triage (refuter still owns corroboration):");
          for (const finding of findings)
            if (finding.severity.toLowerCase() === "severe")
              lines.push(
                `  - ${finding.id}: evidence_supported: ${decision.answers[finding.id]?.choice ?? "unclear"}`,
              );
        }
      } catch (error) {
        // Advisory flow: provider failures degrade to shape-check-only output.
        debugLog("models", "findings-triage decision call degraded", error);
      }
    }
    return { exitCode: 0, output: lines.join("\n") };
  }
  return { exitCode: 1, error: usage };
}

async function handleSemantic(ctx: CommandContext): Promise<CommandResult> {
  const { args, root, aiw, fs, services } = ctx;
  const usage =
    "Usage: aiw semantic index [--full] | aiw semantic query --text=<query> [--rerank] | aiw semantic judge-context --paths=a.ts,b.ts [--budget=N] | aiw semantic status";
  const action = args[1];
  const semanticConfig = loadSemanticConfig(fs, aiw);
  if (action === "index") {
    if (!semanticConfig?.enabled)
      return {
        exitCode: 1,
        error:
          "Semantic mapping is disabled. Set semantic.enabled=true in .aiw/settings.yml to build an index.",
      };
    const full = args.slice(2).includes("--full");
    const provider = services.embeddingProvider ?? createOllamaEmbeddingProvider(semanticConfig);
    if (!(await provider.available()))
      return {
        exitCode: 1,
        error: `Semantic model ${semanticConfig.model} is not available at ${semanticConfig.baseUrl}.`,
      };
    const indexPath = join(aiw, SEMANTIC_INDEX_PATH);
    let existingIndex: SemanticIndex | undefined;
    if (!full && fs.exists(indexPath)) {
      try {
        existingIndex = parseSemanticIndex(fs.read(indexPath));
      } catch (error) {
        debugLog("models", "existing semantic index unreadable; rebuilding from scratch", error);
      }
    }
    let stats: SemanticIndexBuildStats | undefined;
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
      {
        existingIndex,
        onStats: (recorded) => {
          stats = recorded;
        },
      },
    );
    fs.mkdir(join(aiw, "semantic"));
    fs.write(indexPath, serializeSemanticIndex(index));
    const reused = stats?.reusedChunks ?? 0;
    const embedded = stats?.embeddedChunks ?? index.chunks.length;
    return {
      exitCode: 0,
      output: `Semantic index updated (${semanticConfig.model}): ${index.chunks.length} total chunks (${reused} reused, ${embedded} embedded).`,
    };
  }
  if (action === "status") {
    const config = semanticConfig;
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
  if (action === "judge-context") {
    const parsed = parseNamedOptions(args.slice(2), ["paths", "budget"]);
    if (!parsed?.paths)
      return {
        exitCode: 1,
        error: "Usage: aiw semantic judge-context --paths=a.ts,b.ts [--budget=N]",
      };
    if (!semanticConfig?.enabled)
      return {
        exitCode: 1,
        error:
          "Semantic mapping is disabled. Set semantic.enabled=true in .aiw/settings.yml to use judge context.",
      };
    const config = semanticConfig;
    const indexPath = join(aiw, SEMANTIC_INDEX_PATH);
    if (!fs.exists(indexPath))
      return {
        exitCode: 1,
        error:
          "Semantic index is missing. Run aiw scan to build it before requesting judge context.",
      };
    const provider = services.embeddingProvider ?? createOllamaEmbeddingProvider(config);
    if (!(await provider.available()))
      return {
        exitCode: 1,
        error: `Semantic model ${config.model} is not available at ${config.baseUrl}. Judges fall back to the raw diff (fail-safe).`,
      };
    const paths = parsed.paths
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const budget = Number(parsed.budget ?? 4000);
    if (!Number.isFinite(budget) || budget <= 0)
      return { exitCode: 1, error: "--budget must be a positive number." };
    const chunks: { file: string; excerpt: string }[] = [];
    for (const path of paths) {
      const matches = await querySemanticIndex(
        parseSemanticIndex(fs.read(indexPath)),
        buildCoveringTestQuery(path),
        provider,
        config,
      );
      for (const match of matches) chunks.push({ file: match.file, excerpt: match.excerpt });
    }
    return {
      exitCode: 0,
      output:
        renderJudgeContext("## Changed paths\n" + paths.join("\n"), chunks, budget) +
        "\n(context aids only — retrieval results are never confirmed facts)",
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
    const provider = services.embeddingProvider ?? createOllamaEmbeddingProvider(config);
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
      if (!decisionConfig?.enabled) {
        influence =
          "Advisory: decision model is disabled; returning cosine-similarity order without rerank.";
      } else {
        const decisionProvider =
          services.decisionProvider ?? createOllamaDecisionProvider(decisionConfig);
        try {
          if (!(await decisionProvider.available())) {
            influence = `Advisory: decision model ${decisionConfig.model} is not available at ${decisionConfig.baseUrl}; returning cosine-similarity order without rerank.`;
          } else {
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
        } catch (error) {
          debugLog("models", "semantic rerank degraded to cosine order", error);
          influence = `Advisory: decision rerank failed (${error instanceof Error ? error.message : String(error)}); returning cosine-similarity order.`;
        }
      }
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

export const intelligenceCommands: Record<string, CommandHandler> = {
  scan: handleScan,
  decision: handleDecision,
  semantic: handleSemantic,
};

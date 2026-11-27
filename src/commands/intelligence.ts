import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { applyOverrides, type FactOverride } from "../confirmation.js";
import {
  buildEvidenceTriageRequest,
  buildFindingsTriageRequest,
  buildRecommendationRankingRequest,
  buildSemanticRerankRequest,
  checkFindingShapes,
  createOllamaDecisionProvider,
  loadDecisionConfig,
  parseReviewFindings,
} from "../decision.js";
import { detectDrift } from "../drift.js";
import { generateProjectResources } from "../generator.js";
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
import { parseProjectProfile, profileProject } from "../profile.js";
import {
  rankRecommendations,
  recommendCapabilities,
  serializeRecommendations,
  type RankedRecommendations,
} from "../recommendations.js";
import { scanProject } from "../scanner.js";
import { selectRecommendations } from "../selection.js";
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
  semanticRetrievalAvailable,
  serializeSemanticIndex,
  type RerankedMatch,
} from "../semantic.js";
import { readFactOverrides, saveSettingOverrides } from "../settings.js";
import { extractStandards, parseStandardsIndex, type StandardStatus } from "../standards.js";
import { parseTokenUsage, recordTokenUsage, serializeTokenUsage } from "../token-usage.js";
import type { CommandResult } from "../types.js";
import {
  appendUsageSidecarEntry,
  parseUsageSidecar,
  serializeUsageSidecar,
  USAGE_SIDECAR_PATH,
} from "../usage-sidecar.js";
import { installVercelSkill, nodeCommandExecutor } from "../vercel-skills.js";
import {
  enforceConfiguredOrganizationPolicy,
  formatConfidence,
  formatNoul,
  installationRequired,
  parseApprovedPermissions,
  parseNamedOptions,
  safeProjectFile,
  writeVercelSkillLock,
} from "./shared.js";
import {
  profileSummaryForRanking,
  readSelectedRecommendations,
  syncSelectedResources,
} from "./sync-helpers.js";
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
  const semanticConfig = loadSemanticConfig(fs, aiw);
  if (semanticConfig?.enabled) {
    const provider = services.embeddingProvider ?? createOllamaEmbeddingProvider(semanticConfig);
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
      } catch {
        // Advisory flow: provider failures degrade to shape-check-only output.
      }
    }
    return { exitCode: 0, output: lines.join("\n") };
  }
  return { exitCode: 1, error: usage };
}

async function handleSemantic(ctx: CommandContext): Promise<CommandResult> {
  const { args, aiw, fs, services } = ctx;
  const usage =
    "Usage: aiw semantic query --text=<query> [--rerank] | aiw semantic judge-context --paths=a.ts,b.ts [--budget=N] | aiw semantic status";
  const action = args[1];
  const semanticConfig = loadSemanticConfig(fs, aiw);
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

function handleConfirm(ctx: CommandContext): CommandResult {
  const { args, aiw, fs } = ctx;
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const overrides: FactOverride[] = [];
  const accept = args.indexOf("--accept");
  if (accept >= 0 && args[accept + 1]) overrides.push({ key: args[accept + 1], action: "accept" });
  const reject = args.indexOf("--reject");
  if (reject >= 0 && args[reject + 1]) overrides.push({ key: args[reject + 1], action: "reject" });
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

async function handleRecommend(ctx: CommandContext): Promise<CommandResult> {
  const { args, root, aiw, fs, services } = ctx;
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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
                ...(typeof answer.confidence === "number" ? { confidence: answer.confidence } : {}),
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

async function handleGenerateOrSync(ctx: CommandContext): Promise<CommandResult> {
  const { args, root, aiw, fs, services } = ctx;
  const command = args[0];
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
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
    const result = syncSelectedResources(fs, root, aiw, profile, selected, !previewOnly, approval);
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
    writeVercelSkillLock(fs, root, aiw, "vercel-labs/agent-skills", "vercel-react-best-practices");
  }
  const conflicts: string[] = [];
  generateProjectResources(
    profile,
    selected,
    (path, content) => {
      const destination = join(aiw, path);
      if (fs.exists(destination)) {
        if (detectDrift(content, fs.read(destination))) conflicts.push(path);
        return;
      }
      fs.write(destination, content);
    },
    semanticRetrievalAvailable(fs, aiw),
  );
  return {
    exitCode: conflicts.length ? 1 : 0,
    output: conflicts.length
      ? `Generated resources have manual changes: ${conflicts.join(", ")}`
      : "Project-specific resources generated.",
  };
}

function handleStandards(ctx: CommandContext): CommandResult {
  const { args, root, aiw, fs } = ctx;
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const action = args[1] ?? "list";
  const index = fs.exists(join(aiw, "standards/index.yml"))
    ? parseStandardsIndex(fs.read(join(aiw, "standards/index.yml")))
    : { schema: 1 as const, standards: {} };
  if (action === "extract") {
    fs.mkdir(join(aiw, "standards"));
    const documents = extractStandards(root, fs);
    for (const document of documents) {
      const body = [
        `# Standard: ${document.topic}`,
        "",
        `Status: ${document.status}`,
        "",
        ...document.statements.flatMap((statement) => [
          statement.convention,
          ...(statement.occurrences > 0
            ? statement.evidence.map((evidence) => `- Evidence: ${evidence.path}:${evidence.line}`)
            : ["- Evidence: none (deterministic scan found no instances)"]),
        ]),
        "",
      ].join("\n");
      fs.write(join(aiw, `standards/${document.topic}.md`), body);
      if (index.standards[document.topic] === undefined)
        index.standards[document.topic] = {
          status: "inferred",
          updatedAt: new Date().toISOString(),
        };
    }
    const serialized = [
      "schema: 1",
      "standards:",
      ...Object.entries(index.standards).map(
        ([topic, entry]) =>
          `  ${topic}:\n    status: ${entry.status}\n    updatedAt: ${entry.updatedAt}`,
      ),
      "",
    ].join("\n");
    fs.write(join(aiw, "standards/index.yml"), serialized);
    const names = documents.map((document) => document.topic).join(", ");
    return {
      exitCode: 0,
      output: `Standards extracted (${names}). All are inferred — review them, then confirm with \`aiw standards confirm <topic>\`. Rejected or confirmed standards never change until you say so.`,
    };
  }
  if (action === "list") {
    const entries = Object.entries(index.standards);
    if (entries.length === 0)
      return {
        exitCode: 0,
        output: "No standards recorded. Run `aiw standards extract` first.",
      };
    return {
      exitCode: 0,
      output: [
        "Standards:",
        ...entries.map(([topic, entry]) => `- ${topic}: ${entry.status}`),
        "Confirm or reject with `aiw standards confirm|reject <topic>`.",
      ].join("\n"),
    };
  }
  if (action === "confirm" || action === "reject") {
    const topic = args[2];
    if (!topic) return { exitCode: 1, error: `Usage: aiw standards ${action} <topic>` };
    const path = join(aiw, `standards/${topic}.md`);
    if (!fs.exists(path))
      return {
        exitCode: 1,
        error: `No standard document for ${topic}; run \`aiw standards extract\` first.`,
      };
    const status: StandardStatus = action === "confirm" ? "confirmed" : "rejected";
    index.standards[topic] = { status, updatedAt: new Date().toISOString() };
    const existing = fs.read(path).replace(/^Status: .*$/m, `Status: ${status}`);
    fs.write(path, existing);
    const serialized = [
      "schema: 1",
      "standards:",
      ...Object.entries(index.standards).map(
        ([topicEntry, entry]) =>
          `  ${topicEntry}:\n    status: ${entry.status}\n    updatedAt: ${entry.updatedAt}`,
      ),
      "",
    ].join("\n");
    fs.write(join(aiw, "standards/index.yml"), serialized);
    return {
      exitCode: 0,
      output: `Standard ${topic} ${status}. ${
        status === "confirmed"
          ? "Confirmed standards are referenced by generated rules."
          : "Rejected standards are never rendered."
      }`,
    };
  }
  return {
    exitCode: 1,
    error:
      "Usage: aiw standards <extract|list|confirm|reject> [topic] — standards are inferred until a human confirms them.",
  };
}

export const intelligenceCommands: Record<string, CommandHandler> = {
  scan: handleScan,
  decision: handleDecision,
  semantic: handleSemantic,
  confirm: handleConfirm,
  recommend: handleRecommend,
  generate: handleGenerateOrSync,
  sync: handleGenerateOrSync,
  standards: handleStandards,
};

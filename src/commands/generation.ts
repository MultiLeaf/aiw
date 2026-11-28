import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { FactOverride } from "../confirmation.js";
import {
  buildRecommendationRankingRequest,
  createOllamaDecisionProvider,
  loadDecisionConfig,
} from "../decision.js";
import { detectDrift } from "../drift.js";
import { generateProjectResources } from "../generator.js";
import { parseProjectProfile, profileProject } from "../profile.js";
import {
  rankRecommendations,
  recommendCapabilities,
  serializeRecommendations,
  type RankedRecommendations,
} from "../recommendations.js";
import { selectRecommendations } from "../selection.js";
import { semanticRetrievalAvailable } from "../semantic.js";
import { saveSettingOverrides } from "../settings.js";
import { extractStandards, parseStandardsIndex, type StandardStatus } from "../standards.js";
import { parseTokenUsage, recordTokenUsage, serializeTokenUsage } from "../token-usage.js";
import type { CommandResult } from "../types.js";
import { installVercelSkill, nodeCommandExecutor } from "../vercel-skills.js";
import {
  enforceConfiguredOrganizationPolicy,
  installationRequired,
  parseApprovedPermissions,
  writeVercelSkillLock,
} from "./shared.js";
import {
  profileSummaryForRanking,
  readSelectedRecommendations,
  syncSelectedResources,
} from "./sync-helpers.js";
import type { CommandContext, CommandHandler } from "./types.js";

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

export const generationCommands: Record<string, CommandHandler> = {
  confirm: handleConfirm,
  recommend: handleRecommend,
  generate: handleGenerateOrSync,
  sync: handleGenerateOrSync,
  standards: handleStandards,
};

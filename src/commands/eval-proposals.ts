import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { detectTarget } from "../adapter.js";
import { loadBundledResources } from "../bundled-resources.js";
import { renderBrief } from "../eval/brief.js";
import { validateGeneratedResources } from "../eval/generated.js";
import { collectGitSummary } from "../eval/git.js";
import {
  approveProposal,
  compactProposalStore,
  createEmptyStore,
  draftSignatureHash,
  parseProposalStore,
  recordOccurrence,
  rejectProposal,
  serializeProposalStore,
  suppressProposal,
} from "../eval/proposals.js";
import {
  defaultShellRunner,
  isHarnessAvailable,
  parseScenarioRegistry,
  runScenarios,
  serializeScenarioResults,
} from "../eval/scenarios.js";
import { collectSignals, parseEvidenceBundle, serializeEvidenceBundle } from "../eval/signals.js";
import { PROPOSAL_KINDS, type ProposalStore } from "../eval/types.js";
import { parseDrafts, validateDrafts } from "../eval/validate.js";
import { generateProposalResource } from "../generator.js";
import { parseApprovalLedger } from "../human-approval.js";
import {
  clusterRejections,
  formatRulesCandidates,
  loadRulesCandidates,
  saveRulesCandidates,
  setCandidateStatus,
  type RejectionOccurrence,
} from "../rules-candidates.js";
import { scanProject } from "../scanner.js";
import type { CommandResult } from "../types.js";
import { installationRequired, parseNamedOptions } from "./shared.js";
import type { CommandContext, CommandHandler } from "./types.js";

function handleRulesCandidates({ args, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const acceptArg = args.find((argument) => argument.startsWith("--accept="));
  const dismissArg = args.find((argument) => argument.startsWith("--dismiss="));
  if (acceptArg && dismissArg)
    return {
      exitCode: 1,
      error: "Usage: aiw rules-candidates [--accept=id | --dismiss=id]",
    };
  if (acceptArg || dismissArg) {
    const candidates = loadRulesCandidates(fs, aiw);
    try {
      const updated = setCandidateStatus(
        candidates,
        (acceptArg ?? dismissArg)!.slice(acceptArg ? 9 : 10),
        acceptArg ? "accepted" : "dismissed",
      );
      saveRulesCandidates(fs, aiw, updated);
    } catch (error) {
      return { exitCode: 1, error: (error as Error).message };
    }
    const id = (acceptArg ?? dismissArg)!.slice(acceptArg ? 9 : 10);
    if (acceptArg)
      return {
        exitCode: 0,
        output: `Candidate ${id} accepted. Create the rule or skill file it describes and commit it manually (agents never commit rule files), then share it with the team for review.`,
      };
    return {
      exitCode: 0,
      output: `Candidate ${id} dismissed; it will not be re-proposed. Rejection history is preserved in the ledger.`,
    };
  }
  // Scan the active ledger plus archived workflow ledgers for rejection reasons.
  const occurrences: RejectionOccurrence[] = [];
  const considerLedger = (content: string): void => {
    const ledger = parseApprovalLedger(content);
    for (const [stage, record] of Object.entries(ledger.stages)) {
      for (const reason of record.rejectionReasons ?? [])
        occurrences.push({
          workflowId: ledger.workflowId,
          stage,
          reason,
          date: record.updatedAt,
        });
    }
  };
  if (fs.exists(join(aiw, "approvals.yml"))) considerLedger(fs.read(join(aiw, "approvals.yml")));
  const checkpointsDir = join(aiw, "checkpoints");
  if (fs.exists(checkpointsDir) && fs.list)
    for (const name of fs.list(checkpointsDir) ?? [])
      if (name.startsWith("workflow-") && name.endsWith("-approvals.yml"))
        considerLedger(fs.read(join(checkpointsDir, name)));
  const prior = loadRulesCandidates(fs, aiw);
  const clustered = clusterRejections(occurrences, prior);
  // AIW-002 REQ-005: manual entries (ids not derived from the current
  // clusters) survive the rescan unchanged.
  const candidates = [
    ...clustered,
    ...prior.filter((entry) => !clustered.some((candidate) => candidate.id === entry.id)),
  ];
  const path = saveRulesCandidates(fs, aiw, candidates);
  return {
    exitCode: 0,
    output: `${formatRulesCandidates(candidates)}\nSaved to ${path}. Candidates never activate on their own: accept one with aiw rules-candidates --accept=<id>, then create and commit the rule/skill file manually.`,
  };
}

async function handleEval({ args, root, aiw, fs }: CommandContext): Promise<CommandResult> {
  const usage =
    "Usage: aiw eval run --scenarios [--registry=dir] [--harness=id] [--filter=id] [--advisory]";
  if (args[1] !== "run" || !args.includes("--scenarios")) return { exitCode: 1, error: usage };
  const options = parseNamedOptions(
    args.slice(2).filter((arg) => arg !== "--scenarios" && arg !== "--advisory"),
    ["registry", "harness", "filter"],
  );
  if (options === undefined) return { exitCode: 1, error: usage };
  const advisory = args.includes("--advisory");
  const registryDir = options.registry
    ? resolve(root, options.registry)
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../resources/evals/scenarios");
  if (!fs.exists(registryDir))
    return { exitCode: 1, error: `Scenario registry not found: ${registryDir}` };
  const files = (fs.list?.(registryDir) ?? []).filter((name) => name.endsWith(".yml")).sort();
  let scenarios;
  try {
    scenarios = parseScenarioRegistry(
      files.map((name) => ({
        path: name,
        content: fs.read(join(registryDir, name)),
      })),
    );
  } catch (error) {
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
  if (options.harness) scenarios = scenarios.filter(({ harness }) => harness === options.harness);
  if (options.filter)
    scenarios = scenarios.filter(
      ({ id, family }) => id.includes(options.filter) || family.includes(options.filter),
    );
  if (scenarios.length === 0)
    return { exitCode: 0, output: "No scenarios matched; nothing to run.\n" };
  const budgetsPath = join(aiw, "budgets.yml");
  let poolTokenCeiling: number | undefined;
  if (fs.exists(budgetsPath)) {
    const budgets = parseYaml(fs.read(budgetsPath)) as Record<string, unknown> | null;
    const evals = budgets?.evals as Record<string, unknown> | undefined;
    const ceiling = Number(evals?.tokenCeiling);
    if (Number.isFinite(ceiling) && ceiling > 0) poolTokenCeiling = ceiling;
  }
  const report = await runScenarios({
    scenarios,
    runShell: defaultShellRunner,
    isAvailable: (harness) => isHarnessAvailable(harness),
    poolTokenCeiling,
  });
  const resultsPath = join(aiw, "generated", "evals", "scenario-results.yml");
  fs.write(resultsPath, serializeScenarioResults(report));
  const lines = report.results.map(
    (result) =>
      `${result.scenario}: ${result.status}${result.usage ? ` (tokens in ${result.usage.tokensIn}, out ${result.usage.tokensOut})` : ""} — ${result.detail}`,
  );
  if (report.missingHarnesses.length)
    lines.push(
      `skipped for missing harness CLIs: ${report.missingHarnesses.join(", ")} — install them to run those scenarios`,
    );
  lines.push(`results written to ${relative(root, resultsPath)}`);
  const blocking = report.results.filter(
    ({ status }) => status === "failed" || status.startsWith("aborted-"),
  ).length;
  const exitCode = blocking > 0 && !advisory ? 1 : 0;
  return {
    exitCode,
    output: `${lines.join("\n")}\n${advisory && blocking > 0 ? `${blocking} scenario(s) failed (advisory mode: exit 0).\n` : ""}`,
  };
}

async function handleEvaluate({ root, aiw, fs, services }: CommandContext): Promise<CommandResult> {
  const scanFiles = await (services.scanner?.scan(root) ?? scanProject(root));
  const gitSummary = await collectGitSummary(root, services.runShell ?? defaultShellRunner);
  const bundle = collectSignals(scanFiles.files, gitSummary, (path) =>
    fs.exists(join(root, path)) ? fs.read(join(root, path)) : "",
  );
  const evalDir = join(aiw, "eval");
  const signalsPath = join(evalDir, "signals.yml");
  const briefPath = join(evalDir, "brief.md");
  const draftsPath = join(evalDir, "proposals-draft.yml");
  // A4: drafts written against a previous signal set must not survive a
  // re-evaluation; the skill re-drafts from the fresh brief.
  if (fs.exists(draftsPath)) fs.remove?.(draftsPath);
  fs.write(signalsPath, serializeEvidenceBundle(bundle));
  fs.write(briefPath, renderBrief(bundle));
  return {
    exitCode: 0,
    output: `signals written to ${relative(root, signalsPath)}\nhand off ${relative(root, briefPath)} to the resource-evaluator skill\n`,
  };
}

function handleProposals({ args, root, aiw, fs }: CommandContext): CommandResult {
  const usage =
    "Usage: aiw proposals <import|list|show|approve|reject|suppress|validate> [--id=id] [--reason=text]";
  const action = args[1];
  const storePath = join(aiw, "proposals.yml");
  const loadStore = (): ProposalStore => {
    if (!fs.exists(storePath))
      throw new Error("No proposals store found; run `aiw proposals import` first.");
    return parseProposalStore(fs.read(storePath));
  };
  if (action === "import") {
    const signalsPath = join(aiw, "eval", "signals.yml");
    const draftsPath = join(aiw, "eval", "proposals-draft.yml");
    if (!fs.exists(signalsPath) || !fs.exists(draftsPath))
      return {
        exitCode: 1,
        error: "Run `aiw evaluate` and the resource-evaluator skill first.",
      };
    const bundle = parseEvidenceBundle(fs.read(signalsPath));
    let drafts;
    try {
      drafts = parseDrafts(fs.read(draftsPath));
    } catch (error) {
      return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
    }
    const target = detectTarget(root, fs) || "codex";
    const catalogIds = loadBundledResources(target).map(({ type, id }) => `${type}/${id}`);
    const validation = validateDrafts(drafts, bundle, catalogIds);
    if (validation.errors.length)
      return {
        exitCode: 1,
        error: `${validation.errors.length} draft record(s) failed the contract:\n${validation.errors
          .map(({ record, reason }) => `- ${record}: ${reason.join("; ")}`)
          .join("\n")}`,
      };
    const store = fs.exists(storePath)
      ? parseProposalStore(fs.read(storePath))
      : createEmptyStore();
    const isUnchanged = (record: (typeof validation.records)[number]): boolean => {
      const hash = draftSignatureHash(record);
      const existing = store.proposals.find(
        (candidate) => candidate.signature === record.signature,
      );
      return existing?.draftHash === hash;
    };
    const changed = validation.records.filter((record) => !isUnchanged(record));
    for (const record of validation.records) {
      if (isUnchanged(record)) continue;
      recordOccurrence(store, {
        kind: record.kind as (typeof PROPOSAL_KINDS)[number],
        signature: record.signature,
        origin: "onboarding",
      });
      const proposal = store.proposals.find(
        (candidate) => candidate.signature === record.signature,
      );
      if (proposal) {
        proposal.title = record.title;
        proposal.outline = record.outline;
        proposal.evidence = record.evidence;
        proposal.kind = record.kind as (typeof PROPOSAL_KINDS)[number];
        proposal.draftHash = draftSignatureHash(record);
      }
    }
    if (changed.length === 0)
      return {
        exitCode: 0,
        output: `no proposals to import${
          fs.exists(storePath)
            ? " — drafts unchanged since the last import"
            : " — the evaluator proposed nothing for this project"
        }\n`,
      };
    fs.write(storePath, serializeProposalStore(store));
    const overlapNote = validation.overlaps.length
      ? `\noverlaps annotated for review: ${validation.overlaps
          .map(({ signature, catalogId }) => `${signature} ~ ${catalogId}`)
          .join(", ")}`
      : "";
    return {
      exitCode: 0,
      output: `imported ${changed.length} proposal(s) into ${relative(root, storePath)}${overlapNote}\n`,
    };
  }
  if (action === "list") {
    const store = loadStore();
    if (store.proposals.length === 0) return { exitCode: 0, output: "No proposals recorded.\n" };
    const lines = store.proposals.map(
      (proposal) =>
        `${proposal.id} [${proposal.kind}] ${proposal.status} (${proposal.occurrences} occurrences) ${proposal.title || proposal.signature}`,
    );
    return { exitCode: 0, output: `${lines.join("\n")}\n` };
  }
  if (action === "validate") {
    const generatedRoot = join(aiw, "generated");
    const files: { path: string; content: string }[] = [];
    for (const kind of PROPOSAL_KINDS) {
      const dir = join(generatedRoot, `${kind}s`);
      if (!fs.exists(dir)) continue;
      for (const name of (fs.listFiles?.(dir) ?? fs.list?.(dir) ?? []).sort())
        if (name.endsWith(".md"))
          files.push({ path: `${kind}s/${name}`, content: fs.read(join(dir, name)) });
    }
    if (files.length === 0) return { exitCode: 0, output: "No generated resources to validate.\n" };
    if (!fs.exists(storePath))
      return {
        exitCode: 1,
        error: `Generated resources exist but no proposals store was found at ${relative(root, storePath)}.`,
      };
    const issues = validateGeneratedResources(files, loadStore());
    if (issues.length)
      return {
        exitCode: 1,
        error: `${issues.length} generated resource(s) failed validation:\n${issues
          .map(({ path, reason }) => `- ${path}: ${reason}`)
          .join("\n")}`,
      };
    return {
      exitCode: 0,
      output: `valid: ${files.length} generated resource(s) pass the evaluator contract.\n`,
    };
  }
  const options = parseNamedOptions(args.slice(2), ["id", "reason"]);
  if (options === undefined) return { exitCode: 1, error: usage };
  const id = options.id;
  if (action === "show") {
    if (!id) return { exitCode: 1, error: usage };
    const proposal = loadStore().proposals.find((candidate) => candidate.id === id);
    if (!proposal) return { exitCode: 1, error: `Unknown proposal id: ${id}` };
    return {
      exitCode: 0,
      output:
        [
          `${proposal.id} [${proposal.kind}] ${proposal.status}`,
          `title: ${proposal.title}`,
          `outline: ${proposal.outline}`,
          `evidence: ${proposal.evidence.join(", ")}`,
          `occurrences: ${proposal.occurrences}`,
          `reject_reason: ${proposal.rejectReason ?? "-"}`,
        ].join("\n") + "\n",
    };
  }
  if (!id) return { exitCode: 1, error: usage };
  if (action === "approve" || action === "reject" || action === "suppress") {
    const store = loadStore();
    if (action === "reject") {
      if (!options.reason)
        return { exitCode: 1, error: "--reason is required when rejecting a proposal." };
      rejectProposal(store, id, options.reason);
    } else if (action === "approve") {
      approveProposal(store, id);
      const approved = store.proposals.find((candidate) => candidate.id === id);
      if (approved && approved.title && approved.outline) {
        generateProposalResource(approved, (path, content) => fs.write(join(aiw, path), content));
      }
    } else suppressProposal(store, id);
    compactProposalStore(store);
    fs.write(storePath, serializeProposalStore(store));
    return { exitCode: 0, output: `${action} recorded for ${id}\n` };
  }
  return { exitCode: 1, error: usage };
}

export const evalProposalsCommands: Record<string, CommandHandler> = {
  "rules-candidates": handleRulesCandidates,
  eval: handleEval,
  evaluate: handleEvaluate,
  proposals: handleProposals,
};

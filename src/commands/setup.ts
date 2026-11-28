import { join, relative, resolve, sep } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  detectTarget,
  isTarget,
  normalizeTarget,
  renderAiInit,
  renderAiInitPath,
} from "../adapter.js";
import { describeBlockingReason, formatBlockingOutput } from "../blocking-reasons.js";
import { BASE_DIRECTORIES, WORKFLOW_DIRECTORY } from "../constants.js";
import { debugLog } from "../debug.js";
import { assertSafeProjectPath, writeProjectFilesAtomically } from "../files.js";
import {
  detectStageListDrift,
  parseApprovalLedgerLenient,
  parseWorkflowSession,
  recordDriftSkip,
  serializeApprovalLedger,
  stageDefinition,
  type StageListDrift,
} from "../human-approval.js";
import { detectLegacyState } from "../legacy-migration.js";
import { parseManifest } from "../manifest.js";
import { configureOptionalModels } from "../model-onboarding.js";
import { listManagedWorktrees } from "../orchestration.js";
import {
  createOwnedFile,
  parseOwnership,
  serializeOwnership,
  type OwnershipMetadata,
} from "../ownership.js";
import { checksumPackage } from "../package-integrity.js";
import { parsePrivateRegistries, parseTeamPreset } from "../team-configuration.js";
import {
  loadTelemetryConfig,
  maybeOfferTelemetryConsent,
  offerTelemetryConsent,
  parseTelemetryConfig,
} from "../telemetry.js";
import type { CommandResult } from "../types.js";
import { EMPTY_LOCKFILE } from "./shared.js";
import type { CommandContext, CommandHandler } from "./types.js";
import { readWorkflowState, workflowNextAction } from "./workflow-state.js";

async function handleInstall({ args, root, aiw, fs }: CommandContext): Promise<CommandResult> {
  const flag = args.indexOf("--target");
  const positionalTarget = flag < 0 && args[1] && !args[1].startsWith("-") ? args[1] : undefined;
  const rawRequestedTarget = flag >= 0 ? args[flag + 1] : positionalTarget;
  const requestedTarget = rawRequestedTarget ? normalizeTarget(rawRequestedTarget) : undefined;
  const target = requestedTarget || detectTarget(root, fs) || "codex";
  if (!isTarget(target)) throw new Error(`Unsupported target: ${target}`);
  const manifestPath = join(aiw, "manifest.yml");
  assertSafeProjectPath(fs, root, manifestPath);
  if (fs.pathType?.(manifestPath) === "file") {
    const manifest = fs.read(manifestPath);
    const active = manifest.match(/^\s*active:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
    const legacyHint = detectLegacyState(aiw, fs)
      ? "\nLegacy pre-ownership state detected. Run `aiw migrate --dry-run` to review, then `aiw migrate` to upgrade to the current state layout."
      : "";
    let optionalModels: string[] = [];
    let telemetryEnabled: boolean | undefined;
    const shouldConfigureModels =
      args.includes("--configure-models") || !fs.exists(join(aiw, "settings.yml"));
    if (stdin.isTTY && shouldConfigureModels) {
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
        `AI Workflow is already installed for target: ${active}. Existing state preserved.${legacyHint}` +
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
  inspectDesiredFile(join(aiw, "lock.yml"), EMPTY_LOCKFILE);
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

function handleStatus({ aiw, fs }: CommandContext): CommandResult {
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

async function handleDoctor({ args, root, aiw, fs }: CommandContext): Promise<CommandResult> {
  const fixRequested = args.includes("--fix");
  if (fixRequested && args.length > 2) return { exitCode: 1, error: "Usage: aiw doctor [--fix]" };
  const required = ["manifest.yml", "profile.yml", "lock.yml", "ownership.yml"];
  const missing = required.filter((file) => !fs.exists(join(aiw, file)));
  if (missing.length) {
    if (detectLegacyState(aiw, fs))
      return {
        exitCode: 1,
        error:
          formatBlockingOutput(
            describeBlockingReason("migration_required", {
              detail: "Legacy pre-ownership state detected; review the migration plan first.",
            }),
          ) + "\nNext: run `aiw migrate --dry-run`, then `aiw migrate`.",
      };
    return { exitCode: 1, error: `Missing AI Workflow files: ${missing.join(", ")}` };
  }
  const leakedWorktrees = listManagedWorktrees(root, aiw);
  if (leakedWorktrees.length > 0)
    return {
      exitCode: 1,
      error: formatBlockingOutput(
        describeBlockingReason("worktrees_leaked", {
          detail: `${leakedWorktrees.length} managed orchestration worktree(s) leaked: ${leakedWorktrees.join(", ")}`,
        }),
      ),
    };
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
  // AIW-001 (REQ-001): diagnose stage-list drift in the active workflow.
  if (fs.exists(join(aiw, "workflow.yml"))) {
    const session = parseWorkflowSession(fs.read(join(aiw, "workflow.yml")));
    if (session.status === "active" && fs.exists(join(aiw, "approvals.yml"))) {
      let drift: StageListDrift[];
      try {
        drift = detectStageListDrift(
          parseApprovalLedgerLenient(fs.read(join(aiw, "approvals.yml"))),
        );
      } catch (error) {
        return {
          exitCode: 1,
          error: `Approval ledger is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (drift.length > 0) {
        const lines = drift.map(
          (entry) =>
            `- ${entry.stage} is decided but its prerequisites are unresolved: ${entry.unresolvedPrerequisites.join(", ")}`,
        );
        // AIW-001 (REQ-002): the fix records skips for optional prerequisites only.
        const blockedRequired = [
          ...new Set(
            drift.flatMap((entry) =>
              entry.unresolvedPrerequisites.filter(
                (prerequisite) => !stageDefinition(prerequisite).optional,
              ),
            ),
          ),
        ];
        if (fixRequested) {
          if (blockedRequired.length > 0)
            return {
              exitCode: 1,
              error: `aiw doctor --fix cannot skip required stage(s): ${blockedRequired.join(", ")}. Run them with the normal stage commands; only optional prerequisites can be repaired with a recorded skip.`,
            };
          let ledger = parseApprovalLedgerLenient(fs.read(join(aiw, "approvals.yml")));
          const repaired: string[] = [];
          for (const entry of drift)
            for (const prerequisite of entry.unresolvedPrerequisites) {
              if (ledger.stages[prerequisite]) continue; // never overwrite an existing record
              ledger = recordDriftSkip(
                ledger,
                prerequisite,
                `Stage introduced after ${entry.stage} was decided (process list drift); recorded by aiw doctor --fix`,
                new Date().toISOString(),
              );
              repaired.push(prerequisite);
            }
          fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(ledger));
          const remaining = detectStageListDrift(ledger);
          if (remaining.length > 0)
            return {
              exitCode: 1,
              error: `Repair left drift unresolved: ${remaining
                .map((entry) => `${entry.stage} (${entry.unresolvedPrerequisites.join(", ")})`)
                .join("; ")}`,
            };
          return {
            exitCode: 0,
            output: `Stage-list drift repaired: recorded skips for ${repaired.join(", ")}. No decided stage was modified and no approval was invented.`,
          };
        }
        return {
          exitCode: 1,
          error: `Stage-list drift detected (the workflow was started with an older process stage list):\n${lines.join("\n")}\nNext: ${blockedRequired.length === 0 ? "run `aiw doctor --fix` to record the missing prerequisite skips, or record them yourself with `aiw skip <stage> --reason=...`" : `at least one unresolved prerequisite is a required stage (${blockedRequired.join(", ")}); run it with the normal stage commands (it cannot be auto-skipped)`}`,
        };
      }
    }
  }
  // FRIC-004: interactive doctor offers telemetry consent once when unset.
  let telemetryNote = "";
  if (stdin.isTTY) {
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      const consent = await maybeOfferTelemetryConsent(fs, aiw, true, (question) =>
        terminal.question(question),
      );
      if (consent.prompted)
        telemetryNote = consent.enabled
          ? "\nTelemetry enabled. Disable anytime with `aiw telemetry disable`."
          : "\nTelemetry remains disabled. Enable anytime with `aiw telemetry enable`.";
    } finally {
      terminal.close();
    }
  }
  return { exitCode: 0, output: `AI Workflow health check passed.${telemetryNote}` };
}

function handleRepair({ root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml")))
    return { exitCode: 1, error: "AI Workflow is not installed." };
  BASE_DIRECTORIES.forEach((dir) => fs.mkdir(join(aiw, dir)));
  if (!fs.exists(join(root, ".context/adrs/INDEX.md")))
    fs.write(join(root, ".context/adrs/INDEX.md"), "# Architecture Decision Records\n\n");
  return { exitCode: 0, output: "AI Workflow state repaired." };
}

function handleUninstall({ args, root, aiw, fs }: CommandContext): CommandResult {
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
    } catch (error) {
      debugLog("setup", `uninstall ownership check failed for ${file.path}`, error);
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

export const setupCommands: Record<string, CommandHandler> = {
  install: handleInstall,
  status: handleStatus,
  doctor: handleDoctor,
  repair: handleRepair,
  uninstall: handleUninstall,
};

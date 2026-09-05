import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { BASE_DIRECTORIES, WORKFLOW_DIRECTORY } from "./constants.js";
import { detectTarget, generateAiInit, isTarget, renderAiInitPath } from "./adapter.js";
import { parseProjectProfile, profileProject } from "./profile.js";
import type { CommandResult, FileSystem } from "./types.js";
import { serializeOverrides, type FactOverride } from "./confirmation.js";
import { applyOverrides, parseOverrides } from "./confirmation.js";
import { mergeFacts } from "./intelligence.js";
import { createInterpretationRequest } from "./interpreter.js";
import { recommendCapabilities, serializeRecommendations } from "./recommendations.js";
import { selectRecommendations } from "./selection.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { generateProjectResources } from "./generator.js";
import { detectDrift } from "./drift.js";
import { parseManifest } from "./manifest.js";
import type { WorkflowDependencies } from "./services.js";
import { validatePackageContract } from "./package-contract.js";
import { parseLock, resolvePackage, serializeLock } from "./lockfile.js";
import { executeVercelSkills, installVercelSkill, nodeCommandExecutor } from "./vercel-skills.js";
import { scanProject } from "./scanner.js";
import {
  assertKnownPermissions,
  assertPackagePermissions,
  serializePermissionReview,
} from "./package-audit.js";
import { planPackageUpdate } from "./package-updates.js";
import { searchRegistry, serializeRegistry, type RegistryPackage } from "./registry.js";
import { checksumPackage, verifyPackageProvenance } from "./package-integrity.js";
import { nodePackageSourceLoader, resolveProvider } from "./providers.js";
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
import { parseTokenUsage, recordTokenUsage, serializeTokenUsage } from "./token-usage.js";
import { measureContextQuality, serializeContextQuality } from "./context-quality.js";
import { serializeAdapterCapabilities } from "./adapter-contract.js";
import { buildTraceabilityGraph, serializeTraceabilityGraph } from "./traceability.js";
import { evaluateQualityGate, type QualityGateStage } from "./quality-gates.js";
import {
  parseMigrationSnapshots,
  planNeutralResourceMigration,
  readResourceBytes,
  serializeMigrationPreview,
  serializeMigrationSnapshots,
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
  parseTelemetryConfig,
  serializeTelemetryConfig,
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

export async function runCommand(
  args: string[],
  root: string,
  fs: FileSystem,
  services: WorkflowServices = {},
): Promise<CommandResult> {
  const aiw = join(root, WORKFLOW_DIRECTORY);
  try {
    const command = args[0] ?? "help";
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
      if (fs.exists(join(aiw, "manifest.yml"))) {
        const manifest = fs.read(join(aiw, "manifest.yml"));
        const active = manifest.match(/^\s*active:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
        return {
          exitCode: 0,
          output: `AI Workflow is already installed for target: ${active}. Existing state preserved.`,
        };
      }
      fs.mkdir(aiw);
      BASE_DIRECTORIES.forEach((dir) => fs.mkdir(join(aiw, dir)));
      fs.mkdir(join(root, ".context/adrs"));
      fs.write(join(root, ".context/adrs/INDEX.md"), "# Architecture Decision Records\n\n");
      fs.write(
        join(aiw, "manifest.yml"),
        `schema: 1\nproject:\n  name: ${root.split("/").pop()}\ntarget:\n  active: ${target}\npolicies:\n  artifact_language: en\n`,
      );
      fs.write(join(aiw, "profile.yml"), "schema: 1\nstatus: pending-scan\n");
      fs.write(join(aiw, "lock.yml"), "schema: 1\npackages:\n");
      generateAiInit(root, target, fs);
      return { exitCode: 0, output: `AI Workflow installed for target: ${target}` };
    }
    if (command === "telemetry") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const usage =
        "Usage: aiw telemetry <status|enable|disable> [--commands=include|exclude] [--outcomes=include|exclude]";
      const action = args[1];
      if (!action) return { exitCode: 1, error: usage };
      const path = join(aiw, "telemetry.yml");
      if (action === "status") {
        if (args.length !== 2) return { exitCode: 1, error: usage };
        const config = fs.exists(path)
          ? parseTelemetryConfig(fs.read(path))
          : DEFAULT_TELEMETRY_CONFIG;
        return {
          exitCode: 0,
          output: `Telemetry is ${config.enabled ? "enabled" : "disabled"}. Command collection: ${config.includeCommand ? "included" : "excluded"}. Outcome collection: ${config.includeOutcome ? "included" : "excluded"}.`,
        };
      }
      if (action === "disable") {
        if (args.length !== 2) return { exitCode: 1, error: usage };
        fs.write(path, serializeTelemetryConfig({ ...DEFAULT_TELEMETRY_CONFIG }));
        return { exitCode: 0, output: "Telemetry disabled." };
      }
      if (action === "enable") {
        const options = args.slice(2);
        if (
          options.some((option) => !/^--(?:commands|outcomes)=(?:include|exclude)$/.test(option)) ||
          new Set(options.map((option) => option.slice(0, option.indexOf("=")))).size !==
            options.length
        )
          return { exitCode: 1, error: usage };
        const privacyValue = (name: string): boolean => !options.includes(`--${name}=exclude`);
        fs.write(
          path,
          serializeTelemetryConfig({
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
    if (command === "scan") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const profile = await (services.profiler?.profile(root) ?? profileProject(root));
      if (services.interpreter) {
        const scan = await (services.scanner?.scan(root) ?? scanProject(root));
        const inferred = await services.interpreter.interpret(
          createInterpretationRequest(profile, scan.files),
        );
        profile.facts = mergeFacts(profile.facts, inferred);
      }
      const overrides = fs.exists(join(aiw, "overrides.yml"))
        ? parseOverrides(fs.read(join(aiw, "overrides.yml")))
        : [];
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
        `schema: 1\nstatus: scanned\nfacts:\n${evidence}\nruntime:\n  languages: [${profile.runtime.languages.join(", ")}]\nframeworks: [${profile.frameworks.join(", ")}]\npackage_manager: ${profile.packageManager}\nquality:\n  linter: ${profile.quality.linter?.name ?? "unknown"}\n  linter_command: ${profile.quality.linter?.command ?? "unknown"}\n  formatter: ${profile.quality.formatter?.name ?? "unknown"}\n  formatter_command: ${profile.quality.formatter?.command ?? "unknown"}\n  typecheck: ${profile.quality.typecheck?.name ?? "unknown"}\n  typecheck_command: ${profile.quality.typecheck?.command ?? "unknown"}\ntesting: ${profile.testing?.name ?? "unknown"}\ntesting_command: ${profile.testing?.command ?? "unknown"}\nci: [${profile.ci.join(", ")}]\nworkspaces: [${profile.workspaces.join(", ")}]\npolicies:\n  artifact_language: en\n`,
      );
      return { exitCode: 0, output: "Project profile generated." };
    }
    if (command === "target") {
      const target = args[1];
      if (!target) return { exitCode: 1, error: "Usage: aiw target <target>" };
      if (!isTarget(target)) return { exitCode: 1, error: `Unsupported target: ${target}` };
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const dryRun = args.includes("--dry-run");
      const targetPath = join(root, renderAiInitPath(target));
      const neutralAiInit = join(aiw, "resources/skills/ai-init.md");
      const manifestPath = join(aiw, "manifest.yml");
      const previousTarget =
        fs
          .read(manifestPath)
          .match(/^\s*active:\s*(.+)$/m)?.[1]
          ?.trim() ?? "universal";
      const previousTargetPath = isTarget(previousTarget)
        ? join(root, renderAiInitPath(previousTarget))
        : undefined;
      const universalConflict =
        target === "universal" &&
        previousTargetPath !== undefined &&
        fs.exists(previousTargetPath) &&
        fs.exists(neutralAiInit) &&
        fs.read(previousTargetPath) !== fs.read(neutralAiInit);
      const resourceMigrations = planNeutralResourceMigration(
        join(aiw, "resources"),
        fs.exists(join(aiw, "resources")) ? (fs.listFiles?.(join(aiw, "resources")) ?? []) : [],
        target,
      );
      const resourceConflicts = resourceMigrations.filter(({ source, destination }) => {
        const absoluteDestination = join(root, destination);
        return (
          source !== absoluteDestination &&
          fs.exists(absoluteDestination) &&
          Buffer.compare(
            Buffer.from(readResourceBytes(fs, source)),
            Buffer.from(readResourceBytes(fs, absoluteDestination)),
          ) !== 0
        );
      });
      if (dryRun) {
        const existing = resourceMigrations
          .filter(({ destination }) => fs.exists(join(root, destination)))
          .map(({ destination }) => destination);
        const conflictPaths = resourceConflicts.map(({ destination }) => destination);
        if (universalConflict) conflictPaths.push(renderAiInitPath(target));
        return {
          exitCode: 0,
          output: `${serializeMigrationPreview(target, resourceMigrations, existing)}${conflictPaths.map((path) => `conflict: ${path}\n`).join("")}`,
        };
      }
      if (
        universalConflict ||
        (target !== "universal" &&
          fs.exists(neutralAiInit) &&
          fs.exists(targetPath) &&
          fs.read(neutralAiInit) !== fs.read(targetPath)) ||
        resourceConflicts.length > 0
      )
        return {
          exitCode: 1,
          error: `Migration conflict at ${resourceConflicts[0] ? join(root, resourceConflicts[0].destination) : targetPath}. Use --dry-run to inspect.`,
        };
      const removePrevious =
        previousTarget !== "universal" &&
        previousTargetPath !== undefined &&
        previousTargetPath !== targetPath &&
        fs.exists(previousTargetPath);
      if (removePrevious && !fs.remove)
        return { exitCode: 1, error: "Filesystem cannot remove the previous target resource." };
      const destinationExisted = fs.exists(targetPath);
      const resourceSnapshots = resourceMigrations
        .filter(({ source, destination }) => source !== join(root, destination))
        .map(({ destination }) => {
          const path = join(root, destination);
          return {
            path,
            existed: fs.exists(path),
            contentBase64: fs.exists(path)
              ? Buffer.from(readResourceBytes(fs, path)).toString("base64")
              : "",
          };
        });
      fs.write(
        join(aiw, "checkpoints/migration-backup.yml"),
        `previous_target: ${previousTarget}\nprevious_path: ${previousTargetPath ?? "none"}\nprevious_content_base64: ${previousTargetPath && fs.exists(previousTargetPath) ? Buffer.from(fs.read(previousTargetPath)).toString("base64") : ""}\npath: ${targetPath}\ndestination_existed: ${destinationExisted}\ncontent_base64: ${destinationExisted ? Buffer.from(fs.read(targetPath)).toString("base64") : ""}\nresources_base64: ${serializeMigrationSnapshots(resourceSnapshots)}\n`,
      );
      if (target !== "universal" || !fs.exists(neutralAiInit)) generateAiInit(root, target, fs);
      if (fs.exists(neutralAiInit)) fs.write(targetPath, fs.read(neutralAiInit));
      for (const migration of resourceMigrations) {
        const destination = join(root, migration.destination);
        if (migration.source !== destination)
          writeResourceBytes(fs, destination, readResourceBytes(fs, migration.source));
      }
      if (removePrevious && previousTargetPath) fs.remove?.(previousTargetPath);
      fs.write(manifestPath, fs.read(manifestPath).replace(/active: .*\n/, `active: ${target}\n`));
      return {
        exitCode: 0,
        output: `Target changed to ${target}; rendered ${resourceMigrations.length} neutral resources.`,
      };
    }
    if (command === "rollback") {
      const backup = join(aiw, "checkpoints/migration-backup.yml");
      if (!fs.exists(backup)) return { exitCode: 1, error: "No migration backup is available." };
      const content = fs.read(backup);
      const path = content.match(/^path: (.+)$/m)?.[1];
      const encoded = content.match(/^content_base64: (.*)$/m)?.[1];
      const previousTarget = content.match(/^previous_target: (.+)$/m)?.[1];
      const previousPath = content.match(/^previous_path: (.+)$/m)?.[1];
      const previousEncoded = content.match(/^previous_content_base64: (.*)$/m)?.[1];
      const destinationExisted = content.match(/^destination_existed: (true|false)$/m)?.[1];
      const resourcesEncoded = content.match(/^resources_base64: (.+)$/m)?.[1];
      if (!path || encoded === undefined)
        return { exitCode: 1, error: "Migration backup is invalid." };
      if (!fs.remove)
        return { exitCode: 1, error: "Filesystem cannot consume the migration checkpoint." };
      if (destinationExisted === "false") {
        if (fs.exists(path) && !fs.remove)
          return { exitCode: 1, error: "Filesystem cannot remove the migrated target resource." };
        if (fs.exists(path)) fs.remove?.(path);
      } else fs.write(path, Buffer.from(encoded, "base64").toString("utf8"));
      if (previousPath && previousPath !== "none" && previousEncoded)
        fs.write(previousPath, Buffer.from(previousEncoded, "base64").toString("utf8"));
      for (const snapshot of resourcesEncoded ? parseMigrationSnapshots(resourcesEncoded) : []) {
        if (snapshot.existed)
          writeResourceBytes(fs, snapshot.path, Buffer.from(snapshot.contentBase64, "base64"));
        else {
          if (fs.exists(snapshot.path) && !fs.remove)
            return { exitCode: 1, error: "Filesystem cannot remove migrated resources." };
          if (fs.exists(snapshot.path)) fs.remove?.(snapshot.path);
        }
      }
      const manifestPath = join(aiw, "manifest.yml");
      if (previousTarget && fs.exists(manifestPath))
        fs.write(
          manifestPath,
          fs.read(manifestPath).replace(/active: .*\n/, `active: ${previousTarget}\n`),
        );
      fs.remove(backup);
      return { exitCode: 0, output: `Migration rolled back: ${path}` };
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
      fs.write(join(aiw, "overrides.yml"), serializeOverrides(overrides));
      return { exitCode: 0, output: "Fact overrides saved." };
    }
    if (command === "recommend") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const profile = await (services.profiler?.profile(root) ?? profileProject(root));
      const recommendations =
        services.recommender?.recommend(profile) ?? recommendCapabilities(profile);
      const selectedArg = args.find((arg) => arg.startsWith("--select="))?.split("=", 2)[1];
      if (!selectedArg && !stdin.isTTY) {
        return {
          exitCode: 1,
          error:
            "Interactive selection requires a TTY. Use --select=id,id in non-interactive environments.",
        };
      }
      const terminal = createInterface({ input: stdin, output: stdout });
      const selection = await selectRecommendations(
        recommendations,
        (question) => terminal.question(question),
        selectedArg?.split(","),
      );
      terminal.close();
      fs.write(
        join(aiw, "recommendations.yml"),
        serializeRecommendations(recommendations, selection),
      );
      return { exitCode: 0, output: `${recommendations.length} recommendations generated.` };
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
        return { exitCode: 0, output: manifest };
      } catch (error) {
        return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
      }
    }
    if (command === "doctor") {
      const required = ["manifest.yml", "profile.yml", "lock.yml"];
      const missing = required.filter((file) => !fs.exists(join(aiw, file)));
      if (missing.length)
        return { exitCode: 1, error: `Missing AI Workflow files: ${missing.join(", ")}` };
      try {
        parseManifest(fs.read(join(aiw, "manifest.yml")));
        if (fs.exists(join(aiw, "team-preset.yml")))
          parseTeamPreset(fs.read(join(aiw, "team-preset.yml")));
        if (fs.exists(join(aiw, "registries.yml")))
          parsePrivateRegistries(fs.read(join(aiw, "registries.yml")));
        if (fs.exists(join(aiw, "telemetry.yml")))
          parseTelemetryConfig(fs.read(join(aiw, "telemetry.yml")));
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
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "AI Workflow is not installed." };
      const files = [
        "manifest.yml",
        "profile.yml",
        "lock.yml",
        "overrides.yml",
        "recommendations.yml",
        "team-preset.yml",
        "registries.yml",
        "telemetry.yml",
      ];
      const dryRun = args.includes("--dry-run");
      if (!dryRun && !fs.remove)
        return { exitCode: 1, error: "Filesystem cannot remove AIW-owned files." };
      if (!dryRun)
        files
          .filter((file) => fs.exists(join(aiw, file)))
          .forEach((file) => fs.remove?.(join(aiw, file)));
      return {
        exitCode: 0,
        output: dryRun ? `Would remove: ${files.join(", ")}` : "AI Workflow-owned files removed.",
      };
    }
    if (command === "brainstorm") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
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
      const title =
        args.find((arg) => arg.startsWith("--title="))?.slice(8) || "Untitled Specification";
      const path = join(aiw, "generated/specs/specification.md");
      fs.write(
        path,
        `# ${title}\n\n## Context\n\n## Requirements\n\n### REQ-001: Requirement title\n\n- **Description:**\n- **Acceptance criteria:**\n  - Given\n  - When\n  - Then\n\n## Non-functional Requirements\n\n## Constraints\n\n## Open Questions\n\n`,
      );
      return { exitCode: 0, output: `Specification artifact created: ${path}` };
    }
    if (command === "adr") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
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
    if (command === "gate") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const stage = args[1];
      const requirements: Record<QualityGateStage, string> = {
        specification: "generated/specs/brainstorm.md",
        plan: "generated/specs/specification.md",
        verification: "generated/plans/implementation-plan.md",
      };
      if (!stage || !(stage in requirements))
        return { exitCode: 1, error: "Usage: aiw gate <specification|plan|verification>" };
      const gateStage = stage as QualityGateStage;
      const artifact = requirements[gateStage];
      if (!fs.exists(join(aiw, artifact)))
        return { exitCode: 1, error: `Quality gate blocked: missing ${artifact}` };
      const issues = evaluateQualityGate(gateStage, fs.read(join(aiw, artifact)));
      return issues.length
        ? { exitCode: 1, error: `Quality gate blocked: ${issues.join(" ")}` }
        : { exitCode: 0, output: `Quality gate passed for ${stage}.` };
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
      if (sourceArg) {
        const source = resolveProvider(sourceArg.slice(9), root);
        enforceConfiguredOrganizationPolicy(fs, aiw, { ...source, permissions: [] });
      }
      const loaded = sourceArg
        ? (services.packageSources ?? nodePackageSourceLoader).load(sourceArg.slice(9), root)
        : undefined;
      try {
        const pkg = validatePackageContract(
          loaded?.manifest ?? fs.read(join(root, packageArg!.slice(10))),
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
        assertPackagePermissions(resolved, parseApprovedPermissions(args));
        fs.write(join(aiw, "lock.yml"), serializeLock([resolvePackage(resolved)]));
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
      const pkg = validatePackageContract(fs.read(join(root, packageArg.slice(10))));
      enforceConfiguredOrganizationPolicy(fs, aiw, pkg);
      assertPackagePermissions(pkg, parseApprovedPermissions(args));
      const target = args.find((arg) => arg.startsWith("--target="))?.slice(9) ?? "universal";
      if (!isTarget(target)) return { exitCode: 1, error: `Unsupported target: ${target}` };
      const lock = fs.exists(join(aiw, "lock.yml")) ? fs.read(join(aiw, "lock.yml")) : "";
      const lockedPackages = lock ? parseLock(lock) : [];
      const current = lockedPackages.find(({ id }) => id === pkg.id);
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
      fs.write(join(aiw, "lock.yml"), serializeLock([...existingPackages, resolvePackage(pkg)]));
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
      return { exitCode: 0, output: serializeTokenUsage(entries) };
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
        "aiw install [--target target] | ui [--port=number] | orchestrate --plan=path [--execute] [--max-parallel=number] | telemetry <status|enable|disable> [privacy options] | plugin <create|validate> [options] | scan | self-validate --ticket=TYPE-000 | organization-policy --file=path [--replace] | policy-check --package=path [--package=path] | preset --file=path [--replace] | context | context-summary | context-quality | capabilities [--target=target] | token-usage [--stage=name --budget=number --used=number] | registry [--search=query] [--private=name] | registry configure --file=path [--replace] | skills <search|inspect|install|check|update> [options] | audit-package --package=path | verify-package --package=path --checksum=sha256 | brainstorm [--title=title] | spec [--title=title] | adr [--id=id --title=title] | plan [--title=title] | verify | trace | gate <stage> | recommend [--select=id,id] | status | doctor | repair | uninstall [--dry-run] | target <target> | rollback | confirm | resolve --package=path | update --package=path --target=target | validate [--package=path]",
    };
  } catch (error) {
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
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

function readSelectedRecommendations(fs: FileSystem, aiw: string): string[] {
  if (!fs.exists(join(aiw, "recommendations.yml"))) return [];
  const content = fs.read(join(aiw, "recommendations.yml"));
  return content
    .split(/^\s{2}- id: /m)
    .slice(1)
    .filter((block) => block.includes("selected: true"))
    .map((block) => block.split("\n", 1)[0].trim());
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

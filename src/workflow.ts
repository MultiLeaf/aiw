import { join } from "node:path";
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
import { resolvePackage, serializeLock } from "./lockfile.js";
import { installVercelSkill, nodeCommandExecutor } from "./vercel-skills.js";
import { scanProject } from "./scanner.js";
import { assertPackagePermissions } from "./package-audit.js";
import { planPackageUpdate } from "./package-updates.js";
import { searchRegistry, serializeRegistry } from "./registry.js";
import { checksumPackage, verifyPackageProvenance } from "./package-integrity.js";
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
      if (
        fs.exists(neutralAiInit) &&
        fs.exists(targetPath) &&
        fs.read(neutralAiInit) !== fs.read(targetPath)
      )
        return {
          exitCode: 1,
          error: `Migration conflict at ${targetPath}. Use --dry-run to inspect.`,
        };
      if (dryRun)
        return { exitCode: 0, output: `Migration preview: target would change to ${target}.` };
      const manifestPath = join(aiw, "manifest.yml");
      const previousTarget =
        fs
          .read(manifestPath)
          .match(/^\s*active:\s*(.+)$/m)?.[1]
          ?.trim() ?? "universal";
      if (fs.exists(targetPath))
        fs.write(
          join(aiw, "checkpoints/migration-backup.yml"),
          `previous_target: ${previousTarget}\npath: ${targetPath}\ncontent_base64: ${Buffer.from(fs.read(targetPath)).toString("base64")}\n`,
        );
      generateAiInit(root, target, fs);
      if (fs.exists(neutralAiInit)) fs.write(targetPath, fs.read(neutralAiInit));
      fs.write(manifestPath, fs.read(manifestPath).replace(/active: .*\n/, `active: ${target}\n`));
      return { exitCode: 0, output: `Target changed to ${target}` };
    }
    if (command === "rollback") {
      const backup = join(aiw, "checkpoints/migration-backup.yml");
      if (!fs.exists(backup)) return { exitCode: 1, error: "No migration backup is available." };
      const content = fs.read(backup);
      const path = content.match(/^path: (.+)$/m)?.[1];
      const encoded = content.match(/^content_base64: (.+)$/m)?.[1];
      const previousTarget = content.match(/^previous_target: (.+)$/m)?.[1];
      if (!path || !encoded) return { exitCode: 1, error: "Migration backup is invalid." };
      fs.write(path, Buffer.from(encoded, "base64").toString("utf8"));
      const manifestPath = join(aiw, "manifest.yml");
      if (previousTarget && fs.exists(manifestPath))
        fs.write(
          manifestPath,
          fs.read(manifestPath).replace(/active: .*\n/, `active: ${previousTarget}\n`),
        );
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
        const lockPath = join(aiw, "lock.yml");
        fs.write(
          lockPath,
          `${fs.exists(lockPath) ? fs.read(lockPath).replace(/\n*$/, "\n") : "schema: 1\npackages:\n"}  - id: vercel-labs/agent-skills/vercel-react-best-practices\n    provider: vercel-skills\n    source: vercel-labs/agent-skills\n    target: ${target}\n    integrity: ${fs.exists(join(root, "skills-lock.json")) ? (fs.read(join(root, "skills-lock.json")).match(/"computedHash":\s*"([^"]+)"/)?.[1] ?? "unknown") : "unknown"}\n`,
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
      if (!packageArg) return { exitCode: 1, error: "Usage: aiw resolve --package=path" };
      const pkg = validatePackageContract(fs.read(join(root, packageArg.slice(10))));
      assertPackagePermissions(pkg, parseApprovedPermissions(args));
      fs.write(join(aiw, "lock.yml"), serializeLock([resolvePackage(pkg)]));
      return { exitCode: 0, output: `Package resolved: ${pkg.id}@${pkg.version}` };
    }
    if (command === "update") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      const packageArg = args.find((arg) => arg.startsWith("--package="));
      if (!packageArg)
        return { exitCode: 1, error: "Usage: aiw update --package=path --target=target" };
      const pkg = validatePackageContract(fs.read(join(root, packageArg.slice(10))));
      assertPackagePermissions(pkg, parseApprovedPermissions(args));
      const target = args.find((arg) => arg.startsWith("--target="))?.slice(9) ?? "universal";
      if (!isTarget(target)) return { exitCode: 1, error: `Unsupported target: ${target}` };
      const lock = fs.exists(join(aiw, "lock.yml")) ? fs.read(join(aiw, "lock.yml")) : "";
      const current = lock.match(
        new RegExp(`id: ${escapeRegExp(pkg.id)}\\n\\s+version: ([^\\n]+)`),
      );
      const plan = planPackageUpdate(
        current ? { id: pkg.id, version: current[1].trim() } : undefined,
        pkg,
        target,
        new Map(
          [...lock.matchAll(/- id: ([^\n]+)\n\s+version: ([^\n]+)/g)]
            .filter((match) => match[1].trim() !== pkg.id)
            .map((match) => [match[1].trim(), match[2].trim()]),
        ),
      );
      if (plan.status !== "update")
        return { exitCode: 1, error: plan.reason ?? `Update blocked: ${plan.status}.` };
      const existingPackages = [
        ...lock.matchAll(
          /- id: ([^\n]+)\n\s+version: ([^\n]+)\n\s+provider: ([^\n]+)\n\s+source: ([^\n]+)\n\s+integrity: ([^\n]+)/g,
        ),
      ]
        .filter((match) => match[1].trim() !== pkg.id)
        .map((match) => ({
          id: match[1].trim(),
          version: match[2].trim(),
          provider: match[3].trim(),
          source: match[4].trim(),
          integrity: match[5].trim(),
        }));
      fs.write(join(aiw, "lock.yml"), serializeLock([...existingPackages, resolvePackage(pkg)]));
      return { exitCode: 0, output: `Package updated: ${pkg.id}@${pkg.version}` };
    }
    if (command === "registry") {
      const query = args.find((arg) => arg.startsWith("--search="))?.slice(9) ?? "";
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
    if (command === "capabilities") {
      const target = args.find((arg) => arg.startsWith("--target="))?.slice(9) ?? "universal";
      return { exitCode: 0, output: serializeAdapterCapabilities(target) };
    }
    return {
      exitCode: 0,
      output:
        "aiw install [--target target] | scan | context | context-summary | context-quality | capabilities [--target=target] | token-usage [--stage=name --budget=number --used=number] | registry [--search=query] | verify-package --package=path --checksum=sha256 | brainstorm [--title=title] | spec [--title=title] | adr [--id=id --title=title] | plan [--title=title] | verify | trace | gate <stage> | recommend [--select=id,id] | status | doctor | repair | uninstall [--dry-run] | target <target> | rollback | confirm | resolve --package=path | update --package=path --target=target | validate [--package=path]",
    };
  } catch (error) {
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
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

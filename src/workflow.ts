import { join } from "node:path";
import { BASE_DIRECTORIES, WORKFLOW_DIRECTORY } from "./constants.js";
import { detectTarget, generateAiInit, isTarget } from "./adapter.js";
import { profileProject } from "./profile.js";
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
import { scanProject } from "./scanner.js";

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
      fs.write(join(aiw, "lock.yml"), "schema: 1\npackages: []\n");
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
      profile.facts = mergeFacts(profile.facts, applyOverrides(profile.facts, overrides));
      const evidence = profile.facts
        .map(
          (fact) =>
            `  - key: ${fact.key}\n    value: ${fact.value}\n    state: ${fact.state}\n    method: ${fact.method}\n    confidence: ${fact.confidence}${fact.requiresConfirmation === undefined ? "" : `\n    requires_confirmation: ${fact.requiresConfirmation}`}\n    evidence: [${fact.evidence.map((item) => `"${item.source}"`).join(", ")}]`,
        )
        .join("\n");
      fs.write(
        join(aiw, "profile.yml"),
        `schema: 1\nstatus: scanned\nfacts:\n${evidence}\nruntime:\n  languages: [${profile.runtime.languages.join(", ")}]\nframeworks: [${profile.frameworks.join(", ")}]\npackage_manager: ${profile.packageManager}\nquality:\n  linter: ${profile.quality.linter?.name ?? "unknown"}\n  formatter: ${profile.quality.formatter?.name ?? "unknown"}\ntesting: ${profile.testing?.name ?? "unknown"}\nci: [${profile.ci.join(", ")}]\nworkspaces: [${profile.workspaces.join(", ")}]\npolicies:\n  artifact_language: en\n`,
      );
      return { exitCode: 0, output: "Project profile generated." };
    }
    if (command === "target") {
      const target = args[1];
      if (!target) return { exitCode: 1, error: "Usage: aiw target <target>" };
      if (!isTarget(target)) return { exitCode: 1, error: `Unsupported target: ${target}` };
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "Run `aiw install` first." };
      generateAiInit(root, target, fs);
      const path = join(aiw, "manifest.yml");
      fs.write(path, fs.read(path).replace(/active: .*\n/, `active: ${target}\n`));
      return { exitCode: 0, output: `Target changed to ${target}` };
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
        overrides.push({ key, action: "edit", value });
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
      const profile = await profileProject(root);
      const selectedArg = args.find((arg) => arg.startsWith("--select="))?.split("=", 2)[1];
      const selected =
        selectedArg?.split(",") ?? (command === "sync" ? readSelectedRecommendations(fs, aiw) : []);
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
    if (command === "status")
      return {
        exitCode: 0,
        output: fs.exists(join(aiw, "manifest.yml"))
          ? fs.read(join(aiw, "manifest.yml"))
          : "AI Workflow is not installed.",
      };
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
        `# ${title}\n\n## Goal\n\n## Users\n\n## Facts\n\n## Hypotheses\n\n## Constraints\n\n## Non-goals\n\n## Open Questions\n\n`,
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
        `# ${title}\n\n## Context\n\n## Requirements\n\n### REQ-001: Requirement title\n\n- **Description:**\n- **Acceptance criteria:**\n  - Given\n  - When\n  - Then\n\n## Non-functional Requirements\n\n## Open Questions\n\n`,
      );
      return { exitCode: 0, output: `Specification artifact created: ${path}` };
    }
    if (command === "validate") {
      if (!fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 1, error: "AI Workflow is not installed." };
      parseManifest(fs.read(join(aiw, "manifest.yml")));
      const packageArg = args.find((arg) => arg.startsWith("--package="));
      if (packageArg) validatePackageContract(fs.read(join(root, packageArg.slice(10))));
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
      fs.write(join(aiw, "lock.yml"), serializeLock([resolvePackage(pkg)]));
      return { exitCode: 0, output: `Package resolved: ${pkg.id}@${pkg.version}` };
    }
    return {
      exitCode: 0,
      output:
        "aiw install [--target target] | scan | brainstorm [--title=title] | spec [--title=title] | recommend [--select=id,id] | status | doctor | repair | uninstall [--dry-run] | target <target> | confirm | resolve --package=path | validate [--package=path]",
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

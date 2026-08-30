import { join } from "node:path";
import { BASE_DIRECTORIES, WORKFLOW_DIRECTORY } from "./constants.js";
import { generateAiInit, isTarget } from "./adapter.js";
import { profileProject } from "./profile.js";
import type { CommandResult, FileSystem } from "./types.js";
import { serializeOverrides, type FactOverride } from "./confirmation.js";
import { applyOverrides, parseOverrides } from "./confirmation.js";
import { mergeFacts } from "./intelligence.js";
import { createInterpretationRequest, type Interpreter } from "./interpreter.js";
import { scanProject } from "./scanner.js";
import { recommendCapabilities, serializeRecommendations } from "./recommendations.js";
import { selectRecommendations } from "./selection.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { generateProjectResources } from "./generator.js";
import { detectDrift } from "./drift.js";

export type WorkflowServices = { interpreter?: Interpreter };

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
      const target = (flag >= 0 ? args[flag + 1] : undefined) || "codex";
      if (!isTarget(target)) throw new Error(`Unsupported target: ${target}`);
      if (fs.exists(join(aiw, "manifest.yml")))
        return { exitCode: 0, output: "AI Workflow is already installed." };
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
      const profile = await profileProject(root);
      if (services.interpreter) {
        const scan = await scanProject(root);
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
      const profile = await profileProject(root);
      const recommendations = recommendCapabilities(profile);
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
    if (command === "validate")
      return {
        exitCode: fs.exists(join(aiw, "manifest.yml")) ? 0 : 1,
        output: "Configuration is valid.",
      };
    return {
      exitCode: 0,
      output:
        "aiw install [--target target] | scan | recommend [--select=id,id] | status | target <target> | confirm | validate",
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

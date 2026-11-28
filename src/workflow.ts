import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BlockingError, blockingResultToJson } from "./blocking-reasons.js";
import { contextUsageCommands } from "./commands/context-usage.js";
import { evalProposalsCommands } from "./commands/eval-proposals.js";
import { generationCommands } from "./commands/generation.js";
import { intelligenceCommands } from "./commands/intelligence.js";
import { migrationCommands } from "./commands/migration.js";
import { packagesPolicyCommands } from "./commands/packages-policy.js";
import { runtimeToolsCommands } from "./commands/runtime-tools.js";
import { sddArtifactsCommands } from "./commands/sdd-artifacts.js";
import { sddLifecycleCommands } from "./commands/sdd-lifecycle.js";
import { setupCommands } from "./commands/setup.js";
import type { CommandHandler, WorkflowServices } from "./commands/types.js";
import { WORKFLOW_DIRECTORY } from "./constants.js";
import { withSafeProjectWrites } from "./files.js";
import type { CommandResult, FileSystem } from "./types.js";

export type { WorkflowServices } from "./commands/types.js";
export { compareVerificationPairs } from "./commands/workflow-state.js";

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  ...sddLifecycleCommands,
  ...sddArtifactsCommands,
  ...setupCommands,
  ...migrationCommands,
  ...intelligenceCommands,
  ...generationCommands,
  ...packagesPolicyCommands,
  ...evalProposalsCommands,
  ...contextUsageCommands,
  ...runtimeToolsCommands,
};

export const REGISTERED_COMMANDS: readonly string[] = Object.keys(COMMAND_HANDLERS).sort();

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version?: string;
  };
  return pkg.version ?? "0.0.0";
}

export const HELP_OUTPUT = [
  "AI Workflow CLI (aiw) — use `aiw --version` (-v) to print the installed version.",
  "",
  "Setup & migration:",
  "  aiw install [target | --target target] [--configure-models]",
  "  aiw status | doctor [--fix] | repair | uninstall [--dry-run]",
  "  aiw target <target> [--dry-run] | rollback | migrate [--dry-run|--rollback]",
  "  aiw capabilities [--target=target]",
  "",
  "SDD workflow & gates:",
  "  aiw workflow <start|status|complete|abandon> [--id=id] [--reason=text]",
  "  aiw task <start|status|escalate|evidence> [--ticket=TEAM-123|--no-ticket] [--lane=light --lane-reason=text]",
  "  aiw brainstorm | prd | spec | adr | plan | pr | diagnosis | assess",
  "  aiw gate <stage> [--observe] | approve <stage> | reject <stage> --reason=text | skip <stage> --reason=text",
  "  aiw verify | trace | digest | risk assess | self-validate --ticket=TYPE-000",
  "",
  "Project intelligence & sync:",
  "  aiw scan | confirm | recommend [--select=id,id] | generate | sync [--preview|--approve-plan=fp]",
  "  aiw semantic <status|query|judge-context> | decision <status|triage|findings-triage>",
  "  aiw standards <extract|list|confirm|reject>",
  "",
  "Packages, skills & policy:",
  "  aiw registry [--search=query] [--private=name] | registry configure --file=path [--replace]",
  "  aiw skills <search|inspect|install|check|update> [options]",
  "  aiw validate [--package=path] | resolve --package=path | audit-package --package=path | verify-package --package=path --checksum=sha256",
  "  aiw update [--dry-run] [--add=type/id,...] | update --package=path --target=target",
  "  aiw organization-policy --file=path [--replace] | policy-check --package=path | policy approve --paths=...",
  "  aiw preset --file=path [--replace]",
  "",
  "Evals & proposals:",
  "  aiw eval run --scenarios [--registry=dir] [--harness=id] [--filter=id] [--advisory]",
  "  aiw evaluate | proposals <list|show|approve|reject|suppress> | rules-candidates",
  "",
  "Context, usage & runtime:",
  "  aiw context | context-summary | context-quality | context-bench | parity",
  "  aiw routing | token-usage | task-usage | cost-report | usage-sidecar <record|report|import>",
  "  aiw orchestrate --plan=path [--execute] [--runner=cli] [--timeout-ms=ms] [--isolate] [--cleanup] [--max-parallel=number]",
  "  aiw ui [--port=number] | telemetry <status|show|enable|disable> | plugin <create|validate>",
  "  aiw heartbeat <beat|status|checkpoint> | hooks <install|status>",
].join("\n");

export async function runCommand(
  args: string[],
  root: string,
  fs: FileSystem,
  services: WorkflowServices = {},
): Promise<CommandResult> {
  const aiw = join(root, WORKFLOW_DIRECTORY);
  try {
    fs = withSafeProjectWrites(fs, root);
    const command = args[0] ?? "help";
    if (command === "--version" || command === "-v") {
      return { exitCode: 0, output: readPackageVersion() };
    }
    const handler = Object.hasOwn(COMMAND_HANDLERS, command)
      ? COMMAND_HANDLERS[command]
      : undefined;
    if (handler) {
      return await handler({ args, root, aiw, fs, services });
    }
    return { exitCode: 0, output: HELP_OUTPUT };
  } catch (error) {
    if (error instanceof BlockingError && args.includes("--json")) {
      return { exitCode: 1, output: JSON.stringify(blockingResultToJson(error.result)) };
    }
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
}

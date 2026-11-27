import { join } from "node:path";
import { BlockingError, blockingResultToJson } from "./blocking-reasons.js";
import { contextUsageCommands } from "./commands/context-usage.js";
import { evalProposalsCommands } from "./commands/eval-proposals.js";
import { intelligenceCommands } from "./commands/intelligence.js";
import { packagesPolicyCommands } from "./commands/packages-policy.js";
import { runtimeToolsCommands } from "./commands/runtime-tools.js";
import { sddArtifactsCommands } from "./commands/sdd-artifacts.js";
import { sddLifecycleCommands } from "./commands/sdd-lifecycle.js";
import { setupMigrationCommands } from "./commands/setup-migration.js";
import type { CommandHandler, WorkflowServices } from "./commands/types.js";
import { WORKFLOW_DIRECTORY } from "./constants.js";
import { withSafeProjectWrites } from "./files.js";
import type { CommandResult, FileSystem } from "./types.js";

export type { WorkflowServices } from "./commands/types.js";
export { compareVerificationPairs } from "./commands/workflow-state.js";

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  ...sddLifecycleCommands,
  ...sddArtifactsCommands,
  ...setupMigrationCommands,
  ...intelligenceCommands,
  ...packagesPolicyCommands,
  ...evalProposalsCommands,
  ...contextUsageCommands,
  ...runtimeToolsCommands,
};

const HELP_OUTPUT =
  "aiw install [--target target] | workflow <start|status|complete> [--id=id] | task <start|status> --ticket=TEAM-123 [--title=text] | approve <stage> | reject <stage> --reason=text | skip <optional-stage> --reason=text | ui [--port=number] | orchestrate --plan=path [--execute] [--max-parallel=number] | telemetry <status|show|enable|disable> [privacy options] | plugin <create|validate> [options] | scan | semantic <status|query> | decision <status|triage> | self-validate --ticket=TYPE-000 | organization-policy --file=path [--replace] | policy-check --package=path [--package=path] | preset --file=path [--replace] | context | context-summary | context-quality | capabilities [--target=target] | token-usage [--stage=name --budget=number --used=number] | registry [--search=query] [--private=name] | registry configure --file=path [--replace] | skills <search|inspect|install|check|update> [options] | audit-package --package=path | verify-package --package=path --checksum=sha256 | brainstorm [--title=title] | spec [--title=title] | adr [--id=id --title=title] | plan [--title=title] | verify | trace | gate <stage> | standards <extract|list|confirm|reject> | recommend [--select=id,id] | eval run --scenarios [--registry=dir] [--harness=id] [--filter=id] [--advisory] | status | doctor | repair | uninstall [--dry-run] | target <target> | rollback | confirm | resolve --package=path | update [--dry-run] [--add=type/id,...] | update --package=path --target=target | validate [--package=path]";

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

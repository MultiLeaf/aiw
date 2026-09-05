#!/usr/bin/env node
import { nodeFileSystem } from "./files.js";
import { runCommand, type WorkflowServices } from "./workflow.js";
import type { CommandResult } from "./types.js";
import { recordConfiguredTelemetry } from "./telemetry.js";
import { join } from "node:path";

export function run(
  args: string[],
  root: string = process.cwd(),
  services: WorkflowServices = {},
): Promise<CommandResult> {
  return runWithTelemetry(args, root, services);
}

async function runWithTelemetry(
  args: string[],
  root: string,
  services: WorkflowServices,
): Promise<CommandResult> {
  const result = await runCommand(args, root, nodeFileSystem, services);
  await recordConfiguredTelemetry(
    nodeFileSystem,
    join(root, ".aiw/telemetry.yml"),
    services.telemetry,
    args[0],
    result,
  );
  return result;
}
if (process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("/aiw")) {
  const result = await run(process.argv.slice(2));
  if (result.output) console.log(result.output);
  if (result.error) console.error(result.error);
  process.exitCode = result.exitCode;
}

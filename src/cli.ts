#!/usr/bin/env node
import { nodeFileSystem } from "./files.js";
import { runCommand, type WorkflowServices } from "./workflow.js";
import type { CommandResult } from "./types.js";

export function run(
  args: string[],
  root: string = process.cwd(),
  services: WorkflowServices = {},
): Promise<CommandResult> {
  return runCommand(args, root, nodeFileSystem, services);
}
if (process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("/aiw")) {
  const result = await run(process.argv.slice(2));
  if (result.output) console.log(result.output);
  if (result.error) console.error(result.error);
  process.exitCode = result.exitCode;
}

#!/usr/bin/env node
import { nodeFileSystem } from "./files.js";
import { runCommand } from "./workflow.js";
export function run(args, root = process.cwd(), services = {}) {
    return runCommand(args, root, nodeFileSystem, services);
}
if (process.argv[1]?.endsWith("cli.js")) {
    const result = await run(process.argv.slice(2));
    if (result.output)
        console.log(result.output);
    if (result.error)
        console.error(result.error);
    process.exitCode = result.exitCode;
}

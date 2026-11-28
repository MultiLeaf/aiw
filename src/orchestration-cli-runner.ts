import { execFile } from "node:child_process";
import type { AgentOrchestrator, OrchestrationAgent, OrchestrationTask } from "./orchestration.js";

export type CliHarnessSpec = {
  command: string;
  buildArgs(prompt: string): string[];
};

export type ProcessRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  notFound?: boolean;
};

export type ProcessRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<ProcessRunResult>;

export const DEFAULT_CLI_TIMEOUT_MS = 5 * 60_000;

export const DEFAULT_CLI_HARNESSES: Readonly<Record<OrchestrationAgent, CliHarnessSpec>> = {
  codex: { command: "codex", buildArgs: (prompt) => ["exec", prompt] },
  claude: { command: "claude", buildArgs: (prompt) => ["-p", prompt] },
  gemini: { command: "gemini", buildArgs: (prompt) => ["-p", prompt] },
  antigravity: { command: "agy", buildArgs: (prompt) => ["-p", prompt] },
};

export const defaultProcessRunner: ProcessRunner = (command, args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
        if (err.code === "ENOENT") {
          resolve({ exitCode: 127, stdout, stderr, notFound: true });
          return;
        }
        const timedOut = Boolean(err.killed && err.signal === "SIGTERM");
        const exitCode = typeof err.code === "number" ? err.code : 1;
        resolve({ exitCode, stdout, stderr: stderr || error.message, timedOut });
      },
    );
  });

function conciseSummary(text: string, fallback: string): string {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return (line ?? fallback).slice(0, 240);
}

export function createCliOrchestrator(options: {
  root: string;
  timeoutMs?: number;
  harnesses?: Partial<Record<OrchestrationAgent, CliHarnessSpec>>;
  exec?: ProcessRunner;
}): AgentOrchestrator {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  const exec = options.exec ?? defaultProcessRunner;
  const harnesses: Record<OrchestrationAgent, CliHarnessSpec> = {
    ...DEFAULT_CLI_HARNESSES,
    ...options.harnesses,
  };
  return {
    async run(task: OrchestrationTask): Promise<{ success: boolean; detail: string }> {
      const harness = harnesses[task.agent];
      const cwd = task.worktree ?? options.root;
      const result = await exec(harness.command, harness.buildArgs(task.prompt), {
        cwd,
        timeoutMs,
      });
      if (result.notFound) {
        return {
          success: false,
          detail: `CLI harness '${harness.command}' is not installed or not on PATH.`,
        };
      }
      if (result.timedOut) {
        return {
          success: false,
          detail: `Timed out after ${timeoutMs}ms running ${harness.command}.`,
        };
      }
      if (result.exitCode !== 0) {
        return {
          success: false,
          detail: conciseSummary(
            result.stderr || result.stdout,
            `${harness.command} exited with code ${result.exitCode}.`,
          ),
        };
      }
      return {
        success: true,
        detail: conciseSummary(result.stdout, `${task.id} completed by ${task.agent}.`),
      };
    },
  };
}

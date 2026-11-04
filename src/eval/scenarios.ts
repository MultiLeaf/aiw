/**
 * OPP-016: Behavioral evaluation phase 2 — the scenario registry replayed
 * against real harness CLIs.
 *
 * OPP-011 proves generated artifacts *say* the right things (text invariants);
 * this module proves agents *do* them: each scenario declares a fixture
 * repository, a bounded harness command, and deterministic state-outcome
 * expectations (exit code + `.aiw/` state files). No prose assertions, no
 * LLM-as-judge — the layer stays deterministic where it judges.
 *
 * Trust boundaries honored (NFR-3): a missing harness CLI yields an explicit
 * `skipped-harness-unavailable` marker (never a silent pass); token usage is
 * recorded only when the harness reports it (never fabricated); scenarios are
 * advisory-first — nothing in this module gates a release until the declared
 * two-cycle ratchet elapses.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { parse as parseYaml } from "yaml";

export type ScenarioStatus =
  | "passed"
  | "failed"
  | "skipped-harness-unavailable"
  | "flaky-suspect"
  | "aborted-timeout"
  | "aborted-budget"
  | "aborted-pool";

export type ScenarioExpectation = {
  exitCode?: number;
  files?: Record<
    string,
    { contains?: string; notContains?: string; absent?: boolean; matches?: string }
  >;
  /** Directory-level assertions (e.g. durable artifacts a light lane must skip). */
  dirs?: Record<string, { absent?: boolean }>;
};

export type ScenarioDefinition = {
  schema: number;
  id: string;
  family: string;
  description: string;
  /** Harness CLI id (e.g. codex, claude, gemini) — availability is probed on PATH. */
  harness: string;
  /** Shell command template; must contain the {prompt} placeholder. */
  command: string;
  prompt: string;
  fixture: { files: { path: string; content: string }[]; setup?: string[]; git?: boolean };
  expected: ScenarioExpectation;
  budget?: { wallClockS?: number; tokenCeiling?: number };
};

export type ScenarioUsage = { tokensIn: number; tokensOut: number };

export type ScenarioResult = {
  scenario: string;
  family: string;
  status: ScenarioStatus;
  attempts: number;
  durationMs: number;
  usage?: ScenarioUsage;
  detail: string;
};

export type ScenarioRunReport = {
  schema: "aiw.scenario-results/v1";
  harness: string;
  startedAt: string;
  finishedAt: string;
  poolBudget?: { tokenCeiling: number; tokensSpent: number };
  missingHarnesses: string[];
  results: ScenarioResult[];
};

export type ShellResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  signal?: string;
};

export type ShellRunner = (cwd: string, command: string, timeoutMs: number) => Promise<ShellResult>;

const SCENARIO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function parseScenarioRegistry(
  entries: { path: string; content: string }[],
): ScenarioDefinition[] {
  const scenarios: ScenarioDefinition[] = [];
  for (const entry of entries) {
    const value: unknown = parseYaml(entry.content);
    if (!value || typeof value !== "object")
      throw new Error(`Scenario ${entry.path} is not a YAML mapping.`);
    const scenario = value as Record<string, unknown>;
    if (scenario.schema !== 1) throw new Error(`Scenario ${entry.path} must declare schema: 1.`);
    const id = String(scenario.id ?? "");
    if (!SCENARIO_ID_PATTERN.test(id))
      throw new Error(`Scenario ${entry.path} has an invalid id: ${JSON.stringify(id)}`);
    if (scenarios.some((existing) => existing.id === id))
      throw new Error(`Duplicate scenario id: ${id}`);
    const command = String(scenario.command ?? "");
    if (!command.includes("{prompt}"))
      throw new Error(`Scenario ${id} command must contain the {prompt} placeholder.`);
    const prompt = String(scenario.prompt ?? "");
    if (!prompt.trim()) throw new Error(`Scenario ${id} has an empty prompt.`);
    const fixture = (scenario.fixture ?? {}) as Record<string, unknown>;
    const files = Array.isArray(fixture.files) ? fixture.files : [];
    for (const file of files) {
      const path = String((file as Record<string, unknown>).path ?? "");
      if (path.includes("..") || resolve("/", path) === "/")
        throw new Error(`Scenario ${id} fixture path escapes the fixture: ${path}`);
    }
    scenarios.push({
      schema: 1,
      id,
      family: String(scenario.family ?? "general"),
      description: String(scenario.description ?? ""),
      harness: String(scenario.harness ?? ""),
      command,
      prompt,
      fixture: {
        files: files.map((file) => ({
          path: String((file as Record<string, unknown>).path),
          content: String((file as Record<string, unknown>).content ?? ""),
        })),
        setup: Array.isArray(fixture.setup) ? fixture.setup.map(String) : [],
        git: fixture.git !== false,
      },
      expected: (scenario.expected ?? {}) as ScenarioExpectation,
      budget: (scenario.budget ?? {}) as { wallClockS?: number; tokenCeiling?: number },
    });
  }
  return scenarios;
}

/** Replaces {prompt} with a safely single-quoted shell literal. */
export function expandCommand(template: string, prompt: string): string {
  const quoted = `'${prompt.replaceAll("'", "'\\''")}'`;
  return template.replaceAll("{prompt}", quoted);
}

/**
 * Best-effort usage sidecar: parses harness stdout for known usage shapes
 * (codex `token_usage`, claude `usage`). Absence returns undefined — usage is
 * never fabricated.
 */
export function extractUsage(output: string): ScenarioUsage | undefined {
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const usage =
      ((parsed as Record<string, unknown>).token_usage as Record<string, unknown> | undefined) ??
      ((parsed as Record<string, unknown>).usage as Record<string, unknown> | undefined);
    if (!usage || typeof usage !== "object") continue;
    const input = Number(usage.input_tokens);
    const output_ = Number(usage.output_tokens);
    if (Number.isFinite(input) && input >= 0) tokensIn = (tokensIn ?? 0) + input;
    if (Number.isFinite(output_) && output_ >= 0) tokensOut = (tokensOut ?? 0) + output_;
  }
  if (tokensIn === undefined && tokensOut === undefined) return undefined;
  return { tokensIn: tokensIn ?? 0, tokensOut: tokensOut ?? 0 };
}

/** PATH probe for a harness CLI binary; injectable for tests. */
export function isHarnessAvailable(harness: string, pathEnv?: string): boolean {
  if (!harness) return false;
  const path = pathEnv ?? process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    if (existsSync(join(dir, harness))) return true;
  }
  return false;
}

export function outcomeFingerprint(report: ScenarioRunReport): string[] {
  return report.results
    .map((result) => `${result.scenario}:${result.status}`)
    .sort((a, b) => a.localeCompare(b));
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value) ? value : JSON.stringify(value);
}

export function serializeScenarioResults(report: ScenarioRunReport): string {
  const counts = new Map<ScenarioStatus, number>();
  for (const result of report.results)
    counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  const lines = [
    "schema: aiw.scenario-results/v1",
    `harness: ${JSON.stringify(report.harness)}`,
    `startedAt: ${JSON.stringify(report.startedAt)}`,
    `finishedAt: ${JSON.stringify(report.finishedAt)}`,
  ];
  if (report.poolBudget)
    lines.push(
      `poolBudget:\\n  tokenCeiling: ${report.poolBudget.tokenCeiling}\\n  tokensSpent: ${report.poolBudget.tokensSpent}`,
    );
  lines.push(
    `missingHarnesses: ${report.missingHarnesses.length ? JSON.stringify(report.missingHarnesses) : "[]"}`,
  );
  lines.push("results:");
  for (const result of [...report.results].sort((a, b) => a.scenario.localeCompare(b.scenario))) {
    lines.push(`  - scenario: ${yamlScalar(result.scenario)}`);
    lines.push(`    family: ${yamlScalar(result.family)}`);
    lines.push(`    status: ${result.status}`);
    lines.push(`    attempts: ${result.attempts}`);
    lines.push(`    durationMs: ${result.durationMs}`);
    if (result.usage)
      lines.push(
        `    usage:\\n      tokensIn: ${result.usage.tokensIn}\\n      tokensOut: ${result.usage.tokensOut}`,
      );
    lines.push(`    detail: ${JSON.stringify(result.detail)}`);
  }
  lines.push("summary:");
  for (const [status, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    lines.push(`  ${status}: ${count}`);
  return `${lines.join("\\n")}\\n`;
}

/** Transport-level failure: timeout, signal kill, or harness-specific crash codes. */
function isTransportFailure(result: ShellResult): boolean {
  return Boolean(result.timedOut) || Boolean(result.signal) || result.exitCode >= 250;
}

function evaluateExpectations(
  fixtureDir: string,
  expected: ScenarioExpectation,
  result: ShellResult,
): string[] {
  const failures: string[] = [];
  const wantedExit = expected.exitCode ?? 0;
  if (result.exitCode !== wantedExit)
    failures.push(`exit code ${result.exitCode} (expected ${wantedExit})`);
  for (const [path, assertion] of Object.entries(expected.files ?? {})) {
    const absolute = join(fixtureDir, path);
    if (assertion.absent) {
      if (existsSync(absolute)) failures.push(`${path} exists (expected absent)`);
      continue;
    }
    if (!existsSync(absolute)) {
      failures.push(`${path} missing`);
      continue;
    }
    const content = readFileSync(absolute, "utf8");
    if (assertion.contains && !content.includes(assertion.contains))
      failures.push(`${path} does not contain ${JSON.stringify(assertion.contains)}`);
    if (assertion.notContains && content.includes(assertion.notContains))
      failures.push(`${path} must not contain ${JSON.stringify(assertion.notContains)}`);
    if (assertion.matches && !new RegExp(assertion.matches, "m").test(content))
      failures.push(`${path} does not match /${assertion.matches}/`);
  }
  for (const [path, assertion] of Object.entries(expected.dirs ?? {})) {
    const absolute = join(fixtureDir, path);
    if (assertion.absent && existsSync(absolute))
      failures.push(`${path}/ exists (expected absent)`);
  }
  return failures;
}

export type Fixture = { dir: string; cleanup: () => void };

function buildFixtureDefault(
  scenario: ScenarioDefinition,
  runShell: ShellRunner,
): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "aiw-scenario-"));
  const dir = join(root, scenario.id);
  mkdirSync(dir, { recursive: true });
  for (const file of scenario.fixture.files) {
    const absolute = join(dir, file.path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, file.content);
  }
  const prepare = async (): Promise<void> => {
    if (scenario.fixture.git !== false) {
      const init = await runShell(dir, "git init -q", 15000);
      if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.slice(0, 200)}`);
      const config = await runShell(
        dir,
        'git config user.email "scenario@aiw.local" && git config user.name scenario',
        15000,
      );
      if (config.exitCode !== 0)
        throw new Error(`git config failed: ${config.stderr.slice(0, 200)}`);
      const commit = await runShell(dir, "git add -A && git commit -qm fixture", 15000);
      if (commit.exitCode !== 0)
        throw new Error(`git commit failed: ${commit.stderr.slice(0, 200)}`);
    }
    for (const command of scenario.fixture.setup ?? []) {
      const result = await runShell(dir, command, 120000);
      if (result.exitCode !== 0)
        throw new Error(
          `setup command failed (exit ${result.exitCode}): ${command} — ${result.stderr.slice(0, 200)}`,
        );
    }
  };
  return prepare().then(
    () => ({ dir, cleanup: () => rmSync(root, { recursive: true, force: true }) }),
    (error) => {
      rmSync(root, { recursive: true, force: true });
      throw error;
    },
  );
}

export async function runScenarios(options: {
  scenarios: ScenarioDefinition[];
  runShell: ShellRunner;
  buildFixture?: (scenario: ScenarioDefinition) => Promise<Fixture>;
  isAvailable?: (harness: string) => boolean;
  poolTokenCeiling?: number;
  now?: () => Date;
}): Promise<ScenarioRunReport> {
  const available =
    options.isAvailable ?? ((harness: string): boolean => isHarnessAvailable(harness));
  const buildFixture =
    options.buildFixture ??
    ((scenario: ScenarioDefinition): Promise<Fixture> =>
      buildFixtureDefault(scenario, options.runShell));
  const now = options.now ?? ((): Date => new Date());
  const startedAt = now().toISOString();
  const results: ScenarioResult[] = [];
  const missing = new Set<string>();
  let tokensSpent = 0;
  for (const scenario of options.scenarios) {
    if (options.poolTokenCeiling !== undefined && tokensSpent >= options.poolTokenCeiling) {
      results.push({
        scenario: scenario.id,
        family: scenario.family,
        status: "aborted-pool",
        attempts: 0,
        durationMs: 0,
        detail: `pooled token budget exhausted (${tokensSpent}/${options.poolTokenCeiling})`,
      });
      continue;
    }
    if (!available(scenario.harness)) {
      missing.add(scenario.harness);
      results.push({
        scenario: scenario.id,
        family: scenario.family,
        status: "skipped-harness-unavailable",
        attempts: 0,
        durationMs: 0,
        detail: `harness CLI "${scenario.harness}" not found on PATH`,
      });
      continue;
    }
    const started = now();
    let fixture: Fixture;
    try {
      fixture = await buildFixture(scenario);
    } catch (error) {
      results.push({
        scenario: scenario.id,
        family: scenario.family,
        status: "failed",
        attempts: 0,
        durationMs: 0,
        detail: `fixture setup failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    let status: ScenarioStatus = "failed";
    let usage: ScenarioUsage | undefined;
    let detail = "";
    let attempts = 0;
    const wallClockMs = (scenario.budget?.wallClockS ?? 300) * 1000;
    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        attempts = attempt;
        const command = expandCommand(scenario.command, scenario.prompt);
        const result = await options.runShell(fixture.dir, command, wallClockMs);
        usage = extractUsage(result.stdout) ?? usage;
        const expectationFailures = evaluateExpectations(fixture.dir, scenario.expected, result);
        const transport = isTransportFailure(result);
        if (expectationFailures.length === 0 && !transport) {
          status = attempt === 1 ? "passed" : "flaky-suspect";
          detail =
            attempt === 1
              ? "outcome matched expectations"
              : "passed on retry after transport failure";
          break;
        }
        if (result.timedOut) {
          status = "aborted-timeout";
          detail = `wall clock exceeded ${scenario.budget?.wallClockS ?? 300}s`;
        } else if (transport) {
          status = "failed";
          detail = `harness transport failure (exit ${result.exitCode}${result.signal ? `, signal ${result.signal}` : ""})`;
        } else {
          status = "failed";
          detail = expectationFailures.join("; ");
        }
        if (attempt === 2) break;
        if (!transport && status === "failed" && !result.timedOut) break; // expectation failure: no retry
      }
    } finally {
      fixture?.cleanup();
    }
    const durationMs = Math.max(0, now().getTime() - started.getTime());
    if (usage) tokensSpent += usage.tokensIn + usage.tokensOut;
    if (
      usage &&
      scenario.budget?.tokenCeiling !== undefined &&
      usage.tokensIn + usage.tokensOut > scenario.budget.tokenCeiling
    ) {
      status = "aborted-budget";
      detail = `token usage ${usage.tokensIn + usage.tokensOut} exceeded per-scenario ceiling ${scenario.budget.tokenCeiling}`;
    }
    results.push({
      scenario: scenario.id,
      family: scenario.family,
      status,
      attempts,
      durationMs,
      usage,
      detail,
    });
  }
  const finishedAt = now().toISOString();
  return {
    schema: "aiw.scenario-results/v1",
    harness: [...new Set(options.scenarios.map((scenario) => scenario.harness))].join(","),
    startedAt,
    finishedAt,
    poolBudget:
      options.poolTokenCeiling !== undefined
        ? { tokenCeiling: options.poolTokenCeiling, tokensSpent }
        : undefined,
    missingHarnesses: [...missing].sort(),
    results,
  };
}

export function defaultShellRunner(
  cwd: string,
  command: string,
  timeoutMs: number,
): Promise<ShellResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("sh", ["-c", command], { cwd, timeout: timeoutMs, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const finish = (result: ShellResult): void => resolvePromise(result);
    child.on("error", (error) => finish({ exitCode: 255, stdout, stderr: `${stderr}${error}` }));
    child.on("close", (code, signal) =>
      finish({
        exitCode: code ?? (signal ? 255 : 1),
        stdout,
        stderr,
        timedOut: Boolean(signal && signal === "SIGTERM"),
        signal: signal ?? undefined,
      }),
    );
  });
}

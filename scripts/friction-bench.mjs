#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain-JS bench helpers cannot declare TypeScript return types */
/**
 * Friction benchmark (OPP-005, REQ-OPP-005).
 *
 * Measures HOW the packaged CLI stops you, never how fast: every non-success
 * exit of a scripted journey is classified as
 *   in-band    — it stopped you and the printed continuation, executed,
 *                resolves or advances the block;
 *   out-of-band— it stopped you with guidance but no typed reason contract;
 *   dead end   — the printed continuation fails and names no way out.
 * Budget: zero dead ends. Out-of-band is the honest baseline to shrink.
 *
 * Usage: node scripts/friction-bench.mjs [--json]
 */

import { spawnSync } from "node:child_process";
import { log } from "node:console";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execPath, default as process } from "node:process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");

const BRAINSTORM = [
  "# T",
  "",
  "## Goal",
  "G",
  "## Users",
  "U",
  "## Constraints",
  "C",
  "## Risks",
  "R",
  "## Non-goals",
  "N",
].join("\n");

function repo() {
  return mkdtempSync(join(tmpdir(), "aiw-friction-"));
}

function run(cwd, args) {
  const result = spawnSync(execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return { exitCode: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Normalize a printed continuation into a runnable argv (placeholders -> bench). */
function toRunnable(invocation) {
  const normalized = invocation
    .replace(/<[^>]*>/g, "bench")
    .replace(/["']/g, "")
    .trim();
  const argv = normalized.split(/\s+/);
  return argv[0] === "aiw" ? argv.slice(1) : argv;
}

function classify(cwd, result) {
  if (result.exitCode === 0) return { kind: "pass" };
  if (!result.output.includes("[reason:"))
    return { kind: "out-of-band", excerpt: result.output.trim().split("\n")[0] };
  if (result.output.includes("Terminal:"))
    return { kind: "terminal", code: /\[reason: ([a-z_]+)\]/.exec(result.output)?.[1] };
  const code = /\[reason: ([a-z_]+)\]/.exec(result.output)?.[1];
  const command = /`aiw [^`]+`/.exec(result.output)?.[0]?.slice(1, -1);
  if (!command) {
    return result.output.includes("Next:")
      ? { kind: "in-band-action", code }
      : { kind: "out-of-band", excerpt: result.output.trim().split("\n")[0] };
  }
  const argv = toRunnable(command);
  const continuation = run(cwd, argv);
  if (continuation.exitCode === 0) return { kind: "in-band", code, via: argv.join(" ") };
  if (
    continuation.output.includes("[reason:") &&
    (continuation.output.includes("Next:") || continuation.output.includes("Terminal:"))
  )
    return { kind: "in-band", code, via: `${argv.join(" ")} (chain)` };
  return {
    kind: "dead-end",
    code,
    via: argv.join(" "),
    excerpt: continuation.output.trim().split("\n")[0],
  };
}

const journeys = [
  {
    name: "light-happy",
    steps: (cwd) => [
      () => run(cwd, ["install"]),
      () =>
        run(cwd, ["task", "start", "--ticket=TEAM-1", "--lane=light", "--lane-reason=bench small"]),
      () => run(cwd, ["task", "evidence", "--validation=bench: pass"]),
      () => run(cwd, ["workflow", "complete"]),
    ],
  },
  {
    name: "light-lane-block-escalates",
    steps: (cwd) => [
      () => run(cwd, ["install"]),
      () =>
        run(cwd, ["task", "start", "--ticket=TEAM-2", "--lane=light", "--lane-reason=bench small"]),
      () => run(cwd, ["spec"]),
    ],
  },
  {
    name: "light-complete-needs-evidence",
    steps: (cwd) => [
      () => run(cwd, ["install"]),
      () =>
        run(cwd, ["task", "start", "--ticket=TEAM-3", "--lane=light", "--lane-reason=bench small"]),
      () => run(cwd, ["workflow", "complete"]),
    ],
  },
  {
    name: "gate-before-install",
    steps: (cwd) => [() => run(cwd, ["gate", "brainstorming"])],
  },
  {
    name: "approve-before-install",
    steps: (cwd) => [() => run(cwd, ["approve", "brainstorming"])],
  },
  {
    name: "risk-outside-git",
    steps: (cwd) => [() => run(cwd, ["risk", "assess"])],
  },
  {
    name: "unknown-gate-stage",
    steps: (cwd) => [
      () => run(cwd, ["install"]),
      () => run(cwd, ["workflow", "start"]),
      () => run(cwd, ["gate", "frobnicate"]),
    ],
  },
  {
    name: "full-lane-walk",
    steps: (cwd) => [
      () => run(cwd, ["install"]),
      () => run(cwd, ["workflow", "start"]),
      () => run(cwd, ["brainstorm"]),
      () => run(cwd, ["gate", "brainstorming"]),
      () => {
        writeFileSync(join(cwd, ".aiw/generated/specs/brainstorm.md"), BRAINSTORM);
        return run(cwd, ["gate", "brainstorming"]);
      },
      () => run(cwd, ["spec"]),
      () => run(cwd, ["approve", "brainstorming"]),
      () => run(cwd, ["spec"]),
    ],
  },
  {
    name: "stale-approval-reruns-gate",
    steps: (cwd) => [
      () => run(cwd, ["install"]),
      () => run(cwd, ["workflow", "start"]),
      () => run(cwd, ["brainstorm"]),
      () => {
        writeFileSync(join(cwd, ".aiw/generated/specs/brainstorm.md"), BRAINSTORM);
        return run(cwd, ["gate", "brainstorming"]);
      },
      () => run(cwd, ["approve", "brainstorming"]),
      () => {
        writeFileSync(join(cwd, ".aiw/generated/specs/brainstorm.md"), `${BRAINSTORM}\nchanged`);
        return run(cwd, ["approve", "brainstorming"]);
      },
    ],
  },
];

export function runBench(journeyList = journeys) {
  const perJourney = [];
  const totals = {
    "in-band": 0,
    "in-band-action": 0,
    terminal: 0,
    "out-of-band": 0,
    "dead-end": 0,
  };
  for (const journey of journeyList) {
    const cwd = repo();
    const blocks = [];
    for (const step of journey.steps(cwd)) {
      const result = step();
      if (result.exitCode === 0) continue;
      const cwdForClassification = cwd;
      const verdict = classify(cwdForClassification, result);
      blocks.push({ ...verdict, step: result.output.trim().split("\n")[0]?.slice(0, 80) });
      if (totals[verdict.kind] !== undefined) totals[verdict.kind] += 1;
    }
    perJourney.push({ name: journey.name, blocks });
  }
  return { totals, perJourney };
}

function main() {
  const asJson = process.argv.includes("--json");
  const report = runBench();
  if (asJson) {
    log(JSON.stringify(report, null, 2));
  } else {
    for (const journey of report.perJourney) {
      log(`\n${journey.name}`);
      if (journey.blocks.length === 0) log("  no blocks");
      for (const block of journey.blocks)
        log(
          `  ${block.kind}${block.code ? ` (${block.code})` : ""}${block.via ? ` via: ${block.via}` : ""}${block.excerpt ? ` — ${block.excerpt}` : ""}`,
        );
    }
    log(
      `\nTotals: in-band=${report.totals["in-band"]} in-band-action=${report.totals["in-band-action"]} terminal=${report.totals.terminal} out-of-band=${report.totals["out-of-band"]} dead-end=${report.totals["dead-end"]}`,
    );
  }
  process.exitCode = report.totals["dead-end"] > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("friction-bench.mjs") || process.argv[1].endsWith("friction-bench.js"))
) {
  main();
}

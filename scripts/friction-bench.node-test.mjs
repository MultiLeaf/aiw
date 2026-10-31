import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runBench } from "./friction-bench.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");

test("friction benchmark runs only against a built CLI", { skip: existsSync(cli) }, () => {
  assert.ok(existsSync(cli), "dist/cli.js missing; run npm run build first");
});

test("friction budget holds: zero dead ends over the journey corpus", () => {
  const report = runBench();
  assert.equal(report.totals["dead-end"], 0, JSON.stringify(report.perJourney, null, 2));
  assert.ok(report.totals["in-band"] >= 4, "expected the corpus to exercise in-band continuations");
});

test("friction classification is deterministic across runs", () => {
  const first = runBench();
  const second = runBench();
  assert.deepEqual(second.totals, first.totals);
});

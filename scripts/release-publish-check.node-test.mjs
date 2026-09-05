import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";

const source = join(dirname(fileURLToPath(import.meta.url)), "release-publish-check.mjs");

// JavaScript test helpers cannot declare a TypeScript return type.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function validate(version, tag, license = "MIT") {
  const root = mkdtempSync(join(tmpdir(), "aiw-release-gate-"));
  const script = join(root, "scripts/release-publish-check.mjs");
  mkdirSync(dirname(script), { recursive: true });
  cpSync(source, script, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "@multileaf/ai-workflow", version, license })}\n`,
  );
  return spawnSync(execPath, [script, `--tag=${tag}`], { encoding: "utf8" });
}

test("accepts complete Semantic Versions when tag and package agree", () => {
  for (const version of ["0.1.0", "0.1.0-rc.1", "0.1.0+build.1", "0.1.0-rc.1+build.1"]) {
    assert.equal(validate(version, `v${version}`).status, 0, version);
  }
});

test("rejects malformed Semantic Versions", () => {
  for (const version of ["01.1.0", "0.1.0-01", "0.1.0-rc..1", "1.0", "v1.0.0"]) {
    assert.notEqual(validate(version, `v${version}`).status, 0, version);
  }
});

test("rejects mismatched tags and licenses other than MIT", () => {
  assert.notEqual(validate("0.1.0", "v0.1.1").status, 0);
  assert.notEqual(validate("0.1.0", "v0.1.0", "UNLICENSED").status, 0);
  assert.notEqual(validate("0.1.0", "v0.1.0", "Apache-2.0").status, 0);
});

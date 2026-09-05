import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { stdout } from "node:process";
import { URL } from "node:url";

const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
});
if (packed.status !== 0) throw new Error(packed.stderr || "npm pack dry-run failed.");

const report = JSON.parse(packed.stdout)[0];
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const paths = report.files.map(({ path }) => path);
const required = [
  "dist/cli.js",
  "dist/cli.d.ts",
  "dist/plugin-sdk.js",
  "dist/plugin-sdk.d.ts",
  "dist/orchestration.js",
  "dist/orchestration.d.ts",
  "resources/package.yaml",
  "README.md",
  "CHANGELOG.md",
  "docs/release-process.md",
];
const forbidden = [
  /^src\//,
  /^\.aiw\//,
  /^\.agents\//,
  /^\.context\//,
  /(?:^|\/)node_modules\//,
  /\.test\.(?:js|d\.ts)$/,
  /(?:^|\/)fixtures\//,
  /\.tgz$/,
];

const missing = required.filter((path) => !paths.includes(path));
const leaked = paths.filter((path) => forbidden.some((pattern) => pattern.test(path)));
if (missing.length) throw new Error(`Release package is missing: ${missing.join(", ")}`);
if (leaked.length) throw new Error(`Release package contains internal files: ${leaked.join(", ")}`);
if (report.name !== "@multileaf/ai-workflow" || report.version !== manifest.version)
  throw new Error("Release package identity does not match package.json.");

stdout.write(
  `Release package validated: ${report.name}@${report.version} (${paths.length} files).\n`,
);

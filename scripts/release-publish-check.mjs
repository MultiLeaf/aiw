import { readFileSync } from "node:fs";
import { argv, stdout } from "node:process";
import { URL } from "node:url";

const tagArgument = argv.slice(2).find((value) => value.startsWith("--tag="));
const tag = tagArgument?.slice("--tag=".length) ?? "";
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const core = "(?:0|[1-9]\\d*)";
const prereleaseIdentifier = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const buildIdentifier = "[0-9A-Za-z-]+";
const semanticVersion = new RegExp(
  `^${core}\\.${core}\\.${core}(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?(?:\\+${buildIdentifier}(?:\\.${buildIdentifier})*)?$`,
);

if (!tag.startsWith("v") || !semanticVersion.test(tag.slice(1)))
  throw new Error("Release tag must contain a valid Semantic Version after 'v'.");
if (!semanticVersion.test(manifest.version))
  throw new Error(`Package version is not valid Semantic Versioning: ${manifest.version}.`);
if (tag !== `v${manifest.version}`)
  throw new Error(`Release tag ${tag} does not match package version ${manifest.version}.`);
if (!manifest.license || manifest.license === "UNLICENSED")
  throw new Error("An approved public package license is required before publication.");

stdout.write(`Publish contract validated: ${manifest.name}@${manifest.version} (${tag}).\n`);

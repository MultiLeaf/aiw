import { readFileSync } from "node:fs";
import { argv, stdout } from "node:process";
import { URL } from "node:url";

const tagArgument = argv.slice(2).find((value) => value.startsWith("--tag="));
const tag = tagArgument?.slice("--tag=".length) ?? "";
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag))
  throw new Error("Release tag must use the version form vX.Y.Z.");
if (tag !== `v${manifest.version}`)
  throw new Error(`Release tag ${tag} does not match package version ${manifest.version}.`);
if (!manifest.license || manifest.license === "UNLICENSED")
  throw new Error("An approved public package license is required before publication.");

stdout.write(`Publish contract validated: ${manifest.name}@${manifest.version} (${tag}).\n`);

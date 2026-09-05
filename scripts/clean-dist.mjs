import { rmSync } from "node:fs";
import { URL } from "node:url";

const distributionDirectory = new URL("../dist/", import.meta.url);
rmSync(distributionDirectory, { recursive: true, force: true });

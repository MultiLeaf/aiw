import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { FileSystem } from "./types.js";
export const nodeFileSystem: FileSystem = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf8"),
  write: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  list: (path) => readdirSync(path).sort(),
  listFiles: (path) =>
    readdirSync(path, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath.slice(path.length + 1), entry.name))
      .sort(),
  remove: unlinkSync,
};

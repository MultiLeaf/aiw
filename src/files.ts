import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  openSync,
  closeSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { FileSystem } from "./types.js";
export const nodeFileSystem: FileSystem = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf8"),
  readBytes: (path) => readFileSync(path),
  write: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
  createExclusive: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    try {
      const descriptor = openSync(path, "wx");
      try {
        writeFileSync(descriptor, content);
      } finally {
        closeSync(descriptor);
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  writeBytes: (path, content) => {
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
  pathType: (path) => {
    try {
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) return "symlink";
      if (entry.isFile()) return "file";
      if (entry.isDirectory()) return "directory";
      return "other";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw error;
    }
  },
  realpath: realpathSync,
};

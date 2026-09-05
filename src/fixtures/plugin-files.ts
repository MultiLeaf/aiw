import type { FileSystem } from "../types.js";
import { dirname } from "node:path";

export type MemoryFileSystem = FileSystem & { snapshot(): Record<string, string> };

export function memoryFileSystem(initial: Record<string, string> = {}): MemoryFileSystem {
  const files = new Map(Object.entries(initial));
  const directories = new Set<string>();
  const addDirectory = (path: string): void => {
    let current = path;
    while (!directories.has(current)) {
      directories.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  };
  [...files.keys()].forEach((path) => addDirectory(dirname(path)));
  return {
    exists: (path) => files.has(path) || directories.has(path),
    read: (path): string => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`Missing file: ${path}`);
      return content;
    },
    write: (path, content): void => {
      addDirectory(dirname(path));
      files.set(path, content);
    },
    mkdir: (path) => addDirectory(path),
    pathType: (path) =>
      files.has(path) ? "file" : directories.has(path) ? "directory" : "missing",
    realpath: (path) => path,
    snapshot: () => Object.fromEntries([...files.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

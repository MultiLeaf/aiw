import type { FileSystem } from "../types.js";

export type MemoryFileSystem = FileSystem & { snapshot(): Record<string, string> };

export function memoryFileSystem(initial: Record<string, string> = {}): MemoryFileSystem {
  const files = new Map(Object.entries(initial));
  return {
    exists: (path) => files.has(path),
    read: (path): string => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`Missing file: ${path}`);
      return content;
    },
    write: (path, content) => void files.set(path, content),
    mkdir: () => undefined,
    snapshot: () => Object.fromEntries([...files.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

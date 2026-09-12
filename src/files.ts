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
  rmdirSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
    let descriptor: number | undefined;
    let created = false;
    try {
      descriptor = openSync(path, "wx");
      created = true;
      writeFileSync(descriptor, content);
      closeSync(descriptor);
      descriptor = undefined;
      return true;
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // Keep the original creation/write error as the primary failure.
        }
      }
      if (created) {
        try {
          unlinkSync(path);
        } catch {
          // Keep the original creation/write error as the primary failure.
        }
      }
      if (!created && (error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  mkdirExclusive: (path) => {
    try {
      mkdirSync(path);
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
  removeDirectory: rmdirSync,
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

export type ProjectFileWrite = { path: string; content: string };

/** Apply project containment and symlink checks to every workflow filesystem mutation. */
export function withSafeProjectWrites(fs: FileSystem, projectRoot: string): FileSystem {
  const safeMutation = (path: string): void => assertSafeProjectPath(fs, projectRoot, path);
  return {
    ...fs,
    write: (path: string, content: string): void => {
      safeMutation(path);
      fs.write(path, content);
    },
    mkdir: (path: string): void => {
      safeMutation(path);
      fs.mkdir(path);
    },
    ...(fs.writeBytes
      ? {
          writeBytes: (path: string, content: Uint8Array): void => {
            safeMutation(path);
            fs.writeBytes?.(path, content);
          },
        }
      : {}),
    ...(fs.mkdirExclusive
      ? {
          mkdirExclusive: (path: string): boolean => {
            safeMutation(path);
            return fs.mkdirExclusive?.(path) ?? false;
          },
        }
      : {}),
    ...(fs.createExclusive
      ? {
          createExclusive: (path: string, content: string): boolean => {
            safeMutation(path);
            return fs.createExclusive?.(path, content) ?? false;
          },
        }
      : {}),
    ...(fs.remove
      ? {
          remove: (path: string): void => {
            safeMutation(path);
            fs.remove?.(path);
          },
        }
      : {}),
    ...(fs.removeDirectory
      ? {
          removeDirectory: (path: string): void => {
            safeMutation(path);
            fs.removeDirectory?.(path);
          },
        }
      : {}),
  };
}

/** Reject writes that escape the project or cross any existing/dangling symbolic link. */
export function assertSafeProjectPath(
  fs: FileSystem,
  projectRoot: string,
  destination: string,
): void {
  const root = resolve(projectRoot);
  const path = resolve(destination);
  if (!isInside(root, path)) throw new Error(`Path must stay inside the project: ${destination}`);
  if (!fs.pathType)
    throw new Error("Filesystem cannot safely verify symbolic links for project writes.");

  const rootType = fs.pathType(root);
  if (rootType !== "directory") throw new Error(`Project root is not a safe directory: ${root}`);
  const canonicalRoot = fs.realpath?.(root) ?? root;
  let current = path;
  while (isInside(root, current)) {
    const type = fs.pathType(current);
    if (type === "symlink")
      throw new Error(`Project path cannot traverse a symbolic link: ${current}`);
    if (type !== "missing") {
      const canonicalPath = fs.realpath?.(current) ?? current;
      if (!isInside(canonicalRoot, canonicalPath))
        throw new Error(`Project path resolves outside the project: ${current}`);
    }
    if (current === root) return;
    current = dirname(current);
  }
  throw new Error(`Path must stay inside the project: ${destination}`);
}

/** Create a set of new project files as one rollback-capable transaction. */
export function writeProjectFilesAtomically(
  fs: FileSystem,
  projectRoot: string,
  writes: readonly ProjectFileWrite[],
  requiredDirectories: readonly string[] = [],
): void {
  if (
    !fs.pathType ||
    !fs.mkdirExclusive ||
    !fs.createExclusive ||
    !fs.remove ||
    !fs.removeDirectory
  )
    throw new Error("Filesystem does not support safe atomic project installation.");

  const root = resolve(projectRoot);
  const uniquePaths = new Set<string>();
  const directories = new Set<string>();
  for (const directoryPath of requiredDirectories) {
    const directory = resolve(directoryPath);
    assertSafeProjectPath(fs, root, directory);
    if (fs.pathType(directory) !== "directory" && fs.pathType(directory) !== "missing")
      throw new Error(`Installation directory is obstructed: ${directory}`);
    let current = directory;
    while (current !== root) {
      directories.add(current);
      const parent = dirname(current);
      if (parent === current || !isInside(root, parent))
        throw new Error(`Installation directory must stay inside the project: ${current}`);
      current = parent;
    }
  }
  for (const { path } of writes) {
    const destination = resolve(path);
    assertSafeProjectPath(fs, root, destination);
    if (uniquePaths.has(destination))
      throw new Error(`Duplicate installation path: ${destination}`);
    uniquePaths.add(destination);
    let directory = dirname(destination);
    while (directory !== root) {
      assertSafeProjectPath(fs, root, directory);
      directories.add(directory);
      const parent = dirname(directory);
      if (parent === directory || !isInside(root, parent))
        throw new Error(`Installation directory must stay inside the project: ${directory}`);
      directory = parent;
    }
    if (fs.pathType(destination) !== "missing")
      throw new Error(`Installation path appeared or already exists: ${destination}`);
  }

  const orderedDirectories = [...directories].sort(
    (a, b) => relative(root, a).split(sep).length - relative(root, b).split(sep).length,
  );
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];
  try {
    for (const directory of orderedDirectories) {
      const type = fs.pathType(directory);
      if (type === "directory") continue;
      if (type !== "missing") throw new Error(`Installation directory is obstructed: ${directory}`);
      assertSafeProjectPath(fs, root, directory);
      if (!fs.mkdirExclusive(directory))
        throw new Error(`Installation directory appeared during install: ${directory}`);
      createdDirectories.push(directory);
    }
    for (const { path, content } of writes) {
      const destination = resolve(path);
      assertSafeProjectPath(fs, root, destination);
      if (fs.pathType(destination) !== "missing")
        throw new Error(`Installation path appeared during install: ${destination}`);
      if (!fs.createExclusive(destination, content))
        throw new Error(`Installation file appeared during install: ${destination}`);
      createdFiles.push(destination);
    }
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const path of createdFiles.reverse()) {
      try {
        if (fs.pathType(path) === "file") fs.remove(path);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    for (const path of createdDirectories.reverse()) {
      try {
        if (fs.pathType(path) === "directory") fs.removeDirectory(path);
      } catch (cleanupError) {
        if (!["ENOTEMPTY", "EEXIST"].includes((cleanupError as NodeJS.ErrnoException).code ?? ""))
          cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Install failed and rollback was incomplete.",
        { cause: error },
      );
    throw error;
  }
}

function isInside(root: string, destination: string): boolean {
  const path = relative(root, destination);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export const nodeFileSystem = {
    exists: existsSync,
    read: (path) => readFileSync(path, "utf8"),
    write: (path, content) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
    },
    mkdir: (path) => mkdirSync(path, { recursive: true }),
};

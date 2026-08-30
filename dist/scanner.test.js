import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "./scanner.js";
async function fixture() {
    return mkdtemp(join(tmpdir(), "aiw-scanner-"));
}
describe("project scanner", () => {
    it("returns deterministic structural facts without reading file contents", async () => {
        const root = await fixture();
        await writeFile(join(root, "package.json"), '{"scripts":{"test":"vitest"}}');
        await writeFile(join(root, "eslint.config.js"), "export default [];");
        await mkdir(join(root, "src"));
        await writeFile(join(root, "src", "main.ts"), "const secret = 'do-not-return';");
        const result = await scanProject(root);
        expect(result.files).toEqual(["eslint.config.js", "package.json", "src/main.ts"]);
        expect(result.files.join(" ")).not.toContain("do-not-return");
        expect(result.evidence).toEqual(expect.arrayContaining([
            { fact: "language.typescript", source: "src/main.ts" },
            { fact: "tool.eslint", source: "eslint.config.js" },
            { fact: "package-manager.npm", source: "package.json" },
        ]));
    });
    it("respects gitignore patterns and excludes sensitive files", async () => {
        const root = await fixture();
        await writeFile(join(root, ".gitignore"), "dist\n*.log\n");
        await mkdir(join(root, "dist"));
        await writeFile(join(root, "dist", "bundle.js"), "generated");
        await writeFile(join(root, "debug.log"), "private");
        await writeFile(join(root, ".env"), "TOKEN=secret");
        await writeFile(join(root, "README.md"), "Project");
        const result = await scanProject(root);
        expect(result.files).toEqual([".gitignore", "README.md"]);
    });
    it("does not escape the project root through symbolic links", async () => {
        const root = await fixture();
        await writeFile(join(root, "README.md"), "Project");
        const result = await scanProject(root);
        expect(result.files.every((file) => !file.startsWith(".."))).toBe(true);
    });
});

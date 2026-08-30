import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileProject } from "./profile.js";
async function fixture() {
    return mkdtemp(join(tmpdir(), "aiw-profile-"));
}
describe("project profile", () => {
    it("detects runtime, tools, framework, CI, and workspace evidence", async () => {
        const root = await fixture();
        await writeFile(join(root, "package.json"), JSON.stringify({
            scripts: {
                test: "vitest",
                lint: "eslint .",
                format: "prettier --write .",
                typecheck: "tsc --noEmit",
            },
            dependencies: { next: "latest", react: "latest" },
            devDependencies: {
                vitest: "latest",
                eslint: "latest",
                prettier: "latest",
                typescript: "latest",
            },
            workspaces: ["apps/*"],
        }));
        await writeFile(join(root, "tsconfig.json"), "{}");
        await mkdir(join(root, "src"));
        await writeFile(join(root, "src", "main.ts"), "export {};");
        await mkdir(join(root, ".github/workflows"), { recursive: true });
        await writeFile(join(root, ".github/workflows/ci.yml"), "name: CI");
        const profile = await profileProject(root);
        expect(profile.runtime.languages).toContain("typescript");
        expect(profile.frameworks).toContain("nextjs");
        expect(profile.packageManager).toBe("npm");
        expect(profile.quality.linter?.name).toBe("eslint");
        expect(profile.quality.formatter?.name).toBe("prettier");
        expect(profile.testing?.name).toBe("vitest");
        expect(profile.ci).toContain("github-actions");
        expect(profile.workspaces).toEqual(["apps/*"]);
    });
    it("returns an explicit unknown profile for an empty project", async () => {
        const profile = await profileProject(await fixture());
        expect(profile.runtime.languages).toEqual([]);
        expect(profile.frameworks).toEqual([]);
        expect(profile.packageManager).toBe("unknown");
    });
});

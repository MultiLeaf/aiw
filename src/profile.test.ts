import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProjectProfile, profileProject } from "./profile.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-profile-"));
}

describe("project profile", () => {
  it("detects runtime, tools, framework, CI, and workspace evidence", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
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
      }),
    );
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

  it("profiles nested monorepo projects independently and aggregates their technology signals", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "workspace-root", workspaces: ["apps/*", "packages/*"] }),
    );
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await mkdir(join(root, "apps/api/src"), { recursive: true });
    await mkdir(join(root, "apps/api/prisma"), { recursive: true });
    await writeFile(
      join(root, "apps/api/package.json"),
      JSON.stringify({
        name: "api",
        scripts: { test: "jest --runInBand" },
        dependencies: { "@nestjs/core": "latest", "@prisma/client": "latest" },
        devDependencies: { prisma: "latest", jest: "latest", typescript: "latest" },
      }),
    );
    await writeFile(join(root, "apps/api/src/main.ts"), "export {};");
    await writeFile(join(root, "apps/api/prisma/schema.prisma"), "generator client {}");
    await mkdir(join(root, "apps/web/src"), { recursive: true });
    await writeFile(
      join(root, "apps/web/package.json"),
      JSON.stringify({
        name: "web",
        scripts: { test: "vitest run" },
        dependencies: { react: "latest" },
        devDependencies: { vite: "latest", vitest: "latest", typescript: "latest" },
      }),
    );
    await writeFile(join(root, "apps/web/src/main.tsx"), "export {};");

    const profile = await profileProject(root);

    expect(profile.frameworks).toEqual(
      expect.arrayContaining(["nestjs", "prisma", "react", "vite"]),
    );
    expect(profile.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "apps/api",
          name: "api",
          frameworks: ["nestjs", "prisma"],
          testing: { name: "jest", command: "jest --runInBand" },
        }),
        expect.objectContaining({
          path: "apps/web",
          name: "web",
          frameworks: ["react", "vite"],
          testing: { name: "vitest", command: "vitest run" },
        }),
      ]),
    );
    expect(profile.modules?.find(({ path }) => path === "apps/api")?.runtime.languages).toContain(
      "typescript",
    );
    expect(profile.modules?.find(({ path }) => path === "apps/web")?.runtime.languages).toContain(
      "typescript",
    );
  });

  it("prioritizes confirmed facts in a persisted profile", () => {
    const profile = parseProjectProfile(
      "schema: 1\nstatus: scanned\nfacts:\n  - key: package-manager\n    value: pnpm\n    state: confirmed\n    method: user-confirmed\n    confidence: 1\n    evidence: []\nruntime:\n  languages: [typescript]\nframeworks: []\npackage_manager: npm\nquality:\n  linter: eslint\n  linter_command: pnpm lint\n  formatter: unknown\n  formatter_command: unknown\n  typecheck: unknown\n  typecheck_command: unknown\ntesting: unknown\ntesting_command: unknown\nci: []\nworkspaces: []\n",
    );
    expect(profile.packageManager).toBe("pnpm");
    expect(profile.quality.linter?.command).toBe("pnpm lint");
  });
});

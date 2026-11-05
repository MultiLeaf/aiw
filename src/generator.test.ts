import { describe, expect, it } from "vitest";
import { generateProjectResources, type ResourceWriter } from "./generator.js";
import type { ProjectProfile } from "./profile.js";

const profile: ProjectProfile = {
  runtime: { languages: ["typescript"] },
  frameworks: ["nextjs"],
  packageManager: "npm",
  quality: {
    linter: { name: "eslint", command: "npm run lint" },
    formatter: { name: "prettier", command: "npm run format" },
  },
  testing: { name: "vitest", command: "npm test" },
  ci: ["github-actions"],
  workspaces: [],
  facts: [],
};

describe("project resource generator", () => {
  it("generates English project-specific rules and agent context", () => {
    const files = new Map<string, string>();
    const writer: ResourceWriter = (path, content) => {
      files.set(path, content);
    };
    generateProjectResources(
      profile,
      ["typescript-quality", "tdd-development", "react-best-practices"],
      writer,
    );
    expect(files.get("generated/rules/project-quality.md")).toContain("npm run lint");
    expect(files.get("generated/rules/project-quality.md")).toContain("TypeScript");
    expect(files.get("generated/agents/project-context.md")).toContain("Next.js");
    expect([...files.values()].every((content) => /[A-Za-z]/.test(content))).toBe(true);
  });

  it("generates only selected capability resources", () => {
    const paths: string[] = [];
    generateProjectResources(profile, ["typescript-quality"], (path) => paths.push(path));
    expect(paths).toEqual([
      "generated/rules/project-quality.md",
      "generated/context/project-profile.md",
      "generated/context/root-context.md",
      "generated/hooks/quality-check.md",
    ]);
  });

  it("does not invent unavailable commands", () => {
    const contents: string[] = [];
    generateProjectResources(
      { ...profile, quality: {}, testing: undefined },
      ["typescript-quality"],
      (_path, content) => contents.push(content),
    );
    expect(contents.join("\n")).not.toContain("npm run lint");
    expect(contents.join("\n")).not.toContain("npm test");
  });

  it("emits a semantic-retrieval-first rule when semantic retrieval is available", () => {
    const paths: string[] = [];
    generateProjectResources(profile, ["typescript-quality"], (path) => paths.push(path), true);
    const rule = paths.find((path) => path === "generated/rules/semantic-retrieval.md");
    expect(rule).toBeDefined();
    const contents: string[] = [];
    generateProjectResources(
      profile,
      ["typescript-quality"],
      (path, content) => {
        if (path === "generated/rules/semantic-retrieval.md") contents.push(content);
      },
      true,
    );
    expect(contents.join("\n")).toContain("aiw semantic query");
    expect(contents.join("\n")).toMatch(/grep|rg/);
  });

  it("omits the semantic-retrieval rule when semantic mapping is disabled", () => {
    const paths: string[] = [];
    generateProjectResources(profile, ["typescript-quality"], (path) => paths.push(path));
    expect(paths).not.toContain("generated/rules/semantic-retrieval.md");
    generateProjectResources(profile, ["typescript-quality"], (path) => paths.push(path), false);
    expect(paths).not.toContain("generated/rules/semantic-retrieval.md");
  });

  it("uses distinct test commands from monorepo workspaces", () => {
    const contents: string[] = [];
    const monorepo: ProjectProfile = {
      ...profile,
      testing: undefined,
      modules: [
        {
          path: "apps/api",
          runtime: { languages: ["typescript"] },
          frameworks: ["nestjs"],
          packageManager: "pnpm",
          quality: {},
          testing: { name: "jest", command: "pnpm --filter api test" },
        },
        {
          path: "apps/web",
          runtime: { languages: ["typescript"] },
          frameworks: ["vite", "react"],
          packageManager: "pnpm",
          quality: {},
          testing: { name: "vitest", command: "pnpm --filter web test" },
        },
      ],
    };
    generateProjectResources(monorepo, ["tdd-development"], (_path, content) =>
      contents.push(content),
    );
    expect(contents.join("\n")).toContain(
      "workspace apps/api test command `pnpm --filter api test`",
    );
    expect(contents.join("\n")).toContain(
      "workspace apps/web test command `pnpm --filter web test`",
    );
  });
});

// ---- evaluator proposal materialization (TASK-006) ----

import { generateProposalResource } from "./generator.js";
import type { ProposalRecord } from "./eval/types.js";

const proposal = (overrides: Partial<ProposalRecord> = {}): ProposalRecord => ({
  id: "prop-001",
  kind: "rule",
  origin: "onboarding",
  signature: "gradle-test-before-done",
  status: "approved",
  title: "Run Gradle tests before completing",
  outline: "Require ./gradlew test before any task completion.",
  evidence: ["fact-001"],
  occurrences: 3,
  lastSeq: 3,
  rejectReason: null,
  rejectedAtOccurrences: null,
  provenance: "evaluator/run-1",
  ...overrides,
});

describe("evaluator proposal materialization", () => {
  it("writes approved proposals under generated/ with provenance frontmatter (REQ-006)", () => {
    const files = new Map<string, string>();
    generateProposalResource(proposal(), (path, content) => files.set(path, content));
    const path = "generated/rules/gradle-test-before-done.md";
    expect(files.get(path)).toContain("provenance: aiw-evaluator");
    expect(files.get(path)).toContain("proposal: prop-001");
    expect(files.get(path)).toContain("Run Gradle tests before completing");
    expect(files.get(path)).toContain("./gradlew test");
  });

  it("routes kinds to their resource directories", () => {
    const paths: string[] = [];
    generateProposalResource(proposal({ kind: "skill", signature: "sig-s" }), (path) =>
      paths.push(path),
    );
    generateProposalResource(proposal({ kind: "agent", signature: "sig-a" }), (path) =>
      paths.push(path),
    );
    expect(paths).toEqual(["generated/skills/sig-s.md", "generated/agents/sig-a.md"]);
  });

  it("refuses to materialize proposals that are not approved (REQ-004)", () => {
    const paths: string[] = [];
    expect(() =>
      generateProposalResource(proposal({ status: "proposed" }), (path) => paths.push(path)),
    ).toThrow(/approved/);
    expect(paths).toEqual([]);
  });
});

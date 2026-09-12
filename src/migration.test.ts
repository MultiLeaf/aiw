import { describe, expect, it } from "vitest";
import {
  parseMigrationSnapshots,
  planNeutralResourceMigration,
  serializeMigrationPreview,
  serializeMigrationSnapshots,
  validateNeutralResourceDocument,
} from "./migration.js";

describe("neutral resource migration", () => {
  it("maps every neutral resource category through the target adapter", () => {
    const files = [
      "skills/review/SKILL.md",
      "rules/quality/quality.md",
      "agents/reviewer/reviewer.md",
      "hooks/check/check.md",
      "templates/spec/spec.md",
      "skills/ai-init.md",
    ];
    const plan = planNeutralResourceMigration("/project/.aiw/resources", files, "claude");
    expect(plan.migrations.map(({ destination }) => destination)).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/aiw/hooks/check.md",
      ".claude/aiw/templates/spec.md",
      ".claude/rules/quality.md",
      ".claude/skills/review/SKILL.md",
    ]);
  });

  it("reports unsupported files instead of silently ignoring them", () => {
    const plan = planNeutralResourceMigration(
      "/resources",
      ["README.md", "skills/x/notes.md", "skills/../outside/SKILL.md"],
      "codex",
    );
    expect(plan.migrations).toEqual([]);
    expect(plan.diagnostics).toHaveLength(3);
  });

  it("validates UTF-8 markdown and malformed skill frontmatter without returning content", () => {
    expect(
      validateNeutralResourceDocument("skills/good/SKILL.md", Buffer.from("# Good skill\n")),
    ).toBeUndefined();
    expect(
      validateNeutralResourceDocument(
        "skills/bad/SKILL.md",
        Buffer.concat([Buffer.from("# Secret title\n"), Buffer.from([0xff])]),
      ),
    ).toBe("resource is not valid UTF-8");
    expect(
      validateNeutralResourceDocument(
        "skills/bad/SKILL.md",
        Buffer.from("---\nname: bad\n---\n# Bad\n"),
      ),
    ).toContain("description");
    expect(validateNeutralResourceDocument("rules/empty/empty.md", Buffer.from(""))).toContain(
      "heading",
    );
  });

  it("serializes deterministic previews and reversible snapshots", () => {
    const migrations = [
      {
        source: "/neutral/a",
        destination: ".target/a",
        type: "skills" as const,
        id: "a",
        neutralSource: false,
      },
      {
        source: "/neutral/b",
        destination: ".target/b",
        type: "rules" as const,
        id: "b",
        neutralSource: false,
      },
    ];
    expect(serializeMigrationPreview("claude", migrations, [".target/b"], [".old/a"])).toBe(
      "Migration preview for claude:\nadd: .target/a\nupdate: .target/b\nremove: .old/a\n",
    );
    const snapshots = [
      { path: ".target/a", existed: false, contentBase64: "" },
      { path: ".target/b", existed: true, contentBase64: "YmluYXJ5AP9jb250ZW50" },
    ];
    expect(parseMigrationSnapshots(serializeMigrationSnapshots(snapshots))).toEqual(snapshots);
  });
});

import { describe, expect, it } from "vitest";
import {
  parseMigrationSnapshots,
  planNeutralResourceMigration,
  serializeMigrationPreview,
  serializeMigrationSnapshots,
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
    expect(plan.map(({ destination }) => destination)).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/aiw/hooks/check.md",
      ".claude/aiw/templates/spec.md",
      ".claude/rules/quality.md",
      ".claude/skills/review/SKILL.md",
    ]);
  });

  it("ignores files outside the neutral resource contract", () => {
    expect(
      planNeutralResourceMigration("/resources", ["README.md", "skills/x/notes.md"], "codex"),
    ).toEqual([]);
  });

  it("serializes deterministic previews and reversible snapshots", () => {
    const migrations = [
      { source: "/neutral/a", destination: ".target/a" },
      { source: "/neutral/b", destination: ".target/b" },
    ];
    expect(serializeMigrationPreview("claude", migrations, [".target/b"])).toBe(
      "Migration preview for claude:\nadd: .target/a\nupdate: .target/b\nremove: previous target ai-init\n",
    );
    const snapshots = [
      { path: "/target/a", existed: false, content: "" },
      { path: "/target/b", existed: true, content: "binary\u0000content" },
    ];
    expect(parseMigrationSnapshots(serializeMigrationSnapshots(snapshots))).toEqual(snapshots);
  });
});

import { describe, expect, it } from "vitest";
import { buildVercelSkillsCommand } from "./vercel-skills.js";

describe("Vercel Skills provider", () => {
  it("builds safe discovery and inspection commands", () => {
    expect(buildVercelSkillsCommand({ command: "find", skill: "react" })).toEqual([
      "npx",
      "skills",
      "find",
      "react",
    ]);
    expect(buildVercelSkillsCommand({ command: "check" })).toEqual(["npx", "skills", "check"]);
  });

  it("builds explicit installation commands with source and target", () => {
    expect(
      buildVercelSkillsCommand({
        command: "add",
        source: "vercel-labs/agent-skills",
        skill: "react",
        agent: "codex",
      }),
    ).toEqual([
      "npx",
      "skills",
      "add",
      "vercel-labs/agent-skills",
      "--skill",
      "react",
      "--agent",
      "codex",
      "--yes",
    ]);
    expect(() => buildVercelSkillsCommand({ command: "add" })).toThrow("source is required");
  });
});

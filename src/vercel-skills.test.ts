import { describe, expect, it } from "vitest";
import {
  buildVercelSkillsCommand,
  executeVercelSkills,
  installVercelSkill,
} from "./vercel-skills.js";

describe("Vercel Skills provider", () => {
  it("builds safe discovery and inspection commands", () => {
    expect(buildVercelSkillsCommand({ command: "find", skill: "react" })).toEqual([
      "npx",
      "skills",
      "find",
      "react",
    ]);
    expect(buildVercelSkillsCommand({ command: "check" })).toEqual(["npx", "skills", "check"]);
    expect(
      buildVercelSkillsCommand({ command: "inspect", source: "vercel-labs/agent-skills" }),
    ).toEqual(["npx", "skills", "add", "vercel-labs/agent-skills", "--list"]);
  });

  it("builds explicit installation commands with source and target", () => {
    expect(
      buildVercelSkillsCommand({
        command: "add",
        source: "vercel-labs/agent-skills",
        skill: "vercel-react-best-practices",
        agent: "codex",
      }),
    ).toEqual([
      "npx",
      "skills",
      "add",
      "vercel-labs/agent-skills@vercel-react-best-practices",
      "--agent",
      "codex",
      "--yes",
    ]);
    expect(() => buildVercelSkillsCommand({ command: "add" })).toThrow("source is required");
  });

  it("executes installation through an injected executor", async () => {
    const calls: string[][] = [];
    await installVercelSkill(
      {
        execute: async (command) => {
          calls.push(command);
          return { stdout: "installed", exitCode: 0 };
        },
      },
      "vercel-labs/agent-skills",
      "vercel-react-best-practices",
      "codex",
    );
    expect(calls[0]).toEqual([
      "npx",
      "skills",
      "add",
      "vercel-labs/agent-skills@vercel-react-best-practices",
      "--agent",
      "codex",
      "--yes",
    ]);
  });

  it("treats failure text from upstream updates as a failure", async () => {
    await expect(
      executeVercelSkills(
        { execute: async () => ({ stdout: "Failed to update 1 skill(s)", exitCode: 0 }) },
        { command: "update" },
      ),
    ).rejects.toThrow("Vercel Skills update failed");
  });
});

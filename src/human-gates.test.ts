import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { renderAiInit } from "./adapter.js";

const stageSkills = [
  "brainstorming",
  "requirements-specification",
  "technical-design",
  "implementation-planning",
  "tdd-development",
  "verification",
  "code-review",
];

describe("human approval gates", () => {
  it.each(stageSkills)("requires an explicit human checkpoint in %s", async (skill) => {
    const content = await readFile(
      new URL(`../resources/skills/${skill}.md`, import.meta.url),
      "utf8",
    );

    expect(content).toMatch(/human/i);
    expect(content).toMatch(/approv/i);
    expect(content).toMatch(/wait/i);
  });

  it("does not treat silence or an ambiguous choice as consent to scan or install", () => {
    const bootstrap = renderAiInit("codex");
    expect(bootstrap).toContain("silence, or ambiguous answer means no consent");
    expect(bootstrap).toContain("Do not run a selection command or install anything until");
    expect(bootstrap).toContain("Only after a later explicit approval");
    expect(bootstrap).toContain("--approve-plan=<fingerprint>");
    expect(bootstrap).toContain("separate approval");
  });
});

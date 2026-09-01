import { describe, expect, it } from "vitest";
import { renderResourcePath } from "./adapter.js";

describe("GitHub Copilot adapter", () => {
  it("maps resources to Copilot-owned paths", () => {
    expect(renderResourcePath("copilot", "skills", "brainstorm")).toBe(
      ".github/copilot/brainstorm/SKILL.md",
    );
    expect(renderResourcePath("copilot", "rules", "quality")).toContain(
      ".github/copilot/rules/quality",
    );
  });
});

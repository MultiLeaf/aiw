import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validatePackageContract } from "./package-contract.js";

const skills = ["review-judge-a", "review-judge-b", "review-refuter"] as const;

async function skill(name: (typeof skills)[number]): Promise<string> {
  return readFile(join("resources", "skills", `${name}.md`), "utf8");
}

describe("adversarial review package (OPP-003)", () => {
  it("declares the three skills in the valid self-hosting package manifest", async () => {
    const contract = validatePackageContract(
      await readFile(join("resources", "package.yaml"), "utf8"),
    );
    const ids = contract.resources.skills.map((entry) => entry.id);
    for (const name of skills) expect(ids).toContain(name);
  });

  it("keeps both judges blind: each forbids consulting the other's output", async () => {
    for (const name of ["review-judge-a", "review-judge-b"] as const) {
      const content = await skill(name);
      expect(content).toMatch(/without consulting|do not read/i);
      expect(content).toContain("file:line");
      expect(content).toMatch(/BLOCKER.*CRITICAL|CRITICAL.*BLOCKER/s);
    }
  });

  it("requires proof for severe findings in both judges", async () => {
    for (const name of ["review-judge-a", "review-judge-b"] as const) {
      const content = await skill(name);
      expect(content).toMatch(/reproducing command|file:line citations that prove/i);
      expect(content).toMatch(/cannot evidence are .?MINOR/i);
    }
  });

  it("gates refuter command execution behind explicit permission and marks its absence", async () => {
    const content = await skill("review-refuter");
    expect(content).toMatch(/only when.*explicitly granted/i);
    expect(content).toContain("no command executed");
    expect(content).toContain("isolated disposable directory");
    expect(content).toContain("no network access");
  });

  it("states the degradation rule: unevidenced severe findings become advisory", async () => {
    const content = await skill("review-refuter");
    expect(content).toMatch(/degrades? to .?advisory/i);
    expect(content).toMatch(/Only .?corroborated.?\s+severe findings may block/i);
  });

  it("keeps human acceptance of the review outcome", async () => {
    const content = await skill("review-refuter");
    expect(content).toMatch(/human still accepts/i);
  });

  it("limits refutation to corroborated, refuted, or inconclusive verdicts", async () => {
    const content = await skill("review-refuter");
    for (const verdict of ["corroborated", "refuted", "inconclusive"]) {
      expect(content).toContain(verdict);
    }
  });
});

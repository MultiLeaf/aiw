import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { UNKNOWN_COMMAND_SIGNATURE, commandWord, extractAiwCommands } from "./command-evidence.js";
import { run } from "./cli.js";

describe("command extraction", () => {
  it("extracts aiw invocations with command and subcommand", () => {
    const mentions = extractAiwCommands(
      "Run `aiw gate specification` then `aiw approve specification` to finish.",
    );
    expect(mentions.map((mention) => mention.command)).toEqual([
      "gate specification",
      "approve specification",
    ]);
  });

  it("extracts the npx form used by published docs", () => {
    const mentions = extractAiwCommands(
      "npx @multileaf/ai-workflow scan\nnpx @multileaf/ai-workflow workflow start",
    );
    expect(mentions.map((mention) => mention.command)).toEqual(["scan", "workflow start"]);
  });

  it("skips mid-prose invocations that are not backticked or line-leading", () => {
    const mentions = extractAiwCommands(
      "you can run npx @multileaf/ai-workflow scan anytime, or `npx @multileaf/ai-workflow verify`",
    );
    expect(mentions.map((mention) => mention.command)).toEqual(["verify"]);
  });

  it("ignores flags and keeps deduplicated command pairs", () => {
    const mentions = extractAiwCommands(
      "`aiw task start --ticket=TEAM-123` and again `aiw task start --title=x`",
    );
    expect(mentions.map((mention) => mention.command)).toEqual(["task start"]);
  });

  it("does not extract bare words or non-command prose", () => {
    expect(extractAiwCommands("The aiw tool helps; see also task management.")).toEqual([]);
  });
});

describe("emission equals usability (ratchet over shipped artifacts)", () => {
  it("every command named by generated skills and READMEs is a real command", async () => {
    const sources: { label: string; path: string }[] = [
      { label: "README.md", path: "README.md" },
      { label: "docs/README.md", path: "docs/README.md" },
    ];
    const skillDir = readdir("resources/skills");
    for (const entry of await skillDir) {
      if (entry.endsWith(".md"))
        sources.push({ label: `resources/skills/${entry}`, path: `resources/skills/${entry}` });
    }
    const mentions = (
      await Promise.all(
        sources.map(async (source) => ({
          label: source.label,
          text: await readFile(source.path, "utf8"),
        })),
      )
    ).flatMap((artifact) => extractAiwCommands(artifact.text, artifact.label));

    expect(mentions.length).toBeGreaterThan(20);

    const cwd = await mkdtemp(join(tmpdir(), "aiw-evidence-"));
    const distinctWords = [...new Set(mentions.map(commandWord))];
    const unrecognized: string[] = [];
    for (const word of distinctWords) {
      const result = await run([word], cwd);
      if ((result.output ?? result.error ?? "").includes(UNKNOWN_COMMAND_SIGNATURE)) {
        unrecognized.push(word);
      }
    }
    expect(unrecognized).toEqual([]);
  }, 30000);
});

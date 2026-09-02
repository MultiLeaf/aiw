export type TokenUsage = {
  stage: string;
  budget: number;
  used: number;
};

export function validateTokenUsage(usage: TokenUsage): TokenUsage {
  if (!usage.stage.trim()) throw new Error("Token usage stage must not be empty.");
  for (const [name, value] of [
    ["budget", usage.budget],
    ["used", usage.used],
  ] as const) {
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`Token ${name} must be a non-negative integer.`);
  }
  if (usage.used > usage.budget) throw new Error(`Token budget exceeded for stage: ${usage.stage}`);
  return usage;
}

export function parseTokenUsage(content: string): TokenUsage[] {
  if (!content.trim()) return [];
  return content
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [stage, budget, used] = line.split("|");
      return validateTokenUsage({ stage, budget: Number(budget), used: Number(used) });
    });
}

export function serializeTokenUsage(entries: TokenUsage[]): string {
  return (
    [
      "schema: 1",
      ...entries
        .sort((a, b) => a.stage.localeCompare(b.stage))
        .map((entry) => `${entry.stage}|${entry.budget}|${entry.used}`),
    ].join("\n") + "\n"
  );
}

export function recordTokenUsage(entries: TokenUsage[], usage: TokenUsage): TokenUsage[] {
  validateTokenUsage(usage);
  return [...entries.filter((entry) => entry.stage !== usage.stage), usage];
}

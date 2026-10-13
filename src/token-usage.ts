export type TokenUsage = {
  stage: string;
  budget: number;
  used: number;
  model?: string;
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
  if (usage.model !== undefined && (typeof usage.model !== "string" || !usage.model.trim()))
    throw new Error("Token usage model must be a non-empty string when present.");
  return usage;
}

export function parseTokenUsage(content: string): TokenUsage[] {
  if (!content.trim()) return [];
  return content
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [stage, budget, used, model] = line.split("|");
      return validateTokenUsage({
        stage,
        budget: Number(budget),
        used: Number(used),
        ...(model ? { model } : {}),
      });
    });
}

export function serializeTokenUsage(entries: TokenUsage[]): string {
  return (
    [
      "schema: 1",
      ...entries
        .sort((a, b) =>
          a.stage < b.stage
            ? -1
            : a.stage > b.stage
              ? 1
              : (a.model ?? "").localeCompare(b.model ?? ""),
        )
        .map(
          (entry) =>
            `${entry.stage}|${entry.budget}|${entry.used}${entry.model ? `|${entry.model}` : ""}`,
        ),
    ].join("\n") + "\n"
  );
}

export function recordTokenUsage(entries: TokenUsage[], usage: TokenUsage): TokenUsage[] {
  validateTokenUsage(usage);
  return [
    ...entries.filter((entry) => entry.stage !== usage.stage || entry.model !== usage.model),
    usage,
  ];
}

export function summarizeUsageByModel(entries: TokenUsage[]): {
  model: string;
  tokens: number;
  stages: string[];
}[] {
  const byModel = new Map<string, { tokens: number; stages: Set<string> }>();
  for (const entry of entries) {
    const model = entry.model ?? "unattributed";
    const bucket = byModel.get(model) ?? { tokens: 0, stages: new Set<string>() };
    bucket.tokens += entry.used;
    bucket.stages.add(entry.stage);
    byModel.set(model, bucket);
  }
  return [...byModel]
    .map(([model, { tokens, stages }]) => ({ model, tokens, stages: [...stages].sort() }))
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
}

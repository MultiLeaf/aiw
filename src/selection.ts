import type { CapabilityRecommendation } from "./recommendations.js";

export type Answer = (question: string) => Promise<string>;

export async function selectRecommendations(
  items: CapabilityRecommendation[],
  answer: Answer,
  selectedIds?: string[],
): Promise<string[]> {
  const available = new Set(
    items.flatMap((item) => [
      item.id,
      ...(item.resources ?? []).map(({ type, id }) => `${type}/${id}`),
    ]),
  );
  if (selectedIds?.includes("all")) return items.map(({ id }) => id);
  if (selectedIds) return [...new Set(selectedIds.filter((id) => available.has(id)))];
  const selected: string[] = [];
  for (const item of items) {
    const response = (await answer(`Install ${item.id}? [Y/n] `)).trim().toLowerCase();
    if (response === "" || response === "y" || response === "yes") selected.push(item.id);
  }
  return selected;
}

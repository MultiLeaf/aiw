import type { CapabilityRecommendation } from "./recommendations.js";

export type Answer = (question: string) => Promise<string>;

export async function selectRecommendations(
  items: CapabilityRecommendation[],
  answer: Answer,
  selectedIds?: string[],
): Promise<string[]> {
  if (selectedIds) return selectedIds.filter((id) => items.some((item) => item.id === id));
  const selected: string[] = [];
  for (const item of items) {
    const response = (await answer(`Install ${item.id}? [Y/n] `)).trim().toLowerCase();
    if (response === "" || response === "y" || response === "yes") selected.push(item.id);
  }
  return selected;
}

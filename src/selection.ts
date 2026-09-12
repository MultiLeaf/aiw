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
  available.add("vitest-testing");
  if (selectedIds?.includes("all")) return items.map(({ id }) => id);
  if (selectedIds)
    return includeRequirements(
      items,
      selectedIds
        .filter((id) => available.has(id))
        .map((id) => (id === "vitest-testing" ? "verification" : id)),
    );
  const selected: string[] = [];
  for (const item of items) {
    const response = (await answer(`Install ${item.id}? [Y/n] `)).trim().toLowerCase();
    if (response === "" || response === "y" || response === "yes") selected.push(item.id);
  }
  return includeRequirements(items, selected);
}

function includeRequirements(items: CapabilityRecommendation[], selectedIds: string[]): string[] {
  const selected = new Set(selectedIds);
  const byId = new Map(items.map((item) => [item.id, item]));
  const owners = new Map<string, string>();
  for (const item of items)
    for (const resource of item.resources ?? [])
      owners.set(`${resource.type}/${resource.id}`, item.id);

  const visit = (capabilityId: string, visited: Set<string>): void => {
    if (visited.has(capabilityId)) return;
    visited.add(capabilityId);
    const capability = byId.get(capabilityId);
    if (!capability) return;
    for (const requirement of capability.requires ?? []) {
      if (!byId.has(requirement)) continue;
      selected.add(requirement);
      visit(requirement, visited);
    }
  };

  const initial = [...selected];
  const visited = new Set<string>();
  for (const id of initial) visit(byId.has(id) ? id : (owners.get(id) ?? ""), visited);
  return [...selected];
}

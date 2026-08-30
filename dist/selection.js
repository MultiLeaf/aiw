export async function selectRecommendations(items, answer, selectedIds) {
    if (selectedIds)
        return selectedIds.filter((id) => items.some((item) => item.id === id));
    const selected = [];
    for (const item of items) {
        const response = (await answer(`Install ${item.id}? [Y/n] `)).trim().toLowerCase();
        if (response === "" || response === "y" || response === "yes")
            selected.push(item.id);
    }
    return selected;
}

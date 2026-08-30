export function serializeOverrides(overrides) {
    return `schema: 1\noverrides:\n${overrides.map((item) => `  - key: ${item.key}\n    action: ${item.action}${item.value ? `\n    value: ${item.value}` : ""}`).join("\n")}\n`;
}
export function parseOverrides(content) {
    const overrides = [];
    const blocks = content.split(/\n(?=\s{2}- key:)/).slice(1);
    for (const block of blocks) {
        const key = block.match(/key: (.+)/)?.[1]?.trim();
        const action = block.match(/action: (accept|reject|edit)/)?.[1];
        const value = block.match(/value: (.+)/)?.[1]?.trim();
        if (key && action)
            overrides.push({ key, action, ...(value ? { value } : {}) });
    }
    return overrides;
}
export function applyOverrides(facts, overrides) {
    return facts.flatMap((fact) => {
        const override = overrides.find((item) => item.key === fact.key);
        if (!override || override.action === "accept")
            return [
                {
                    ...fact,
                    ...(override ? { state: "confirmed", method: "user-confirmed" } : {}),
                },
            ];
        if (override.action === "reject")
            return [];
        if (!override.value)
            throw new Error(`An edited fact requires a value: ${fact.key}`);
        return [
            {
                ...fact,
                value: override.value,
                state: "confirmed",
                method: "user-confirmed",
                confidence: 1,
                evidence: [],
            },
        ];
    });
}

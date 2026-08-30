export function buildFacts(profile, detectedEvidence = []) {
    const facts = [];
    const add = (key, value) => {
        facts.push({
            key,
            value,
            state: "detected",
            method: "deterministic",
            confidence: 1,
            evidence: detectedEvidence
                .filter((item) => item.fact === key ||
                item.fact.endsWith(`.${value}`) ||
                (key === "tool.linter" && item.fact === "tool.eslint") ||
                (key === "tool.formatter" && item.fact === "tool.prettier") ||
                (key === "tool.testing" && item.fact === `tool.${value}`))
                .map((item) => ({ source: item.source, reason: "" })),
        });
    };
    profile.runtime.languages.forEach((language) => add("runtime.language", language));
    profile.frameworks.forEach((framework) => add("framework", framework));
    if (profile.packageManager !== "unknown")
        add("package-manager", profile.packageManager);
    if (profile.quality.linter)
        add("tool.linter", profile.quality.linter.name);
    if (profile.quality.formatter)
        add("tool.formatter", profile.quality.formatter.name);
    if (profile.testing)
        add("tool.testing", profile.testing.name);
    profile.ci.forEach((provider) => add("ci.provider", provider));
    profile.workspaces.forEach((workspace) => add("workspace", workspace));
    return facts;
}

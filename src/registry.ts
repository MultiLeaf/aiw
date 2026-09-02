export type RegistryPackage = {
  id: string;
  version: string;
  description: string;
  provider: "local" | "git" | "vercel-skills";
  source: string;
  permissions: string[];
};

export const CURATED_REGISTRY: readonly RegistryPackage[] = [
  {
    id: "multileaf/aiw-self-hosting",
    version: "0.1.0",
    description: "Core skills and policies for developing with AI Workflow.",
    provider: "local",
    source: "./resources",
    permissions: [],
  },
  {
    id: "vercel/react-best-practices",
    version: "latest",
    description: "React and Next.js performance guidance from Vercel.",
    provider: "vercel-skills",
    source: "vercel-labs/agent-skills@vercel-react-best-practices",
    permissions: ["network:external"],
  },
];

export function searchRegistry(query = ""): RegistryPackage[] {
  const normalized = query.trim().toLowerCase();
  return CURATED_REGISTRY.filter((pkg) =>
    [pkg.id, pkg.description, pkg.provider].some((field) =>
      field.toLowerCase().includes(normalized),
    ),
  ).map((pkg) => ({ ...pkg, permissions: [...pkg.permissions] }));
}

export function serializeRegistry(packages: readonly RegistryPackage[]): string {
  return packages
    .map(
      (pkg) =>
        `${pkg.id}@${pkg.version} [${pkg.provider}] permissions: ${pkg.permissions.join(",") || "none"} - ${pkg.description}`,
    )
    .join("\n");
}

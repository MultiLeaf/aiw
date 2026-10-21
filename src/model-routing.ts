import { parseDocument } from "yaml";

/**
 * Static model routing table — advisory, versioned, evidence-linked.
 *
 * Research consensus (docs/token-efficiency-study-notes.md §1 and §5):
 * optimal routing is usually static — per-request dynamism mostly adds
 * failure modes. Rules follow the ModelFit discipline: every recommendation
 * names the evidence behind it, execution is advisory only, and humans can
 * always override. The table never invokes a model; it answers "which model
 * should this category use, and why".
 */

export const ROUTING_TABLE_SCHEMA = 1;
export const ROUTING_TABLE_PATH = "routing.yml";
export const ROUTING_DEFAULT_UNSET = "unset";

export type RoutingRule = {
  category: string;
  model: string;
  /** Named evidence (benchmark, parity run, ADR) backing this rule. Empty means unevidenced. */
  evidence: string;
};

export type RoutingTable = {
  schema: number;
  default: string;
  rules: RoutingRule[];
};

export type ResolvedRoute = {
  category: string;
  model: string;
  matchedRule: boolean;
  evidence?: string;
  advisory: "evidenced" | "unevidenced-rule" | "default-fallback" | "default-unset";
};

const CATEGORY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

function validateRule(rule: RoutingRule): void {
  if (!CATEGORY_PATTERN.test(rule.category))
    throw new Error(`Routing category must be dot-separated kebab-case: ${rule.category}.`);
  if (!rule.model.trim()) throw new Error(`Routing rule for ${rule.category} needs a model.`);
}

export function validateRoutingTable(table: RoutingTable): RoutingTable {
  if (table.schema !== ROUTING_TABLE_SCHEMA)
    throw new Error(`Routing table schema must be version ${ROUTING_TABLE_SCHEMA}.`);
  if (!table.default.trim()) throw new Error("Routing table default model must not be empty.");
  table.rules.forEach(validateRule);
  const categories = table.rules.map((rule) => rule.category);
  if (new Set(categories).size !== categories.length)
    throw new Error("Routing table categories must be unique.");
  return table;
}

export function defaultRoutingTable(): RoutingTable {
  return validateRoutingTable({
    schema: ROUTING_TABLE_SCHEMA,
    default: ROUTING_DEFAULT_UNSET,
    rules: [],
  });
}

export function parseRoutingTable(content: string): RoutingTable {
  const document = parseDocument(content);
  if (document.errors.length) throw new Error("Routing table is not valid YAML.");
  const schema = document.get("schema");
  if (schema !== ROUTING_TABLE_SCHEMA)
    throw new Error(`Routing table schema must be version ${ROUTING_TABLE_SCHEMA}.`);
  const pick = (key: string): unknown => document.get(key);
  const rulesNode = pick("rules");
  const rules: RoutingRule[] = [];
  if (rulesNode !== null && rulesNode !== undefined) {
    const items = Array.isArray(rulesNode)
      ? rulesNode
      : typeof (rulesNode as { items?: unknown[] }).items === "object"
        ? ((rulesNode as { items: unknown[] }).items as unknown[])
        : undefined;
    if (items === undefined) throw new Error("Routing table rules must be a list.");
    for (const raw of items) {
      const read = (key: string): unknown =>
        typeof (raw as { get?: unknown }).get === "function"
          ? (raw as { get: (key: string) => unknown }).get(key)
          : (raw as Record<string, unknown>)[key];
      rules.push({
        category: String(read("category")),
        model: String(read("model")),
        evidence:
          read("evidence") === null || read("evidence") === undefined
            ? ""
            : String(read("evidence")),
      });
    }
  }
  return validateRoutingTable({
    schema: ROUTING_TABLE_SCHEMA,
    default: String(pick("default") ?? ""),
    rules,
  });
}

export function serializeRoutingTable(table: RoutingTable): string {
  validateRoutingTable(table);
  const lines = [`schema: ${table.schema}`, `default: ${table.default}`, "rules:"];
  if (!table.rules.length) lines.push("  []");
  for (const rule of table.rules) {
    lines.push(
      `  - category: ${rule.category}`,
      `    model: ${rule.model}`,
      `    evidence: ${rule.evidence ? JSON.stringify(rule.evidence) : '""'}`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Resolve a category to a model. Deterministic: same table, same category, same answer. */
export function resolveRoute(table: RoutingTable, category: string): ResolvedRoute {
  if (!CATEGORY_PATTERN.test(category))
    throw new Error(`Routing category must be dot-separated kebab-case: ${category}.`);
  const rule = table.rules.find((candidate) => candidate.category === category);
  if (rule)
    return {
      category,
      model: rule.model,
      matchedRule: true,
      ...(rule.evidence ? { evidence: rule.evidence } : {}),
      advisory: rule.evidence ? "evidenced" : "unevidenced-rule",
    };
  if (table.default === ROUTING_DEFAULT_UNSET)
    return { category, model: table.default, matchedRule: false, advisory: "default-unset" };
  return { category, model: table.default, matchedRule: false, advisory: "default-fallback" };
}

export function serializeResolvedRoute(route: ResolvedRoute): string {
  const advisoryText: Record<ResolvedRoute["advisory"], string> = {
    evidenced: `advisory: rule is evidence-backed (${route.evidence})`,
    "unevidenced-rule":
      "advisory: rule has no named evidence; benchmark it before trusting the routing",
    "default-fallback": "advisory: no rule for this category; fell back to the table default",
    "default-unset":
      "advisory: no rule for this category and the default is unset; a human must choose the model",
  };
  return [
    `category: ${route.category}`,
    `model: ${route.model}`,
    advisoryText[route.advisory],
  ].join("\n");
}

import { describe, expect, it } from "vitest";
import {
  defaultRoutingTable,
  parseRoutingTable,
  resolveRoute,
  serializeResolvedRoute,
  serializeRoutingTable,
  validateRoutingTable,
} from "./model-routing.js";
import type { RoutingTable } from "./model-routing.js";

const table: RoutingTable = {
  schema: 1,
  default: "sonnet",
  rules: [
    { category: "scan.interpreter", model: "llama3", evidence: "aiw scan (measured) 2026-10" },
    { category: "session.simple", model: "haiku", evidence: "" },
  ],
};

describe("model routing table", () => {
  it("validates rules, rejects duplicates and empty models", () => {
    expect(validateRoutingTable(table)).toEqual(table);
    expect(() =>
      validateRoutingTable({ ...table, rules: [...table.rules, { ...table.rules[0] }] }),
    ).toThrow(/unique/);
    expect(() =>
      validateRoutingTable({ ...table, rules: [{ category: "x", model: " ", evidence: "" }] }),
    ).toThrow(/needs a model/);
    expect(() => validateRoutingTable({ ...table, default: " " })).toThrow(/default/);
  });

  it("round-trips through serialize and parse", () => {
    const parsed = parseRoutingTable(serializeRoutingTable(table));
    expect(parsed).toEqual(table);
    expect(parseRoutingTable(serializeRoutingTable(defaultRoutingTable()))).toEqual(
      defaultRoutingTable(),
    );
    expect(() => parseRoutingTable("schema: 9\ndefault: x\nrules: []\n")).toThrow(/schema/);
  });

  it("resolves deterministically with honest advisory labels", () => {
    expect(resolveRoute(table, "scan.interpreter")).toEqual({
      category: "scan.interpreter",
      model: "llama3",
      matchedRule: true,
      evidence: "aiw scan (measured) 2026-10",
      advisory: "evidenced",
    });
    const unevidenced = resolveRoute(table, "session.simple");
    expect(unevidenced.advisory).toBe("unevidenced-rule");
    expect(serializeResolvedRoute(unevidenced)).toContain("no named evidence");
    expect(resolveRoute(table, "parity.task").advisory).toBe("default-fallback");
    expect(() => resolveRoute(table, "Invalid Category")).toThrow(/kebab-case/);
  });

  it("reports an unset default instead of inventing a model", () => {
    const unset = defaultRoutingTable();
    const route = resolveRoute(unset, "scan.embedding");
    expect(route.advisory).toBe("default-unset");
    expect(serializeResolvedRoute(route)).toContain("a human must choose");
  });
});

// ---- OPP-007: advisory routing categories ----

describe("OPP-007 routing categories", () => {
  it("resolves the findings-triage and lane-watch categories with evidence labeling (REQ-005)", () => {
    const table = parseRoutingTable(
      [
        "schema: 1",
        "default: clef-flash:latest",
        "rules:",
        "  - category: review.findings-triage",
        "    model: clef-flash:latest",
        "    evidence: docs/opportunities/OPP-007-decision-findings-triage-scope-watch.md",
        "  - category: workflow.lane-watch",
        "    model: clef-flash:latest",
      ].join("\n"),
    );
    const evidenced = resolveRoute(table, "review.findings-triage");
    expect(evidenced.advisory).toBe("evidenced");
    const unevidenced = resolveRoute(table, "workflow.lane-watch");
    expect(unevidenced.advisory).toBe("unevidenced-rule");
    // Without any routing.yml rules, the categories fall back safely.
    const fallback = resolveRoute(defaultRoutingTable(), "review.findings-triage");
    expect(fallback.advisory).toBe("default-unset");
  });
});

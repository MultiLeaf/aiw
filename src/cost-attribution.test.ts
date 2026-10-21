import { describe, expect, it } from "vitest";
import {
  computeCostAttribution,
  serializeCostAttribution,
  serializeTaskUsage,
  summarizeTaskUsage,
} from "./cost-attribution.js";
import { parseTraceabilityGraph, serializeTraceabilityGraph } from "./traceability.js";
import type { TraceabilityGraph } from "./traceability.js";
import type { UsageSidecarEntry } from "./usage-sidecar.js";

const entry = (over: Partial<UsageSidecarEntry>): UsageSidecarEntry => ({
  seq: 1,
  command: "session.implementation",
  label: "measured",
  tiers: { "cache-read": 1000, "fresh-input": 2000, "cache-write": 0, output: 500 },
  ...over,
});

const graph: TraceabilityGraph = {
  schema: 1,
  links: [
    {
      requirement: "REQ-001",
      decisions: [],
      tasks: ["TASK-001"],
      code: [],
      tests: ["unit"],
      evidence: ["npm test"],
    },
    { requirement: "REQ-002", decisions: [], tasks: [], code: [], tests: [], evidence: [] },
  ],
};

describe("cost attribution per verified requirement", () => {
  it("divides attributed tokens by verified requirements only", () => {
    const attribution = computeCostAttribution(
      [
        entry({ seq: 1, requirement: "REQ-001" }),
        entry({ seq: 2, requirement: "REQ-002" }), // unverified: no evidence
        entry({
          seq: 3,
          requirement: "REQ-001",
          label: "estimated",
          command: "session.verification",
        }),
        entry({ seq: 4 }), // unattributed
      ],
      graph,
    );
    expect(attribution.verifiedRequirements).toBe(1);
    expect(attribution.unverifiedRequirements).toBe(1);
    expect(attribution.tokensPerVerifiedRequirement).toBe(7000); // 3500 * 2 attributed to REQ-001
    expect(attribution.unattributedTokens).toBe(3500);
    expect(attribution.attributed[0]).toEqual({
      requirement: "REQ-001",
      tokens: 7000,
      label: "estimated", // one estimated entry poisons the requirement
      verified: true,
    });
  });

  it("marks requirements absent from the graph as unverified", () => {
    const attribution = computeCostAttribution([entry({ seq: 1, requirement: "REQ-999" })], graph);
    expect(attribution.attributed[0].verified).toBe(false);
    expect(attribution.tokensPerVerifiedRequirement).toBeUndefined();
  });

  it("propagates labels pessimistically and reports the ratio honestly", () => {
    const attribution = computeCostAttribution(
      [entry({ seq: 1, requirement: "REQ-001" }), entry({ seq: 2, label: "estimated" })],
      graph,
    );
    expect(attribution.totalLabel).toBe("estimated");
    const serialized = serializeCostAttribution(attribution);
    expect(serialized).toContain("tokens_per_verified_requirement: 3,500");
    expect(serialized).toContain("unattributed_tokens: 3,500");
    expect(serializeCostAttribution(computeCostAttribution([], graph))).toContain(
      "No usage recorded",
    );
  });
});

describe("traceability graph parsing", () => {
  it("round-trips serialize and parse including evidence lists", () => {
    const serialized = serializeTraceabilityGraph(graph);
    const parsed = parseTraceabilityGraph(serialized);
    expect(parsed).toEqual(graph);
  });

  it("round-trips empty lists and rejects foreign schemas", () => {
    const single: TraceabilityGraph = {
      schema: 1,
      links: [
        { requirement: "REQ-003", decisions: [], tasks: [], code: [], tests: [], evidence: [] },
      ],
    };
    expect(parseTraceabilityGraph(serializeTraceabilityGraph(single))).toEqual(single);
    expect(() => parseTraceabilityGraph("schema: 2\nlinks:\n")).toThrow(/schema/);
    expect(() => parseTraceabilityGraph("")).toThrow(/empty/);
  });
});

describe("task-lifecycle usage", () => {
  const workflow = "TEAM-123";
  const lifecycle: UsageSidecarEntry[] = [
    entry({
      seq: 1,
      command: "session.specification",
      workflow,
      model: "opus",
      tiers: { "cache-read": 0, "fresh-input": 9000, "cache-write": 0, output: 1500 },
    }),
    entry({
      seq: 2,
      command: "session.plan",
      workflow,
      model: "sonnet",
      tiers: { "cache-read": 6000, "fresh-input": 3000, "cache-write": 1000, output: 800 },
    }),
    entry({
      seq: 3,
      command: "session.implementation",
      workflow,
      requirement: "REQ-001",
      model: "haiku",
      label: "estimated",
      harness: "codex",
      tiers: { "cache-read": 20000, "fresh-input": 5000, "cache-write": 0, output: 4000 },
    }),
    entry({
      seq: 4,
      command: "session.other-task",
      workflow: "TEAM-999",
      tiers: { "cache-read": 0, "fresh-input": 1, "cache-write": 0, output: 1 },
    }),
  ];

  it("aggregates the full lifecycle with model-invariant token totals", () => {
    const summary = summarizeTaskUsage(lifecycle, workflow);
    expect(summary.entries).toBe(3); // TEAM-999 excluded
    expect(summary.inputTokens).toBe(44000); // all input tiers, all three models
    expect(summary.outputTokens).toBe(6300);
    expect(summary.totalTokens).toBe(50300);
    expect(summary.label).toBe("estimated"); // one estimated entry
    expect(summary.cacheHitRate).toBeCloseTo(26000 / 43000);
    expect(summary.models).toEqual(["haiku", "opus", "sonnet"]);
    expect(summary.harnesses).toEqual(["codex"]);
    expect(summary.requirements).toEqual(["REQ-001"]);
    expect(summary.stages[0].stage).toBe("session.implementation");
  });

  it("serializes the lifecycle and reports empty workflows honestly", () => {
    const serialized = serializeTaskUsage(summarizeTaskUsage(lifecycle, workflow));
    expect(serialized).toContain("total_tokens: 50,300");
    expect(serialized).toContain("models: haiku, opus, sonnet");
    expect(serialized).toContain("model-invariant");
    expect(serializeTaskUsage(summarizeTaskUsage(lifecycle, "NOPE-1"))).toContain(
      "No usage recorded for workflow NOPE-1",
    );
  });
});

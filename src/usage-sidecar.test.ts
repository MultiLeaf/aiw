import { describe, expect, it } from "vitest";
import {
  appendUsageSidecarEntry,
  parseUsageSidecar,
  serializeUsageSidecar,
  serializeUsageSidecarSummary,
  summarizeUsageSidecar,
  validateUsageSidecarEntry,
} from "./usage-sidecar.js";

const entry = {
  command: "scan.interpreter",
  label: "measured" as const,
  tiers: { "cache-read": 0, "fresh-input": 1200, "cache-write": 0, output: 300 },
  model: "llama3",
  harness: "codex",
};

describe("usage sidecar", () => {
  it("validates entries and rejects empty or negative tiers", () => {
    expect(validateUsageSidecarEntry({ ...entry, seq: 1 })).toEqual({ ...entry, seq: 1 });
    expect(() =>
      validateUsageSidecarEntry({
        ...entry,
        seq: 1,
        tiers: { "cache-read": 0, "fresh-input": 0, "cache-write": 0, output: 0 },
      }),
    ).toThrow(/non-zero tier/);
    expect(() =>
      validateUsageSidecarEntry({ ...entry, seq: 1, tiers: { ...entry.tiers, output: -1 } }),
    ).toThrow(/non-negative/);
    expect(() => validateUsageSidecarEntry({ ...entry, seq: 0 })).toThrow(/seq/);
  });

  it("appends with monotonic sequence numbers and caps the ledger", () => {
    const first = appendUsageSidecarEntry([], entry);
    const second = appendUsageSidecarEntry(first, {
      ...entry,
      command: "parity",
      label: "estimated",
    });
    expect(second.map((item) => item.seq)).toEqual([1, 2]);
    const filled = Array.from({ length: 600 }, (_, index) => ({
      ...entry,
      seq: index + 1,
    }));
    expect(appendUsageSidecarEntry(filled, entry)).toHaveLength(500);
  });

  it("round-trips through serialize and parse without timestamps", () => {
    const ledger = appendUsageSidecarEntry([], entry);
    const serialized = serializeUsageSidecar(ledger);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(parseUsageSidecar(serialized)).toEqual(ledger);
    expect(parseUsageSidecar("")).toEqual([]);
    expect(() => parseUsageSidecar("schema: 2\nentries: []\n")).toThrow(/schema/);
  });

  it("summarizes tiers, cache hit rate, and attribution with pessimistic labels", () => {
    const ledger = [
      { ...entry, seq: 1 },
      {
        command: "scan.embedding",
        label: "estimated" as const,
        tiers: { "cache-read": 800, "fresh-input": 200, "cache-write": 0, output: 0 },
        seq: 2,
      },
    ];
    const summary = summarizeUsageSidecar(ledger);
    expect(summary.entries).toBe(2);
    expect(summary.label).toBe("estimated"); // one estimated entry poisons the total
    expect(summary.tiers["fresh-input"]).toBe(1400);
    expect(summary.cacheHitRate).toBeCloseTo(800 / 2200);
    expect(summary.byModel[0]).toEqual({ model: "llama3", tokens: 1500, label: "measured" });
    expect(summary.byHarness).toContainEqual({
      harness: "unattributed",
      tokens: 1000,
      label: "estimated",
    });
    expect(serializeUsageSidecarSummary(summary)).toContain("cache_hit_rate: 36%");
    expect(serializeUsageSidecarSummary(summarizeUsageSidecar([]))).toBe(
      "No usage sidecar entries recorded.",
    );
  });
});

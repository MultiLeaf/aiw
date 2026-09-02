import { describe, expect, it } from "vitest";
import {
  createSummaryCache,
  isSummaryFresh,
  parseSummaryCache,
  serializeSummaryCache,
} from "./context-cache.js";

describe("context summary cache", () => {
  it("is fresh only for the source it summarizes", () => {
    const cache = createSummaryCache("source", "summary");
    expect(isSummaryFresh("source", cache)).toBe(true);
    expect(isSummaryFresh("changed", cache)).toBe(false);
  });

  it("serializes and parses cache metadata deterministically", () => {
    const cache = createSummaryCache("source", "summary with: yaml-safe text");
    expect(parseSummaryCache(serializeSummaryCache(cache))).toEqual(cache);
  });
});

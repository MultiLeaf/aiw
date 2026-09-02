import { describe, expect, it } from "vitest";
import { loadContextDelta, retrieveTaskContext } from "./context-retrieval.js";
import type { ContextStore } from "./context-store.js";

const store: ContextStore = { layers: { global: "G", project: "P", task: "T", session: "S" } };

describe("task-scoped context retrieval", () => {
  it("excludes session context from reusable task context", () => {
    expect(retrieveTaskContext(store)).toBe("G\n\nP\n\nT");
  });

  it("returns only new lines for delta loading", () => {
    expect(loadContextDelta("one\ntwo", "one\ntwo\nthree\nfour")).toBe("three\nfour");
  });
});

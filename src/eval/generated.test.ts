import { describe, expect, it } from "vitest";
import { createEmptyStore, recordMany } from "./proposals.js";
import { validateGeneratedResources } from "./generated.js";

function storeWithApproved(): ReturnType<typeof createEmptyStore> {
  const store = createEmptyStore();
  recordMany(store, { kind: "rule", signature: "sig-a" }, 3);
  const proposal = store.proposals[0];
  if (proposal) proposal.status = "approved";
  return store;
}

const validFile = {
  path: "rules/sig-a.md",
  content: "---\nprovenance: aiw-evaluator\nproposal: prop-001\n---\n\n# Title\n\nDo the thing.\n",
};

describe("generated resource validator", () => {
  it("accepts a well-formed generated resource backed by an approved proposal", () => {
    expect(validateGeneratedResources([validFile], storeWithApproved())).toEqual([]);
  });

  it("rejects missing frontmatter or provenance", () => {
    const store = storeWithApproved();
    expect(
      validateGeneratedResources([{ path: "rules/x.md", content: "# no frontmatter\n" }], store),
    ).toMatchObject([{ path: "rules/x.md" }]);
    expect(
      validateGeneratedResources(
        [{ path: "rules/y.md", content: "---\nproposal: prop-001\n---\nbody\n" }],
        store,
      ),
    ).toMatchObject([{ path: "rules/y.md" }]);
  });

  it("rejects unknown or non-approved proposal references", () => {
    const store = storeWithApproved();
    const unknown = {
      path: "rules/z.md",
      content: "---\nprovenance: aiw-evaluator\nproposal: prop-999\n---\n\n# T\n\nB\n",
    };
    expect(validateGeneratedResources([unknown], store)).toMatchObject([{ path: "rules/z.md" }]);
    const pending = createEmptyStore();
    recordMany(pending, { kind: "rule", signature: "sig-p" }, 3);
    const file = {
      path: "rules/sig-p.md",
      content: "---\nprovenance: aiw-evaluator\nproposal: prop-001\n---\n\n# T\n\nB\n",
    };
    expect(validateGeneratedResources([file], pending)).toMatchObject([{ path: "rules/sig-p.md" }]);
  });

  it("rejects empty bodies", () => {
    const store = storeWithApproved();
    const empty = {
      path: "rules/empty.md",
      content: "---\nprovenance: aiw-evaluator\nproposal: prop-001\n---\n\n",
    };
    expect(validateGeneratedResources([empty], store)).toMatchObject([{ path: "rules/empty.md" }]);
  });
});

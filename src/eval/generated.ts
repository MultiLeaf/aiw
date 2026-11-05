import type { ProposalStore } from "./types.js";

export type GeneratedResourceFile = { path: string; content: string };
export type GeneratedResourceIssue = { path: string; reason: string };

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

/**
 * Validate project-local generated resources (`.aiw/generated/{kind}s/*.md`)
 * against the evaluator contract: frontmatter with `provenance: aiw-evaluator`,
 * a `proposal:` reference that exists in the store and is approved, and a
 * non-empty body. Closes the REQ-006 substitution: generated files now have
 * their own dedicated validator.
 */
export function validateGeneratedResources(
  files: GeneratedResourceFile[],
  store: ProposalStore,
): GeneratedResourceIssue[] {
  const issues: GeneratedResourceIssue[] = [];
  for (const file of files) {
    const frontmatter = FRONTMATTER.exec(file.content);
    if (!frontmatter) {
      issues.push({ path: file.path, reason: "missing frontmatter block" });
      continue;
    }
    const fields = frontmatter[1];
    if (!/^provenance:\s*aiw-evaluator$/m.test(fields))
      issues.push({
        path: file.path,
        reason: "frontmatter must declare provenance: aiw-evaluator",
      });
    const id = /^proposal:\s*(\S+)$/m.exec(fields)?.[1];
    if (!id) {
      issues.push({ path: file.path, reason: "frontmatter must declare proposal: <id>" });
      continue;
    }
    const proposal = store.proposals.find((candidate) => candidate.id === id);
    if (!proposal) issues.push({ path: file.path, reason: `unknown proposal id: ${id}` });
    else if (proposal.status !== "approved")
      issues.push({
        path: file.path,
        reason: `proposal ${id} is ${proposal.status}, not approved`,
      });
    const body = file.content.slice(frontmatter[0].length).trim();
    if (!body) issues.push({ path: file.path, reason: "empty body" });
  }
  return issues;
}

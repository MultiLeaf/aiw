export type TraceabilityLink = {
  requirement: string;
  decisions: string[];
  tasks: string[];
  code: string[];
  tests: string[];
  evidence: string[];
};

export type TraceabilityGraph = { schema: 1; links: TraceabilityLink[] };

/** Parse a serialized traceability graph (round-trips serializeTraceabilityGraph). */
export function parseTraceabilityGraph(content: string): TraceabilityGraph {
  if (!content.trim()) throw new Error("Traceability graph is empty.");
  const schema = content.match(/^schema: (\d+)$/m)?.[1];
  if (schema !== "1") throw new Error("Traceability graph schema must be version 1.");
  const links: TraceabilityLink[] = [];
  for (const match of content.matchAll(/^ {2}- requirement: (REQ-\d+)$/gm)) {
    const requirement = match[1];
    const blockStart = (match.index ?? 0) + match[0].length;
    const next = content.slice(blockStart).match(/^ {2}- requirement: /m);
    const block = content.slice(
      blockStart,
      next?.index === undefined ? undefined : blockStart + next.index,
    );
    const listOf = (field: string): string[] => {
      const raw = block?.match(new RegExp(`^ {4}${field}: (.+)$`, "m"))?.[1] ?? "[]";
      if (raw === "[]") return [];
      return raw
        .slice(1, -1)
        .split(/,\s*/)
        .map((value) => (value.startsWith('"') && value.endsWith('"') ? JSON.parse(value) : value));
    };
    links.push({
      requirement,
      decisions: listOf("decisions"),
      tasks: listOf("tasks"),
      code: listOf("code"),
      tests: listOf("tests"),
      evidence: listOf("evidence"),
    });
  }
  if (!links.length) throw new Error("Traceability graph has no requirement links.");
  return { schema: 1, links };
}

type TraceabilityInput = {
  specification: string;
  plan: string;
  decisions: { id: string; content: string }[];
};

const uniqueSorted = (values: string[]): string[] => [...new Set(values)].sort();

function valuesForField(block: string, field: string): string[] {
  const expression = new RegExp(`^\\s*-?\\s*${field}:\\s*(.+)$`, "gim");
  return [...block.matchAll(expression)].map((match) => match[1].trim());
}

export function buildTraceabilityGraph(input: TraceabilityInput): TraceabilityGraph {
  const requirements = uniqueSorted(input.specification.match(/REQ-\d+/g) ?? []);
  const taskStarts = [...input.plan.matchAll(/(?:^|\n)\s*-?\s*(?:\[[ x]\]\s*)?(TASK-\d+)/gi)];
  const tasks = taskStarts.map((match, index) => ({
    id: match[1],
    block: input.plan.slice(match.index, taskStarts[index + 1]?.index ?? input.plan.length),
  }));
  const globalValidation = uniqueSorted([
    ...valuesForField(input.plan, "Validation"),
    ...(input.plan.match(/npm (?:run )?[\w:-]+/g) ?? []),
  ]);

  return {
    schema: 1,
    links: requirements.map((requirement) => {
      const linkedTasks = tasks.filter(({ block }) => block.includes(requirement));
      return {
        requirement,
        decisions: uniqueSorted(
          input.decisions
            .filter(({ content }) => content.includes(requirement))
            .map(({ id }) => id),
        ),
        tasks: uniqueSorted(linkedTasks.map(({ id }) => id)),
        code: uniqueSorted(linkedTasks.flatMap(({ block }) => valuesForField(block, "Code"))),
        tests: uniqueSorted(linkedTasks.flatMap(({ block }) => valuesForField(block, "Tests"))),
        evidence: uniqueSorted([
          ...linkedTasks.flatMap(({ block }) => valuesForField(block, "Evidence")),
          ...(linkedTasks.length > 0 ? globalValidation : []),
        ]),
      };
    }),
  };
}

function yamlList(values: string[]): string {
  return `[${values
    .map((value) => (/^(?:REQ|ADR|TASK)-\d+$/.test(value) ? value : JSON.stringify(value)))
    .join(", ")}]`;
}

export function serializeTraceabilityGraph(graph: TraceabilityGraph, requirement?: string): string {
  const links = requirement
    ? graph.links.filter((link) => link.requirement === requirement)
    : graph.links;
  if (requirement && links.length === 0) throw new Error(`Requirement not found: ${requirement}`);
  return `schema: 1\nlinks:\n${links
    .map(
      (link) =>
        `  - requirement: ${link.requirement}\n    decisions: ${yamlList(link.decisions)}\n    tasks: ${yamlList(link.tasks)}\n    code: ${yamlList(link.code)}\n    tests: ${yamlList(link.tests)}\n    evidence: ${yamlList(link.evidence)}`,
    )
    .join("\n")}\n`;
}

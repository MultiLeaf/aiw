import type { EvidenceFact } from "./evidence.js";

export function mergeFacts(detected: EvidenceFact[], proposed: EvidenceFact[]): EvidenceFact[] {
  const result = [...detected];
  for (const candidate of proposed) {
    const index = result.findIndex((fact) => fact.key === candidate.key);
    if (index < 0) {
      result.push(candidate);
      continue;
    }
    if (candidate.state === "confirmed" && candidate.method === "user-confirmed")
      result[index] = candidate;
  }
  return result;
}

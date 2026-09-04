export type SelfValidationEvidence = {
  ticket: string;
  command: string;
  exitCode: number;
  requiredState: string[];
  generatedArtifacts: string[];
};

export function validateTicketId(ticket: string): void {
  if (!/^[A-Z]+-\d{3}$/.test(ticket))
    throw new Error("Self-validation ticket must match TYPE-000, for example FND-009.");
}

export function serializeSelfValidationEvidence(evidence: SelfValidationEvidence): string {
  const state = [...evidence.requiredState].sort();
  const artifacts = [...evidence.generatedArtifacts].sort();
  return `schema: 1\nticket: ${evidence.ticket}\ncommand: ${evidence.command}\nexit_code: ${evidence.exitCode}\nrequired_state:\n${state.map((path) => `  - ${path}`).join("\n")}\ngenerated_artifacts:\n${artifacts.length ? artifacts.map((path) => `  - ${path}`).join("\n") : "  - none"}\nresult: ${evidence.exitCode === 0 ? "pass" : "fail"}\n`;
}

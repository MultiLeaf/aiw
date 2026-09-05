import {
  enforceOrganizationPolicy,
  type OrganizationPolicy,
  type PackagePolicySubject,
} from "./organization-policy.js";

export function enforcePolicyGate(
  policy: OrganizationPolicy,
  subjects: readonly PackagePolicySubject[],
): void {
  subjects.forEach((subject) => enforceOrganizationPolicy(policy, subject));
}

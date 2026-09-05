import {
  enforceOrganizationPolicy,
  type OrganizationPolicy,
  type PackagePolicySubject,
} from "./organization-policy.js";
import { execFileSync } from "node:child_process";
import { relative } from "node:path";

export interface PolicyTracking {
  isTracked(root: string, path: string): boolean;
}

export const gitPolicyTracking: PolicyTracking = {
  isTracked(root, path) {
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", "--", relative(root, path)], {
        cwd: root,
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  },
};

export function enforcePolicyGate(
  policy: OrganizationPolicy,
  subjects: readonly PackagePolicySubject[],
): void {
  subjects.forEach((subject) => enforceOrganizationPolicy(policy, subject));
}

import { basename, dirname, join, resolve } from "node:path";
import { isTarget } from "../adapter.js";
import { APPROVAL_STAGES, authorizeRetry, serializeApprovalLedger } from "../human-approval.js";
import { parseLock, resolvePackage, serializeLock } from "../lockfile.js";
import { parseManifest } from "../manifest.js";
import {
  POLICY_DECISIONS,
  parseOrganizationPolicy,
  serializeOrganizationPolicy,
  type PackagePolicySubject,
} from "../organization-policy.js";
import {
  assertKnownPermissions,
  assertPackagePermissions,
  assertPermissions,
  serializePermissionReview,
} from "../package-audit.js";
import { validatePackageContract } from "../package-contract.js";
import {
  checksumPackage,
  checksumPackageSnapshot,
  verifyPackageProvenance,
} from "../package-integrity.js";
import { planPackageUpdate } from "../package-updates.js";
import {
  changeFingerprint,
  isPathApproved,
  parsePolicyApprovals,
  policyApprovalsPath,
  recordPolicyApproval,
} from "../policy-approvals.js";
import {
  applyAutomatedResult,
  changedPaths,
  enforcePolicyGate,
  gitPolicyTracking,
  resolvePolicy,
  type PolicyDecision,
  type PolicyRule,
} from "../policy-gate.js";
import { nodePackageSourceLoader, requiresExternalNetwork, resolveProvider } from "../providers.js";
import { searchRegistry, serializeRegistry } from "../registry.js";
import {
  fetchPrivateRegistryClient,
  parsePrivateRegistries,
  parseTeamPreset,
  serializePrivateRegistries,
  serializeTeamPreset,
} from "../team-configuration.js";
import type { CommandResult, HumanApprovalStage } from "../types.js";
import { executeVercelSkills, installVercelSkill, nodeCommandExecutor } from "../vercel-skills.js";
import {
  containsCredential,
  enforceConfiguredOrganizationPolicy,
  installationRequired,
  parseApprovedPermissions,
  parsePrivateRegistryPackages,
  refreshVercelSkillLocks,
  writeVercelSkillLock,
} from "./shared.js";
import { runBundledUpdate } from "./sync-helpers.js";
import type { CommandContext, CommandHandler } from "./types.js";
import { readActiveWorkflow } from "./workflow-state.js";

async function handleSkills({
  args,
  root,
  aiw,
  fs,
  services,
}: CommandContext): Promise<CommandResult> {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const action = args[1];
  const executor = services.externalSkills ?? nodeCommandExecutor;
  const approvedPermissions = parseApprovedPermissions(args);
  assertKnownPermissions(approvedPermissions);
  if (action === "search") {
    const query = args.find((arg) => arg.startsWith("--query="))?.slice(8) ?? "";
    return {
      exitCode: 0,
      output: await executeVercelSkills(executor, { command: "find", skill: query }),
    };
  }
  const source = args.find((arg) => arg.startsWith("--source="))?.slice(9);
  const skill = args.find((arg) => arg.startsWith("--skill="))?.slice(8);
  if (action === "inspect") {
    if (!source)
      return { exitCode: 1, error: "Usage: aiw skills inspect --source=owner/repository" };
    return {
      exitCode: 0,
      output: await executeVercelSkills(executor, { command: "inspect", source }),
    };
  }
  if (action === "install") {
    if (!source || !skill)
      return {
        exitCode: 1,
        error:
          "Usage: aiw skills install --source=owner/repository --skill=name --allow=network:external",
      };
    if (!approvedPermissions.includes("network:external"))
      return { exitCode: 1, error: "Package permissions require approval: network:external" };
    enforceConfiguredOrganizationPolicy(fs, aiw, {
      provider: "vercel-skills",
      source,
      permissions: ["network:external"],
    });
    const target = parseManifest(fs.read(join(aiw, "manifest.yml"))).target.active;
    const output = await installVercelSkill(executor, source, skill, target);
    writeVercelSkillLock(fs, root, aiw, source, skill);
    return { exitCode: 0, output };
  }
  if (action === "check" || action === "update") {
    if (!approvedPermissions.includes("network:external"))
      return { exitCode: 1, error: "Package permissions require approval: network:external" };
    const lockPath = join(aiw, "lock.yml");
    if (fs.exists(lockPath)) {
      parseLock(fs.read(lockPath))
        .filter(({ provider }) => provider === "vercel-skills")
        .forEach((locked) =>
          enforceConfiguredOrganizationPolicy(fs, aiw, {
            ...locked,
            permissions: [...new Set([...(locked.permissions ?? []), "network:external"])],
          }),
        );
    }
    const output = await executeVercelSkills(executor, { command: action });
    if (action === "update") refreshVercelSkillLocks(fs, root, aiw);
    return { exitCode: 0, output };
  }
  return {
    exitCode: 1,
    error: "Usage: aiw skills <search|inspect|install|check|update> [options]",
  };
}

function handleValidate({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml")))
    return { exitCode: 1, error: "AI Workflow is not installed." };
  parseManifest(fs.read(join(aiw, "manifest.yml")));
  const packageArg = args.find((arg) => arg.startsWith("--package="));
  if (packageArg)
    validatePackageContract(
      fs.read(join(root, packageArg.slice(10))),
      (path) =>
        !fs.exists(join(root, "resources")) ||
        fs.exists(join(root, path)) ||
        fs.exists(join(root, "resources", path)),
    );
  return {
    exitCode: 0,
    output: "Configuration is valid.",
  };
}

function handleResolve({ args, root, aiw, fs, services }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const packageArg = args.find((arg) => arg.startsWith("--package="));
  const sourceArg = args.find((arg) => arg.startsWith("--source="));
  const stageArg = args.find((arg) => arg.startsWith("--stage="));
  if (stageArg) {
    const stage = stageArg.slice(8);
    if (!APPROVAL_STAGES.includes(stage as HumanApprovalStage))
      return {
        exitCode: 1,
        error: `Usage: aiw resolve --stage=<${APPROVAL_STAGES.join("|")}>`,
      };
    const workflowStage = stage as HumanApprovalStage;
    const { ledger: resolveLedger } = readActiveWorkflow(aiw, fs);
    if (!resolveLedger.stages[workflowStage]?.escalated)
      return {
        exitCode: 1,
        error: `Stage ${workflowStage} is not escalated; nothing to resolve.`,
      };
    const resolved = authorizeRetry(resolveLedger, workflowStage, new Date().toISOString());
    fs.write(join(aiw, "approvals.yml"), serializeApprovalLedger(resolved));
    return {
      exitCode: 0,
      output: `Human retry authorization recorded for ${workflowStage}: escalation cleared and the rejection count reset. Revise the artifact, then run aiw gate ${workflowStage}.`,
    };
  }
  if (!packageArg && !sourceArg)
    return {
      exitCode: 1,
      error: "Usage: aiw resolve --package=path | --source=source | --stage=workflow-stage",
    };
  const approvedPermissions = parseApprovedPermissions(args);
  if (sourceArg) {
    const source = resolveProvider(sourceArg.slice(9), root);
    const networkPermissions = requiresExternalNetwork(source) ? ["network:external"] : [];
    enforceConfiguredOrganizationPolicy(fs, aiw, {
      ...source,
      permissions: networkPermissions,
    });
    assertPermissions(networkPermissions, approvedPermissions);
  }
  const loaded = sourceArg
    ? (services.packageSources ?? nodePackageSourceLoader).load(sourceArg.slice(9), root)
    : undefined;
  try {
    const manifestPath = packageArg ? resolve(root, packageArg.slice(10)) : undefined;
    const directManifestBytes = loaded ? undefined : fs.readBytes?.(manifestPath!);
    const manifestContent =
      loaded?.manifest ??
      (directManifestBytes
        ? Buffer.from(directManifestBytes).toString("utf8")
        : fs.read(manifestPath!));
    const pkg = validatePackageContract(
      manifestContent,
      loaded ? (path): boolean => fs.exists(join(loaded.root, path)) : undefined,
    );
    const resolved = loaded
      ? {
          ...pkg,
          provider: loaded.provider,
          source: loaded.source,
          provenance: { ...pkg.provenance, source: loaded.source },
        }
      : pkg;
    enforceConfiguredOrganizationPolicy(fs, aiw, resolved);
    assertPackagePermissions(resolved, approvedPermissions);
    const packageRoot = loaded?.root ?? dirname(manifestPath!);
    const manifestBytes = loaded
      ? (loaded.manifestBytes ?? Buffer.from(loaded.manifest, "utf8"))
      : (directManifestBytes ?? Buffer.from(manifestContent, "utf8"));
    const integrity = checksumPackageSnapshot(
      manifestBytes,
      resolved,
      packageRoot,
      fs,
      loaded ? "package.yaml" : basename(manifestPath!),
    );
    const lockPath = join(aiw, "lock.yml");
    const locked = fs.exists(lockPath) ? parseLock(fs.read(lockPath)) : [];
    fs.write(
      lockPath,
      serializeLock([
        ...locked.filter(({ id }) => id !== resolved.id),
        resolvePackage(resolved, integrity),
      ]),
    );
    return { exitCode: 0, output: `Package resolved: ${resolved.id}@${resolved.version}` };
  } finally {
    loaded?.release();
  }
}

function handleAuditPackage({ args, root, fs }: CommandContext): CommandResult {
  const packageArg = args.find((arg) => arg.startsWith("--package="));
  if (!packageArg) return { exitCode: 1, error: "Usage: aiw audit-package --package=path" };
  const pkg = validatePackageContract(fs.read(join(root, packageArg.slice(10))));
  return { exitCode: 0, output: serializePermissionReview(pkg) };
}

function handleOrganizationPolicy({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const fileArg = args.find((arg) => arg.startsWith("--file="));
  if (!fileArg)
    return { exitCode: 1, error: "Usage: aiw organization-policy --file=path [--replace]" };
  const destination = join(aiw, "organization.yml");
  if (fs.exists(destination) && !args.includes("--replace"))
    return {
      exitCode: 1,
      error: "Organization policy already exists. Use --replace to update it explicitly.",
    };
  const policy = parseOrganizationPolicy(fs.read(join(root, fileArg.slice(7))));
  fs.write(destination, serializeOrganizationPolicy(policy));
  return { exitCode: 0, output: `Organization policy configured: ${policy.name}` };
}

function handlePolicyCheck({ args, root, aiw, fs, services }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const policyPath = join(aiw, "organization.yml");
  if (!fs.exists(policyPath))
    return { exitCode: 1, error: "Organization policy is required for the CI policy gate." };
  if (!(services.policyTracking ?? gitPolicyTracking).isTracked(root, policyPath))
    return { exitCode: 1, error: "Organization policy must be tracked by Git." };
  const packageArgs = args.filter((arg) => arg.startsWith("--package="));
  if (!packageArgs.length)
    return { exitCode: 1, error: "Usage: aiw policy-check --package=path [--package=path]" };
  const packages = packageArgs.map((argument) =>
    validatePackageContract(fs.read(join(root, argument.slice(10)))),
  );
  const subjects: PackagePolicySubject[] = packages.map((pkg) => ({
    provider: pkg.provider,
    source: pkg.source,
    permissions: pkg.permissions,
  }));
  const lock = fs.read(join(aiw, "lock.yml"));
  subjects.push(
    ...parseLock(lock).map((locked) => ({
      provider: locked.provider,
      source: locked.source,
      permissions: locked.permissions ?? [],
    })),
  );
  const registriesPath = join(aiw, "registries.yml");
  if (fs.exists(registriesPath))
    subjects.push(
      ...parsePrivateRegistries(fs.read(registriesPath)).registries.map((registry) => ({
        provider: "private-registry",
        source: registry.url,
        permissions: ["network:external"],
      })),
    );
  const policy = parseOrganizationPolicy(fs.read(policyPath));
  subjects.forEach((subject) => assertKnownPermissions(subject.permissions));
  enforcePolicyGate(policy, subjects);
  // REQ-002/004 (workflow abbfcf16): path-rule enforcement and advisory.
  if (policy.rules?.length) {
    const advisoryArg = args.find((arg) => arg.startsWith("--advisory="))?.slice(11);
    if (advisoryArg !== undefined && !POLICY_DECISIONS.includes(advisoryArg as PolicyDecision))
      return {
        exitCode: 1,
        error: `--advisory must be one of: ${POLICY_DECISIONS.join(", ")}`,
      };
    let paths = changedPaths(root);
    if (paths === undefined) {
      // D1 fallback: non-git repositories evaluate the package manifests' declared paths.
      paths = [
        ...new Set(
          packages.flatMap((pkg) =>
            Object.values(pkg.resources).flatMap((resources) =>
              resources.map((resource) => resource.path),
            ),
          ),
        ),
      ].sort();
    }
    if (paths.length === 0) {
      return {
        exitCode: 0,
        output: `Organization policy gate passed: ${policy.name} (${subjects.length} subjects). Advisory: no changed paths were evaluated (no git change and no package file lists).`,
      };
    }
    const fingerprint = changeFingerprint(paths);
    const approvals = fs.exists(policyApprovalsPath(aiw))
      ? parsePolicyApprovals(fs.read(policyApprovalsPath(aiw)))
      : [];
    const rules: PolicyRule[] = policy.rules.map((rule) => ({
      id: rule.id,
      paths: rule.paths,
      decision: rule.decision,
      ...(rule.alwaysRequireHuman ? { alwaysRequireHuman: true } : {}),
    }));
    const denied: string[] = [];
    const unapproved: string[] = [];
    const counts = { allow: 0, "require-approval": 0, "always-require-human": 0, deny: 0 };
    const advisoryDelta: string[] = [];
    for (const path of paths) {
      const resolved = resolvePolicy(rules, path);
      if (!resolved) {
        counts.allow += 1;
        continue;
      }
      counts[resolved.decision] += 1;
      if (resolved.decision === "deny") {
        denied.push(`${path} (rules: ${resolved.matchedRules.join(", ")})`);
      } else if (
        (resolved.decision === "require-approval" ||
          resolved.decision === "always-require-human") &&
        !isPathApproved(approvals, fingerprint, path)
      ) {
        unapproved.push(
          `${path} (${resolved.decision}; rules: ${resolved.matchedRules.join(", ")}; approve with: aiw policy approve --paths=${path})`,
        );
      }
      if (advisoryArg !== undefined) {
        const after = applyAutomatedResult(resolved, advisoryArg as PolicyDecision);
        if (after.decision !== resolved.decision)
          advisoryDelta.push(
            `${path}: ${resolved.decision} → ${after.decision} (advisory only; verdict unchanged)`,
          );
      }
    }
    const summary = `paths: ${paths.length} changed · allow ${counts.allow} · require-approval ${counts["require-approval"]} · always-require-human ${counts["always-require-human"]} · deny ${counts.deny}`;
    if (denied.length || unapproved.length) {
      const lines = [
        ...(denied.length
          ? [
              `Denied paths (deny is not satisfiable by approval):\n${denied.map((p) => `- ${p}`).join("\n")}`,
            ]
          : []),
        ...(unapproved.length
          ? [
              `Paths requiring recorded human approval:\n${unapproved.map((p) => `- ${p}`).join("\n")}`,
            ]
          : []),
      ];
      return {
        exitCode: 1,
        error: `Organization policy gate blocked by path rules (${policy.name}):\n${lines.join("\n")}\n${summary}`,
      };
    }
    return {
      exitCode: 0,
      output: `Organization policy gate passed: ${policy.name} (${subjects.length} subjects). ${summary}.${advisoryDelta.length ? `\nAdvisory (${advisoryArg}):\n${advisoryDelta.map((line) => `- ${line}`).join("\n")}\nDeny and always-require-human decisions are never changed by advisory results.` : ""}`,
    };
  }
  return {
    exitCode: 0,
    output: `Organization policy gate passed: ${policy.name} (${subjects.length} subjects).`,
  };
}

function handlePolicy({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  if (args[1] !== "approve")
    return { exitCode: 1, error: "Usage: aiw policy approve --paths=<pattern>[,<pattern>...]" };
  const pathsArg = args.find((arg) => arg.startsWith("--paths="))?.slice(8);
  if (!pathsArg)
    return { exitCode: 1, error: "Usage: aiw policy approve --paths=<pattern>[,<pattern>...]" };
  const patterns = pathsArg
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  if (!patterns.length)
    return { exitCode: 1, error: "--paths requires at least one non-empty pattern." };
  const paths = changedPaths(root);
  if (paths === undefined || paths.length === 0)
    return {
      exitCode: 1,
      error: "No changed paths to approve: run this in the repository whose change needs approval.",
    };
  const fingerprint = changeFingerprint(paths);
  const path = recordPolicyApproval(fs, aiw, {
    paths: patterns,
    fingerprint,
    approvedAt: new Date().toISOString(),
  });
  return {
    exitCode: 0,
    output: `Human approval recorded for ${patterns.join(", ")} scoped to the current change (${paths.length} path(s), fingerprint ${fingerprint.slice(0, 16)}…). Recorded in ${path}; rerun aiw policy-check to verify.`,
  };
}

function handlePreset({ args, root, aiw, fs }: CommandContext): CommandResult {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const fileArg = args.find((arg) => arg.startsWith("--file="));
  if (!fileArg) return { exitCode: 1, error: "Usage: aiw preset --file=path [--replace]" };
  const destination = join(aiw, "team-preset.yml");
  if (fs.exists(destination) && !args.includes("--replace"))
    return {
      exitCode: 1,
      error: "Team preset already exists. Use --replace to update it explicitly.",
    };
  const preset = parseTeamPreset(fs.read(join(root, fileArg.slice(7))));
  fs.write(destination, serializeTeamPreset(preset));
  return { exitCode: 0, output: `Team preset configured: ${preset.name}` };
}

async function handleUpdate({
  args,
  root,
  aiw,
  fs,
  services,
}: CommandContext): Promise<CommandResult> {
  if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
  const packageArg = args.find((arg) => arg.startsWith("--package="));
  if (!packageArg) return await runBundledUpdate(args, root, fs, aiw, services);
  const manifestPath = resolve(root, packageArg.slice(10));
  const manifestBytes = fs.readBytes?.(manifestPath);
  const manifestContent = manifestBytes
    ? Buffer.from(manifestBytes).toString("utf8")
    : fs.read(manifestPath);
  const pkg = validatePackageContract(manifestContent);
  enforceConfiguredOrganizationPolicy(fs, aiw, pkg);
  assertPackagePermissions(pkg, parseApprovedPermissions(args));
  const target = args.find((arg) => arg.startsWith("--target="))?.slice(9) ?? "universal";
  if (!isTarget(target)) return { exitCode: 1, error: `Unsupported target: ${target}` };
  const lock = fs.exists(join(aiw, "lock.yml")) ? fs.read(join(aiw, "lock.yml")) : "";
  const lockedPackages = lock ? parseLock(lock) : [];
  const current = lockedPackages.find(({ id }) => id === pkg.id);
  const integrity = checksumPackageSnapshot(
    manifestBytes ?? Buffer.from(manifestContent, "utf8"),
    pkg,
    dirname(manifestPath),
    fs,
    basename(manifestPath),
  );
  if (current?.version === pkg.version && current.integrity !== integrity)
    throw new Error(
      `Package integrity mismatch for ${pkg.id}@${pkg.version}; package bytes changed.`,
    );
  const plan = planPackageUpdate(
    current ? { id: pkg.id, version: current.version } : undefined,
    pkg,
    target,
    new Map(
      lockedPackages.filter(({ id }) => id !== pkg.id).map(({ id, version }) => [id, version]),
    ),
  );
  if (plan.status !== "update")
    return { exitCode: 1, error: plan.reason ?? `Update blocked: ${plan.status}.` };
  const existingPackages = lockedPackages.filter(({ id }) => id !== pkg.id);
  fs.write(
    join(aiw, "lock.yml"),
    serializeLock([...existingPackages, resolvePackage(pkg, integrity)]),
  );
  return { exitCode: 0, output: `Package updated: ${pkg.id}@${pkg.version}` };
}

async function handleRegistry({
  args,
  root,
  aiw,
  fs,
  services,
}: CommandContext): Promise<CommandResult> {
  if (args[1] === "configure") {
    if (!fs.exists(join(aiw, "manifest.yml"))) return installationRequired();
    const fileArg = args.find((arg) => arg.startsWith("--file="));
    if (!fileArg)
      return {
        exitCode: 1,
        error: "Usage: aiw registry configure --file=path [--replace]",
      };
    const destination = join(aiw, "registries.yml");
    if (fs.exists(destination) && !args.includes("--replace"))
      return {
        exitCode: 1,
        error:
          "Private registry configuration already exists. Use --replace to update it explicitly.",
      };
    const registries = parsePrivateRegistries(fs.read(join(root, fileArg.slice(7))));
    fs.write(destination, serializePrivateRegistries(registries));
    return {
      exitCode: 0,
      output: `Private registries configured: ${registries.registries.map(({ name }) => name).join(", ")}`,
    };
  }
  const query = args.find((arg) => arg.startsWith("--search="))?.slice(9) ?? "";
  const privateName = args.find((arg) => arg.startsWith("--private="))?.slice(10);
  if (privateName) {
    const configurationPath = join(aiw, "registries.yml");
    if (!fs.exists(configurationPath))
      return { exitCode: 1, error: "Configure private registries first." };
    const configuration = parsePrivateRegistries(fs.read(configurationPath));
    const registry = configuration.registries.find(({ name }) => name === privateName);
    if (!registry) return { exitCode: 1, error: "Unknown private registry." };
    enforceConfiguredOrganizationPolicy(fs, aiw, {
      provider: "private-registry",
      source: registry.url,
      permissions: ["network:external"],
    });
    const token = (services.environment ?? process.env)[registry.tokenEnv];
    if (!token)
      return {
        exitCode: 1,
        error: `Private registry credential is missing from environment variable: ${registry.tokenEnv}`,
      };
    let payload: unknown;
    try {
      payload = await (services.privateRegistries ?? fetchPrivateRegistryClient).search(
        registry,
        query,
        token,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Private registry request failed.";
      throw new Error(message.split(token).join("[REDACTED]"), { cause: error });
    }
    if (containsCredential(payload, token))
      throw new Error("Private registry response contains sensitive credential data.");
    const packages = parsePrivateRegistryPackages(payload, registry.url).sort((a, b) =>
      `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`),
    );
    packages.forEach((pkg) => assertKnownPermissions(pkg.permissions));
    return { exitCode: 0, output: serializeRegistry(packages) };
  }
  return { exitCode: 0, output: serializeRegistry(searchRegistry(query)) };
}

function handleVerifyPackage({ args, root, fs }: CommandContext): CommandResult {
  const packageArg = args.find((arg) => arg.startsWith("--package="));
  const checksumArg = args.find((arg) => arg.startsWith("--checksum="));
  if (!packageArg || !checksumArg)
    return { exitCode: 1, error: "Usage: aiw verify-package --package=path --checksum=sha256" };
  const content = fs.read(join(root, packageArg.slice(10)));
  verifyPackageProvenance(content, { checksum: checksumArg.slice(11) });
  return { exitCode: 0, output: `Package provenance verified: ${checksumPackage(content)}` };
}

export const packagesPolicyCommands: Record<string, CommandHandler> = {
  skills: handleSkills,
  validate: handleValidate,
  resolve: handleResolve,
  "audit-package": handleAuditPackage,
  "organization-policy": handleOrganizationPolicy,
  "policy-check": handlePolicyCheck,
  policy: handlePolicy,
  preset: handlePreset,
  update: handleUpdate,
  registry: handleRegistry,
  "verify-package": handleVerifyPackage,
};

import type { ProjectProfile } from "./profile.js";
import type { ProjectScan } from "./scanner.js";
import type { CapabilityRecommendation } from "./recommendations.js";
import type { Interpreter } from "./interpreter.js";
import type { CommandExecutor } from "./vercel-skills.js";
import type { CommandResult, FileSystem } from "./types.js";
import type { PackageSourceLoader } from "./providers.js";
import type { PrivateRegistryClient } from "./team-configuration.js";
import type { PolicyTracking } from "./policy-gate.js";
import type { TelemetryClient } from "./telemetry.js";
import type { DashboardHandle } from "./dashboard.js";

export interface ProjectScanner {
  scan(root: string): Promise<ProjectScan>;
}

export interface ProfileService {
  profile(root: string): Promise<ProjectProfile>;
}

export interface RecommendationService {
  recommend(profile: ProjectProfile): CapabilityRecommendation[];
}

export interface WorkflowDependencies {
  scanner?: ProjectScanner;
  profiler?: ProfileService;
  recommender?: RecommendationService;
  interpreter?: Interpreter;
  externalSkills?: CommandExecutor;
  packageSources?: PackageSourceLoader;
  selfValidation?: CommandExecutor;
  privateRegistries?: PrivateRegistryClient;
  environment?: Readonly<Record<string, string | undefined>>;
  policyTracking?: PolicyTracking;
  telemetry?: TelemetryClient;
  dashboard?: { start(root: string, port: number): Promise<DashboardHandle> };
}

export interface WorkflowService {
  execute(args: string[], root: string, fs: FileSystem): Promise<CommandResult>;
}

export type ServiceFactory<T> = (dependencies: WorkflowDependencies) => T;

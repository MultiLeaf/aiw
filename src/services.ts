import type { ProjectProfile } from "./profile.js";
import type { ProjectScan } from "./scanner.js";
import type { CapabilityRecommendation } from "./recommendations.js";
import type { Interpreter } from "./interpreter.js";
import type { CommandExecutor } from "./vercel-skills.js";
import type { CommandResult, FileSystem } from "./types.js";
import type { PackageSourceLoader } from "./providers.js";

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
}

export interface WorkflowService {
  execute(args: string[], root: string, fs: FileSystem): Promise<CommandResult>;
}

export type ServiceFactory<T> = (dependencies: WorkflowDependencies) => T;

import type { ProjectProfile } from "./profile.js";
import type { ProjectScan } from "./scanner.js";
import type { CapabilityRecommendation } from "./recommendations.js";
import type { Interpreter } from "./interpreter.js";

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
}

export type ServiceFactory<T> = (dependencies: WorkflowDependencies) => T;

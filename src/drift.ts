import { normalize } from "node:path";

export function resolveGeneratedPath(path: string): string {
  const normalized = normalize(path).replaceAll("\\", "/");
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/"))
    throw new Error("Generated path is outside generated resources");
  return `generated/${normalized}`;
}

export function detectDrift(expected: string, actual: string): boolean {
  return expected !== actual;
}

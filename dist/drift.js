import { normalize } from "node:path";
export function resolveGeneratedPath(path) {
    const normalized = normalize(path).replaceAll("\\", "/");
    if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/"))
        throw new Error("Generated path is outside generated resources");
    return `generated/${normalized}`;
}
export function detectDrift(expected, actual) {
    return expected !== actual;
}

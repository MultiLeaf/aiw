export function isDebugEnabled(scope: string): boolean {
  const raw = process.env.AIW_DEBUG?.trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "false") {
    return false;
  }
  const normalized = raw.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "*") {
    return true;
  }
  const scopes = normalized
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return scopes.includes(scope.toLowerCase());
}

export function debugLog(scope: string, detail: string, error?: unknown): void {
  if (!isDebugEnabled(scope)) {
    return;
  }
  const reason =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error !== undefined
          ? String(error)
          : "";
  const suffix = reason ? `: ${reason}` : "";
  process.stderr.write(`[aiw:debug:${scope}] ${detail}${suffix}\n`);
}

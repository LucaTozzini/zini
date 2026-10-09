// SDK errors vary by provider; keep the same classification in retry and eval code.
export function isModelRateLimit(error: unknown): boolean {
  const seen = new Set<object>();
  while (error) {
    if (typeof error === "string") return /\b429\b|rate.?limit|free-models-per-day|subscription_sharing_usage_limit_exceeded/i.test(error);
    if (typeof error !== "object" || seen.has(error)) return false;
    seen.add(error);
    const value = error as { status?: number; statusCode?: number; message?: string; cause?: unknown };
    if (value.status === 429 || value.statusCode === 429 || isModelRateLimit(value.message)) return true;
    error = value.cause;
  }
  return false;
}

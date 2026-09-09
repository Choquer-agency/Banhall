/** Provider errors may carry prompts, headers and response bodies. Log none of them. */
export function safeErrorDetails(error: unknown): { statusCode?: number; retryable?: boolean } {
  if (!error || typeof error !== "object") return {};
  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const retryable = "isRetryable" in error ? error.isRetryable : undefined;
  return {
    ...(typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? { statusCode } : {}),
    ...(typeof retryable === "boolean" ? { retryable } : {}),
  };
}

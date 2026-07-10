function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Domain error code (convex/lib/contracts.ts) carried by a ConvexError, if any. */
export function userErrorCode(error: unknown): string | null {
  if (isRecord(error) && isRecord(error.data) && typeof error.data.code === "string") {
    return error.data.code;
  }
  if (error instanceof Error) {
    const marker = "Uncaught ConvexError: ";
    const markerIndex = error.message.indexOf(marker);
    if (markerIndex >= 0) {
      const payload = error.message.slice(markerIndex + marker.length).split("\n", 1)[0];
      try {
        const parsed: unknown = JSON.parse(payload);
        if (isRecord(parsed) && typeof parsed.code === "string") return parsed.code;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function userErrorMessage(error: unknown, fallback: string): string {
  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === "string") {
    return error.data.message;
  }
  if (!(error instanceof Error)) return fallback;
  const marker = "Uncaught ConvexError: ";
  const markerIndex = error.message.indexOf(marker);
  if (markerIndex >= 0) {
    const payload = error.message.slice(markerIndex + marker.length).split("\n", 1)[0];
    try {
      const parsed: unknown = JSON.parse(payload);
      if (isRecord(parsed) && typeof parsed.message === "string") return parsed.message;
    } catch {
      return fallback;
    }
  }
  if (error.message.startsWith("[CONVEX ") || error.message === "Server Error") return fallback;
  return error.message || fallback;
}

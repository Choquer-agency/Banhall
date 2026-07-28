export function normalizeEmail(raw: string | null | undefined) {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return normalized && normalized.includes("@") ? normalized : null;
}

export function isNormalizedEmail(email: string) {
  return normalizeEmail(email) === email;
}

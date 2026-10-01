/** Existing deterministic Self-check semantics; not semantic claim classification. */
export function normalizeExclusionMatch(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}
export function matchesClaimExclusion(
  bullets: readonly string[],
  text: string,
  excerpt?: string,
): boolean {
  return [text, excerpt ?? ""].some(
    (value) =>
      normalizeExclusionMatch(value).trim() !== "" &&
      bullets.some((b) =>
        normalizeExclusionMatch(b).includes(normalizeExclusionMatch(value)),
      ),
  );
}

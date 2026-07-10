// BNH-10 shared industry vocabulary. Values are kebab-case slugs that must
// match the Brain namespace strings (docs/the-brain.md); custom industries
// saved on projects extend this base set.

export const BASE_INDUSTRIES = [
  { value: "software", label: "Software" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "life-sciences", label: "Life sciences" },
] as const;

/** Human label for an industry slug (base label or humanized slug). */
export function industryLabel(slug: string): string {
  return (
    BASE_INDUSTRIES.find((b) => b.value === slug)?.label ??
    slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/** Normalize a typed industry label to its slug form. */
export function industrySlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

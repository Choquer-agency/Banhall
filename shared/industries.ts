export const BASE_INDUSTRIES = [
  { value: "software", label: "Software" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "life-sciences", label: "Life sciences" },
] as const;

export const BASE_INDUSTRY_SLUGS: ReadonlySet<string> = new Set(
  BASE_INDUSTRIES.map(({ value }) => value)
);

export function industrySlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function canUseIndustry(
  role: "writer" | "manager" | "admin" | undefined,
  industry: string,
  exists: boolean
): boolean {
  return BASE_INDUSTRY_SLUGS.has(industry) || exists || role === "admin";
}

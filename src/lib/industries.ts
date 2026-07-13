// BNH-10 shared industry vocabulary. Values are kebab-case slugs that must
// match the Brain namespace strings (docs/the-brain.md); custom industries
// saved on projects extend this base set.

export {
  BASE_INDUSTRIES,
  BASE_INDUSTRY_SLUGS,
  industrySlug,
} from "../../shared/industries";
import { BASE_INDUSTRIES } from "../../shared/industries";

/** Human label for an industry slug (base label or humanized slug). */
export function industryLabel(slug: string): string {
  return (
    BASE_INDUSTRIES.find((b) => b.value === slug)?.label ??
    slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}


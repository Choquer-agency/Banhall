export type ContextCategoryId =
  | "previous_pd"
  | "scoping_notes"
  | "writer_notes"
  | "background"
  | "other";

export interface ContextCategoryDef {
  id: ContextCategoryId;
  label: string;
  help: string;
  /** Relative SR&ED weighting hint shown to the writer. */
  weight: "Highest" | "High" | "Medium" | "Supporting";
  /** Tailwind classes for the color-coded category pill. */
  pill: string;
  /** Idle drop-zone classes — the category's own tint so each zone is
   *  visibly a target (gray-on-white was invisible). Border + bg + text. */
  zone: string;
}

/** Look up a category's label + pill color by id (e.g. for the Files panel). */
export function categoryMeta(
  id: string | null | undefined
): { label: string; pill: string } | null {
  if (!id) return null;
  const def = CONTEXT_CATEGORIES.find((c) => c.id === id);
  return def ? { label: def.label, pill: def.pill } : null;
}

/**
 * Contextual-input categories (BNH-9). Ordered by SR&ED trust/weight — the
 * full per-document weighting is refined with the Brain; these are the buckets.
 */
export const CONTEXT_CATEGORIES: ContextCategoryDef[] = [
  {
    id: "writer_notes",
    label: "Writer's notes",
    help: "Your interview notes / “unreliable narrator” guidance — what to ignore, and the true uncertainties to center on.",
    weight: "Highest",
    pill: "bg-amber-100 text-amber-700",
    zone: "border-amber-300/70 bg-amber-50/60 text-amber-700",
  },
  {
    id: "previous_pd",
    label: "Previous-year reports",
    help: "Last year's PD(s) — for continuation projects and prior-year status.",
    weight: "High",
    pill: "bg-primary/15 text-primary-dark",
    zone: "border-primary/40 bg-primary-wash text-primary-dark",
  },
  {
    id: "scoping_notes",
    label: "Scoping notes",
    help: "Pre-interview scoping meeting notes or a project summary.",
    weight: "Medium",
    pill: "bg-blue-100 text-blue-700",
    zone: "border-blue-300/70 bg-blue-50/60 text-blue-700",
  },
  {
    id: "background",
    label: "Background research",
    help: "Company summaries, online research, links, generally-available info.",
    weight: "Supporting",
    pill: "bg-violet-100 text-violet-700",
    zone: "border-violet-300/70 bg-violet-50/60 text-violet-700",
  },
  {
    id: "other",
    label: "Other supporting docs",
    help: "Anything else relevant to the report.",
    weight: "Supporting",
    pill: "bg-gray-100 text-gray-600",
    zone: "border-gray-300 bg-gray-50 text-gray-500",
  },
];

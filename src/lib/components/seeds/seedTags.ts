/**
 * Seed tag pills (ui-design-final.md section 1, "Seed tag palette"; board
 * F4). Each tag is a fill and an ink from the design tokens: the status
 * families where the colours match, and the seed-tag tokens otherwise.
 */
export type SeedTagStyle = { label: string; background: string; color: string };

const TAGS: Record<string, SeedTagStyle> = {
  conservative: { label: "Conservative", background: "var(--color-success-soft)", color: "var(--color-success-ink-muted)" },
  aggressive: { label: "Aggressive", background: "var(--color-danger-soft)", color: "var(--color-danger-ink-muted)" },
  high_level: { label: "High-level", background: "var(--color-seed-tag-high-level)", color: "var(--color-seed-tag-high-level-ink)" },
  detailed: { label: "Detailed", background: "var(--color-seed-tag-detailed)", color: "var(--color-seed-tag-detailed-ink)" },
  technical: { label: "Technical", background: "var(--color-seed-tag-technical)", color: "var(--color-primary-selected)" },
  alternative_angle: { label: "Alternative angle", background: "var(--color-warning-surface)", color: "var(--color-warning-ink-muted)" },
};

/** A tag outside the palette keeps its own name on the neutral chrome fill. */
export function seedTagStyle(tag: string): SeedTagStyle {
  return TAGS[tag] ?? { label: tag, background: "var(--color-chrome)", color: "var(--color-ink-secondary)" };
}

/** A card shows one or two tag pills. */
export const MAX_CARD_TAGS = 2;

/** The green "Approved" chip reuses the Conservative pair. */
export const APPROVED_CHIP = { background: "var(--color-success-soft)", color: "var(--color-success-ink-muted)" } as const;

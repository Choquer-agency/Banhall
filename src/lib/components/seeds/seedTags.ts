/**
 * Seed tag pills (ui-design-final.md section 1, "Seed tag palette"). The
 * palette is a fixed contract palette, so its hex values live here and
 * nowhere else in the plan.
 */
export type SeedTagStyle = { label: string; background: string; color: string };

const TAGS: Record<string, SeedTagStyle> = {
  conservative: { label: "Conservative", background: "#DCFCE7", color: "#15803D" },
  aggressive: { label: "Aggressive", background: "#FEE2E2", color: "#B91C1C" },
  high_level: { label: "High-level", background: "#EFF6FF", color: "#1447E6" },
  detailed: { label: "Detailed", background: "#FAF5FF", color: "#7E22CE" },
  technical: { label: "Technical", background: "#D5F3F1", color: "#087A75" },
  alternative_angle: { label: "Alternative angle", background: "#FFFBEB", color: "#B45309" },
};

/** A tag outside the palette keeps its own name on the neutral chrome fill. */
export function seedTagStyle(tag: string): SeedTagStyle {
  return TAGS[tag] ?? { label: tag, background: "var(--color-chrome)", color: "var(--color-ink-secondary)" };
}

/** A card shows one or two tag pills. */
export const MAX_CARD_TAGS = 2;

/** The green "Approved" chip reuses the Conservative pair. */
export const APPROVED_CHIP = { background: "#DCFCE7", color: "#15803D" } as const;

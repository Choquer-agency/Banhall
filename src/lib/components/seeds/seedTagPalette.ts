import { SEED_TAG_DISPLAY_LABELS } from "../../../../shared/pdSubsections";

/** The fixed Seed tag palette (ui-design-final.md section 1). */
export const SEED_TAG_PALETTE: Record<keyof typeof SEED_TAG_DISPLAY_LABELS, { bg: string; text: string }> = {
  conservative: { bg: "#DCFCE7", text: "#15803D" },
  aggressive: { bg: "#FEE2E2", text: "#B91C1C" },
  high_level: { bg: "#EFF6FF", text: "#1447E6" },
  detailed: { bg: "#FAF5FF", text: "#7E22CE" },
  technical: { bg: "#D5F3F1", text: "#087A75" },
  alternative_angle: { bg: "#FFFBEB", text: "#B45309" },
};

function isKnownTag(tag: string): tag is keyof typeof SEED_TAG_DISPLAY_LABELS {
  return Object.prototype.hasOwnProperty.call(SEED_TAG_DISPLAY_LABELS, tag);
}

export function seedTagLabel(tag: string): string {
  return isKnownTag(tag) ? SEED_TAG_DISPLAY_LABELS[tag] : tag;
}

/** Inline colours for a tag pill; an unknown tag falls back to the gray ramp. */
export function seedTagStyle(tag: string): string {
  if (!isKnownTag(tag)) return "background:var(--color-gray-50);color:var(--color-ink-secondary)";
  const colors = SEED_TAG_PALETTE[tag];
  return `background:${colors.bg};color:${colors.text}`;
}

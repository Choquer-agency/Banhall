/**
 * QA score bands (ui-design-final.md section 1): 80 and up green, 60 to 79
 * orange, below 60 red. The chip always shows its band colour.
 */
export type QaBand = "green" | "orange" | "red";

export const QA_BAND_COLORS: Record<QaBand, { bar: string; chipBg: string; chipText: string }> = {
  green: { bar: "#16A34A", chipBg: "#DCFCE7", chipText: "#15803D" },
  orange: { bar: "#F59E0B", chipBg: "#FFEDD5", chipText: "#C2410C" },
  red: { bar: "#DC2626", chipBg: "#FEE2E2", chipText: "#B91C1C" },
};

export function qaBand(score: number): QaBand {
  if (score >= 80) return "green";
  if (score >= 60) return "orange";
  return "red";
}

export function qaBandColors(score: number) {
  return QA_BAND_COLORS[qaBand(score)];
}

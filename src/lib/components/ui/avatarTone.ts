export type AvatarTone = "fir" | "teal" | "purple";

const TONES: readonly AvatarTone[] = ["fir", "teal", "purple"];

/** Same seed, same tone, on every surface. Empty seeds are fir. */
export function avatarTone(seed: string | null | undefined): AvatarTone {
  if (!seed) return "fir";
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return TONES[hash % TONES.length];
}

/** Two letters from a display name ("Johnny Nguyen" is "JN"); "?" when empty. */
export function initialsFor(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

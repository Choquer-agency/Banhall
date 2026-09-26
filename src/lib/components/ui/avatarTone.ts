import type { RoleChipKind } from "$lib/roles/roleChip";

/**
 * Person tones follow the role the boards show next to the avatar (A1 to
 * D5, I1): Consultant and Manager fir, Owner teal, Developer purple, and
 * Admin (not drawn on any board) the ink of its blue role chip.
 * `avatarTone(seed)` is the fallback where the role is unknown. "invite"
 * (J5, J9 banner inviter) and "faded" (J6 expired inviter) are fixed tones
 * for those two screens only.
 */
export type AvatarTone = "fir" | "teal" | "purple" | "admin" | "invite" | "faded";

const ROLE_TONES: Record<RoleChipKind, AvatarTone> = {
  consultant: "fir",
  manager: "fir",
  owner: "teal",
  developer: "purple",
  admin: "admin",
};

/** The tone for a person whose role chip is known (`roleChipKind`). */
export function roleAvatarTone(kind: RoleChipKind | null | undefined): AvatarTone {
  return kind ? ROLE_TONES[kind] : "fir";
}

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

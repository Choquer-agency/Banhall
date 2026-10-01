// C3 email chips. Commas, spaces, semicolons and new lines separate
// addresses; the shape check matches convex/invites.ts (the server decides).
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_INVITE_EMAILS = 20;

export type EmailChip = { value: string; valid: boolean };

export function isInviteEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

export function splitEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Add addresses to the chip list; duplicates (any case) collapse into the first. */
export function addChips(chips: EmailChip[], values: string[]): EmailChip[] {
  const next = [...chips];
  const seen = new Set(next.map((chip) => chip.value.toLowerCase()));
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ value, valid: isInviteEmail(value) });
  }
  return next;
}

export function inviteLink(origin: string, token: string): string {
  return `${origin}/signup/${token}`;
}

export function sendLabel(count: number): string {
  if (count <= 1) return "Send invite";
  return `Send ${count} invites`;
}

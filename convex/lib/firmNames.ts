/**
 * The consulting firm's own names (owner decision 26, audit wave 2 on
 * 2026-09-26). An admin lists the firm's name and its short forms; every
 * masked model call hides them as it hides the client's name. Empty unless
 * an admin sets them: the app never guesses the firm's name.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const FIRM_NAMES_KEY = "privacy.firmNames";

/** How many names and short forms the setting keeps. */
export const MAX_FIRM_NAMES = 12;
/** Longest name or short form, in characters. */
export const MAX_FIRM_NAME_CHARS = 120;

/**
 * Trimmed, spaces collapsed, blank lines and repeats dropped, in the order
 * given. Throws on a list over the limits so an admin sees why nothing saved.
 */
export function normalizeFirmNames(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name || out.includes(name)) continue;
    if (name.length > MAX_FIRM_NAME_CHARS) {
      throw new Error(`A firm name can be at most ${MAX_FIRM_NAME_CHARS} characters.`);
    }
    // A name the placeholder map cannot hide is refused, never saved in
    // silence (review 2026-09-26, P3).
    const problem = firmNameProblem(name);
    if (problem) throw new Error(problem);
    out.push(name);
  }
  if (out.length > MAX_FIRM_NAMES) throw new Error(`List at most ${MAX_FIRM_NAMES} names.`);
  return out;
}

/**
 * Why a firm name cannot be hidden, if it cannot: the placeholder map
 * needs two characters and a letter. Shared with the settings card.
 */
export function firmNameProblem(name: string): string | undefined {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  if (trimmed.length < 2) return `"${trimmed}" is too short to hide. Use at least 2 characters.`;
  if (!/\p{L}/u.test(trimmed)) return `"${trimmed}" has no letters, so it cannot be hidden.`;
  return undefined;
}

/** The stored value as a list; anything unreadable reads as none. */
export function parseFirmNames(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    // Lenient: a stored name is never dropped for being long, so the firm
    // stays hidden even if the limits change.
    const out: string[] = [];
    for (const raw of parsed) {
      if (typeof raw !== "string") continue;
      const name = raw.replace(/\s+/g, " ").trim();
      if (name && !out.includes(name)) out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

export async function firmNames(ctx: QueryCtx | MutationCtx): Promise<string[]> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", FIRM_NAMES_KEY))
    .unique();
  return parseFirmNames(row?.value);
}

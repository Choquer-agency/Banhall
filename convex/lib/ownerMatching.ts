import type { Doc, Id } from "../_generated/dataModel";
import { normalizeEmail } from "./email";
import { isTeamRosterMember, userDisplayLabel } from "./teamRoster";

export type OwnerCandidate = {
  userId: Id<"users">;
  label: string;
  email: string | null;
  matchedBy: "email" | "name";
};

export type OwnerMatch =
  | { kind: "matched"; matchedBy: "email" | "name"; user: Doc<"users"> }
  | { kind: "ambiguous"; matchedBy: "email" | "name"; users: Doc<"users">[] }
  | { kind: "none" };

export function normalizeFullName(raw: string | null | undefined) {
  const normalized = raw?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? "";
  return normalized || null;
}

export function userNameKeys(user: Doc<"users">) {
  const keys = new Set<string>();
  const fullName = normalizeFullName(
    [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(" ")
  );
  const legacyName = normalizeFullName(user.name);
  if (fullName) keys.add(fullName);
  if (legacyName) keys.add(legacyName);
  return keys;
}

export function matchWriterText(
  writerText: string | null | undefined,
  roster: Doc<"users">[]
): OwnerMatch {
  const users = roster.filter(isTeamRosterMember);
  const email = normalizeEmail(writerText);
  if (email) {
    const matches = users.filter((user) => normalizeEmail(user.email) === email);
    if (matches.length === 1) {
      return { kind: "matched", matchedBy: "email", user: matches[0] };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous", matchedBy: "email", users: matches };
    }
  }

  const name = normalizeFullName(writerText);
  if (!name) return { kind: "none" };
  const matches = users.filter((user) => userNameKeys(user).has(name));
  if (matches.length === 1) {
    return { kind: "matched", matchedBy: "name", user: matches[0] };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", matchedBy: "name", users: matches };
  }
  return { kind: "none" };
}

export function ownerCandidates(match: OwnerMatch): OwnerCandidate[] {
  const users =
    match.kind === "matched"
      ? [match.user]
      : match.kind === "ambiguous"
        ? match.users
        : [];
  if (match.kind === "none") return [];
  return users.map((user) => ({
    userId: user._id,
    label: userDisplayLabel(user),
    email: user.email?.trim() || null,
    matchedBy: match.matchedBy,
  }));
}

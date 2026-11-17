import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmail } from "./email";
import { domainError } from "./contracts";
import { cleanWriterName, takesInitialsWriter, type IngestionItemFields, type InitialsWriter } from "./ingestionSheet";
import { looksLikeEmail, writerInitialsKey } from "../../shared/importSheetRules";
import { sameWriterName, writerNameForInitials } from "../../shared/writerNameFromText";
import type { WriterChoice } from "./ingestionSheetValidators";

type Ctx = QueryCtx | MutationCtx;
type UserLabelSource = Pick<
  Doc<"users">,
  "name" | "email" | "firstName" | "lastName"
>;

const TEAM_ROSTER_LIMIT = 200;

/** Anonymous auth records are not Banhall team members. */
export function isTeamRosterMember(
  user: Doc<"users"> | null
): user is Doc<"users"> {
  return user !== null && user.isAnonymous !== true;
}

/** Stable label snapshotted onto project records at creation time.
 * Precedence: "First Last" → legacy single-field name → email. */
export function userDisplayLabel(user: UserLabelSource): string {
  const full = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ");
  return full || user.name?.trim() || user.email?.trim() || "Unknown team member";
}

export async function listTeamRoster(ctx: Ctx): Promise<Doc<"users">[]> {
  const users = await ctx.db.query("users").take(TEAM_ROSTER_LIMIT);
  return users.filter(isTeamRosterMember);
}

export async function getTeamRosterMemberOrNull(
  ctx: Ctx,
  userId: Id<"users">
): Promise<Doc<"users"> | null> {
  const user = await ctx.db.get(userId);
  return isTeamRosterMember(user) ? user : null;
}

/**
 * Legacy project/report metadata may contain an account email. Resolve it at
 * read time so profile name changes appear immediately while the stored audit
 * snapshot remains untouched. Non-email labels and accounts without a human
 * name pass through unchanged.
 */
export async function resolveLiveUserLabel(
  ctx: Ctx,
  storedLabel: string | null | undefined,
  userId?: Id<"users"> | string
): Promise<string | undefined> {
  const label = storedLabel?.trim();
  if (!label) return undefined;
  const email = normalizeEmail(label);
  if (!email) return label;

  const matches = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(2);
  let user = matches.length === 1 ? matches[0] : null;
  if (userId) {
    const normalizedUserId = ctx.db.normalizeId("users", userId);
    const candidate = normalizedUserId ? await ctx.db.get(normalizedUserId) : null;
    if (isTeamRosterMember(candidate)) user = candidate;
  }
  if (!isTeamRosterMember(user)) return label;

  const fullName = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ");
  return fullName || user.name?.trim() || label;
}

// ─── Writers from initials (2026-11-16, docs/product-domain.md) ─────────────
// A writer (pdWriters) is a person who wrote PDs, with a login (a team
// member, `userId`) or without one (a past writer). The writer of an import
// file whose name has writer initials ("T1.DW.PN") comes from, in order:
// 1. a person's pick for those initials for the whole firm (pdWriterPicks):
//    every such file follows it, remembering the writer it had, and its
//    Undo gives each file exactly that writer back;
// 2. otherwise, only while the file has no writer yet (the freeze rule), the
//    check, writerForInitials:
//    a. exactly one team member whose saved initials are these: that
//       member's own writer, made if they have none yet;
//    b. two or more such members: no writer (a person must choose);
//    c. exactly one writer the check made from these initials (with no
//       login, or one an Admin has since linked to an account): that writer;
//    d. two or more: no writer; none: a new writer with no login, just the
//       initials ("DW").
// A file that has a writer keeps it until a pick, a person or an Admin's
// Link or Unlink says otherwise; Link and Unlink change the writer's
// account, never a file's writer. Every lookup goes through an index and
// reads a handful of rows.

type WriterDoc = Doc<"pdWriters">;

/**
 * Team members read for one set of initials: enough to tell one from
 * several. Only team members with a role are given initials (the backfill,
 * invite acceptance, a name saved, an Admin's change), so the rows read are
 * members; the filter below is a guard.
 */
const INITIALS_READ = 20;
/** Writers read for one set of initials, one account or one name. */
const WRITERS_READ = 10;
/** Writers with no login read when checking a name is free (the Team page lists as many). */
const PAST_WRITERS_READ = 200;

/** A team member who has a login: on the roster, with a role. */
export function isLoginMember(user: Doc<"users"> | null): user is Doc<"users"> {
  return isTeamRosterMember(user) && user.role !== undefined;
}

/** The team members whose saved initials are exactly `initials` (upper case). */
export async function membersWithInitials(ctx: Ctx, initials: string): Promise<Doc<"users">[]> {
  if (!initials) return [];
  const users = await ctx.db
    .query("users")
    .withIndex("by_initials", (q) => q.eq("initials", initials))
    .take(INITIALS_READ);
  return users.filter(isLoginMember);
}

/** A writer by id; null when it is gone. */
export async function liveWriter(ctx: Ctx, id: Id<"pdWriters"> | undefined | null): Promise<WriterDoc | null> {
  return id ? await ctx.db.get(id) : null;
}

/**
 * What a writer is called: the linked team member's name, else the name an
 * Admin gave it, else its initials. A member with no real name (their
 * roster label is only an email address, or "Unknown team member") is
 * never shown by their email: the writer's own name or initials, else the
 * member's saved initials, else "Unknown writer".
 */
export function writerLabelFor(writer: WriterDoc, user: Doc<"users"> | null): string {
  const own = writer.name?.trim() || writer.initials || null;
  if (writer.userId && user) {
    const label = userDisplayLabel(user);
    if (label !== "Unknown team member" && !looksLikeEmail(label)) return label;
    return own ?? (user.initials || "Unknown writer");
  }
  return own ?? "Unknown writer";
}

/** A writer's label as it is now (writerLabelFor, reading the linked member). */
export async function writerLabel(ctx: Ctx, writer: WriterDoc): Promise<string> {
  const user = writer.userId ? await ctx.db.get(writer.userId) : null;
  return writerLabelFor(writer, user);
}

async function writersOfUser(ctx: Ctx, userId: Id<"users">): Promise<WriterDoc[]> {
  return await ctx.db
    .query("pdWriters")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(WRITERS_READ);
}

/** A team member's own writer (not one an Admin linked to them), or null when they have none yet. */
export async function writerOfUser(ctx: Ctx, userId: Id<"users">): Promise<WriterDoc | null> {
  return (await writersOfUser(ctx, userId)).find((row) => row.linkedAt === undefined) ?? null;
}

/** The past writer an Admin linked to a team member, or null. */
export async function linkedWriterOf(ctx: Ctx, userId: Id<"users">): Promise<WriterDoc | null> {
  return (await writersOfUser(ctx, userId)).find((row) => row.linkedAt !== undefined) ?? null;
}

/** A team member's own writer, made (no initials, no name) when they have none yet. */
export async function writerForUser(ctx: MutationCtx, user: Doc<"users">): Promise<WriterDoc> {
  const existing = await writerOfUser(ctx, user._id);
  if (existing) return existing;
  const id = await ctx.db.insert("pdWriters", {
    userId: user._id,
    createdVia: "import",
    createdAt: Date.now(),
    fileCount: 0,
  });
  return (await ctx.db.get(id))!;
}

/**
 * The writers the check made from these initials (step c): a person's
 * typed writer has no initials, and one the migration made for a person's
 * statement is left out too, since its pick carries the initials.
 */
async function writersMadeFromInitials(ctx: Ctx, initials: string): Promise<WriterDoc[]> {
  const rows = await ctx.db
    .query("pdWriters")
    .withIndex("by_initials", (q) => q.eq("initials", initials))
    .take(WRITERS_READ);
  return rows.filter((row) => row.createdVia === "import");
}

/** What one mutation has worked out for each set of initials (writerForInitials, pickedWriter). */
const initialsMemo = new WeakMap<object, Map<string, InitialsWriter | null>>();

function memoOf(ctx: MutationCtx): Map<string, InitialsWriter | null> {
  let memo = initialsMemo.get(ctx);
  if (!memo) {
    memo = new Map();
    initialsMemo.set(ctx, memo);
  }
  return memo;
}

/**
 * Forget what this mutation worked out for initials: call after writing a
 * pick, a member's initials or a writer, so later files in the same
 * mutation are matched against the new facts.
 */
export function forgetWriterMatches(ctx: MutationCtx): void {
  initialsMemo.delete(ctx);
}

/** The person's pick for these initials for the whole firm, or null. */
export async function writerPick(ctx: Ctx, initials: string): Promise<Doc<"pdWriterPicks"> | null> {
  return await ctx.db
    .query("pdWriterPicks")
    .withIndex("by_initials", (q) => q.eq("initials", initials))
    .first();
}

/**
 * The writer a person's pick for these initials names (its id as the pick
 * stores it, and its label now), or null when there is no pick. Remembered
 * for the rest of the mutation.
 */
export async function pickedWriter(ctx: MutationCtx, initials: string): Promise<InitialsWriter | null> {
  const memo = memoOf(ctx);
  const key = `pick:${initials}`;
  if (memo.has(key)) return memo.get(key) ?? null;
  const pick = await writerPick(ctx, initials);
  const writer = pick ? await ctx.db.get(pick.writerId) : null;
  const result = writer ? { id: writer._id, label: await writerLabel(ctx, writer) } : null;
  memo.set(key, result);
  return result;
}

/**
 * The writer the check gives a file with no writer whose name gave
 * `initials` (two or three letters, upper case), or null when a person
 * must choose (steps a to d above). May make a writer (a team member's own,
 * or one with no login). Remembered for the rest of the mutation
 * (forgetWriterMatches clears it).
 */
export async function writerForInitials(ctx: MutationCtx, initials: string): Promise<InitialsWriter | null> {
  const memo = memoOf(ctx);
  if (memo.has(initials)) return memo.get(initials) ?? null;
  const writer = await checkInitials(ctx, initials);
  const result = writer ? { id: writer._id, label: await writerLabel(ctx, writer) } : null;
  memo.set(initials, result);
  return result;
}

async function checkInitials(ctx: MutationCtx, initials: string): Promise<WriterDoc | null> {
  const members = await membersWithInitials(ctx, initials);
  if (members.length === 1) return await writerForUser(ctx, members[0]);
  if (members.length > 1) return null;
  const writers = await writersMadeFromInitials(ctx, initials);
  if (writers.length === 1) return writers[0];
  if (writers.length > 1) return null;
  return await newWriterFromInitials(ctx, initials);
}

async function newWriterFromInitials(ctx: MutationCtx, initials: string): Promise<WriterDoc> {
  const id = await ctx.db.insert("pdWriters", {
    initials,
    createdVia: "import",
    createdAt: Date.now(),
    fileCount: 0,
  });
  return (await ctx.db.get(id))!;
}

/**
 * The bare writer with no login for these initials, for an Undo that names
 * one which has since been removed (removableWhenUnused): the one the check
 * made with no account and no name a person gave it (just its initials, or
 * a name read from a PD, which is still THE writer for those initials),
 * else a new one. Same initials, no name a person gave: the same writer as
 * far as anyone can see.
 */
export async function bareWriterFromInitials(ctx: MutationCtx, initials: string): Promise<WriterDoc> {
  const made = await writersMadeFromInitials(ctx, initials);
  return made.find((row) => !row.userId && !nameByPerson(row)) ?? (await newWriterFromInitials(ctx, initials));
}

/** Whether a person gave the writer its name: a name not read from a PD. */
function nameByPerson(writer: WriterDoc): boolean {
  return Boolean(writer.name) && writer.nameSource !== "document";
}

/**
 * Whether a PD may name this writer (2026-11-16): a writer the check made
 * from initials, with no login, whose name (if any) was read from a PD, and
 * which no person named or cleared and whose PDs never disagreed.
 */
export function documentMayName(writer: WriterDoc): boolean {
  return (
    writer.createdVia === "import" &&
    !writer.userId &&
    writer.nameSource !== "person" &&
    writer.nameSource !== "documents_disagree" &&
    !nameByPerson(writer)
  );
}

/**
 * Whether a name read from a PD is someone's already, in any case: another
 * writer with no login has it (one a person typed on Import, say), or a
 * team member with a login is called that. Then a person decides: two
 * writers never share a name. Bounded reads (the past writers and the
 * roster, 200 each), made only when a writer is about to be named.
 */
async function nameTaken(ctx: MutationCtx, name: string, writerId: Id<"pdWriters">): Promise<boolean> {
  const pastWriters = await ctx.db
    .query("pdWriters")
    .withIndex("by_userId", (q) => q.eq("userId", undefined))
    .take(PAST_WRITERS_READ);
  if (pastWriters.some((other) => other._id !== writerId && other.name && sameWriterName(other.name, name))) return true;
  const members = (await listTeamRoster(ctx)).filter(isLoginMember);
  return members.some((member) => sameWriterName(userDisplayLabel(member), name));
}

type NamingInput = Pick<IngestionItemFields, "writerId" | "writerInitials" | "category" | "documentWriterNames" | "clientName">;

/**
 * A past writer's name from a file's PD text (2026-11-16, docs/product-domain.md):
 * when the file is a final PD, draft or review copy whose writer is a past
 * writer the check made from these same initials (documentMayName), and
 * exactly one name its text gives matches the initials and is not the
 * file's company name (shared/writerNameFromText.ts writerNameForInitials),
 * the writer with no name takes it (nameSource "document"), unless another
 * writer with no login or a team member already has that name (nameTaken). A writer named by a PD that a
 * later file names differently goes back to its initials and is never
 * named by a PD again ("documents_disagree"); the same name changes
 * nothing. An Admin's name always wins. Returns the writer and its new
 * label when it changed (the caller writes its files again), else null.
 * Reads one writer; writes it only when its name changes.
 */
export async function nameWriterFromDocument(
  ctx: MutationCtx,
  row: NamingInput
): Promise<{ writerId: Id<"pdWriters">; label: string } | null> {
  if (!row.writerId || !row.documentWriterNames?.length || !takesInitialsWriter(row)) return null;
  const initials = writerInitialsKey(row.writerInitials);
  const candidate = writerNameForInitials(row.documentWriterNames, initials, { companyName: row.clientName });
  if (candidate === null) return null;
  const writer = await ctx.db.get(row.writerId);
  if (!writer || writer.initials !== initials || !documentMayName(writer)) return null;
  let patch: Partial<WriterDoc>;
  if (!writer.name) {
    if (await nameTaken(ctx, candidate, writer._id)) return null;
    patch = { name: candidate, nameSource: "document" };
  } else if (sameWriterName(writer.name, candidate)) return null;
  else patch = { name: undefined, nameSource: "documents_disagree" };
  await ctx.db.patch(writer._id, patch);
  forgetWriterMatches(ctx);
  return { writerId: writer._id, label: writerLabelFor({ ...writer, ...patch }, null) };
}

/**
 * The writer a person chose (writerChoiceValidator): a team member's own
 * (made if they have none), a writer by id, or, for a typed name, the
 * writer with no login that has exactly that name, else a new one with that
 * name and no initials (a pick carries the initials). Choosing a writer
 * whose name came from a PD makes that name a person's (confirmDocumentName).
 */
export async function writerForChoice(
  ctx: MutationCtx,
  choice: WriterChoice,
  options: { by?: Id<"users"> }
): Promise<WriterDoc> {
  if (choice.kind === "user") {
    const user = await ctx.db.get(choice.userId);
    if (!isLoginMember(user)) domainError("INVALID_INPUT", "That person is not on the team.");
    return await writerForUser(ctx, user);
  }
  if (choice.kind === "writer") {
    const writer = await liveWriter(ctx, choice.writerId);
    if (writer) return await confirmDocumentName(ctx, writer, options.by);
    const initials = writerInitialsKey(choice.orInitials);
    if (initials !== null) return await bareWriterFromInitials(ctx, initials);
    domainError("NOT_FOUND", "That writer is no longer in Banhall.");
  }
  const name = cleanWriterName(choice.name);
  const named = await ctx.db
    .query("pdWriters")
    .withIndex("by_name", (q) => q.eq("name", name))
    .take(WRITERS_READ);
  const existing = named.find((row) => row.userId === undefined);
  if (existing) return await confirmDocumentName(ctx, existing, options.by);
  const id = await ctx.db.insert("pdWriters", {
    name,
    createdVia: "person",
    ...(options.by ? { createdBy: options.by } : {}),
    createdAt: Date.now(),
    fileCount: 0,
  });
  forgetWriterMatches(ctx);
  return (await ctx.db.get(id))!;
}

/**
 * A person chose this writer (by its name or from a list, on one file or
 * for some initials): a name it took from a PD is now a person's
 * (nameSource "person"), so no later PD that disagrees takes it back and
 * the files they set keep showing it. Any other writer is returned as it is.
 */
async function confirmDocumentName(ctx: MutationCtx, writer: WriterDoc, by: Id<"users"> | undefined): Promise<WriterDoc> {
  if (!writer.name || writer.nameSource !== "document") return writer;
  const patch: Partial<WriterDoc> = { nameSource: "person", ...(by ? { updatedBy: by, updatedAt: Date.now() } : {}) };
  await ctx.db.patch(writer._id, patch);
  forgetWriterMatches(ctx);
  return { ...writer, ...patch };
}

/**
 * Whether a writer is a bare one the check made that no person ever changed
 * (named, linked or unlinked). A name read from a PD is not a person's
 * change: such a writer is still bare.
 */
function untouchedBareWriter(writer: WriterDoc): boolean {
  return (
    writer.createdVia === "import" &&
    !writer.userId &&
    !nameByPerson(writer) &&
    writer.nameSource !== "person" &&
    writer.linkedAt === undefined &&
    writer.updatedBy === undefined
  );
}

/**
 * How an Undo names a writer (matchWriterInitials's `previous`): by id,
 * since a writer with an account, a name or a person's change is never
 * removed. A bare writer the check made also carries its initials, to
 * stand in if it has been removed meanwhile (removableWhenUnused).
 */
export function choiceForUndo(writer: WriterDoc): WriterChoice {
  if (untouchedBareWriter(writer) && writer.initials) {
    return { kind: "writer", writerId: writer._id, orInitials: writer.initials };
  }
  return { kind: "writer", writerId: writer._id };
}

/**
 * Whether a writer can go once nothing points at it (no file, no file
 * remembering it from before a pick, no person's pick): only a bare one the
 * check made that no person ever named, linked or unlinked. It is made again
 * if a file needs it, and an Undo that named it gets an equal one
 * (bareWriterFromInitials). Every other writer with no files (one typed on
 * Import, one at 0 after Unlink) stays until an Admin deletes it.
 */
async function removableWhenUnused(ctx: Ctx, writer: WriterDoc): Promise<boolean> {
  if (!untouchedBareWriter(writer) || writer.fileCount > 0 || (writer.heldCount ?? 0) > 0) return false;
  const pick = await ctx.db
    .query("pdWriterPicks")
    .withIndex("by_writerId", (q) => q.eq("writerId", writer._id))
    .first();
  return pick === null;
}

/**
 * Moves the counts when a file's writer, or the writer it remembers from
 * before a pick, changes (insertItem and patchItem; null for none). A bare
 * writer the check made goes when nothing points at it any more
 * (removableWhenUnused).
 *
 * Not sharded: every file staged for one writer writes that writer's row,
 * so a large sync whose files share one writer serializes on it. Convex
 * retries the conflicting writes; the import feeders write at most a Graph
 * page (250 files) per mutation, so this is a slower sync, not a failure.
 * Shard the counter (several rows per writer, summed on read) if it shows.
 */
export async function adjustWriterFiles(
  ctx: MutationCtx,
  before: Id<"pdWriters"> | undefined | null,
  after: Id<"pdWriters"> | undefined | null,
  heldBefore?: Id<"pdWriters"> | null,
  heldAfter?: Id<"pdWriters"> | null
): Promise<void> {
  const moves: Array<[Id<"pdWriters"> | undefined | null, "fileCount" | "heldCount", number]> = [];
  if ((before ?? null) !== (after ?? null)) moves.push([after, "fileCount", 1], [before, "fileCount", -1]);
  if ((heldBefore ?? null) !== (heldAfter ?? null)) moves.push([heldAfter, "heldCount", 1], [heldBefore, "heldCount", -1]);
  const lowered = new Set<Id<"pdWriters">>();
  for (const [id, field, by] of moves) {
    if (!id) continue;
    const writer = await ctx.db.get(id);
    if (!writer) continue;
    await ctx.db.patch(writer._id, { [field]: Math.max(0, (writer[field] ?? 0) + by) });
    if (by < 0) lowered.add(writer._id);
  }
  for (const id of lowered) {
    const writer = await ctx.db.get(id);
    if (writer && (await removableWhenUnused(ctx, writer))) {
      await ctx.db.delete(writer._id);
      forgetWriterMatches(ctx);
    }
  }
}

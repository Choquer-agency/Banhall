import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  forgetWriterMatches,
  isLoginMember,
  linkedWriterOf,
  listTeamRoster,
  liveWriter,
  membersWithInitials,
  userDisplayLabel,
  writerLabelFor,
} from "./lib/teamRoster";
import { cleanWriterName } from "./lib/ingestionSheet";
import { hasCapability } from "./lib/roleCapabilities";
import {
  initialsFromName,
  INITIALS_RULE,
  savedInitials,
  writerInitialsKey,
} from "../shared/importSheetRules";
import {
  getCurrentUserOrNull,
  requireCurrentUser,
  requireRole,
} from "./lib/auth";
import { domainError } from "./lib/contracts";
import { authComponent, createAuth } from "./auth";
import { normalizeEmail } from "./lib/email";

/**
 * The caller's own user row, plus `imageUrl` (round 2: a signed URL for the
 * profile photo in `imageStorageId`, null when there is none).
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return null;
    const imageUrl = user.imageStorageId
      ? await ctx.storage.getUrl(user.imageStorageId)
      : null;
    return { ...user, imageUrl };
  },
});

// BNH-22: team roster for the interviewer picker on the report creation form.
export const listTeam = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getCurrentUserOrNull(ctx);
    if (!viewer || viewer.isAnonymous === true || !viewer.role) return [];
    const users = await listTeamRoster(ctx);
    return users
      .filter((user) => Boolean(user.role))
      .map((user) => ({
        id: user._id,
        name: userDisplayLabel(user),
        email: user.email?.trim() || null,
        role: user.role ?? null,
      }))
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
        });
        return byName || a.id.localeCompare(b.id);
      });
  },
});

// Admin roster for the Users & roles page.
export const listUsers = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.optional(v.string()),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      displayName: v.string(),
      email: v.optional(v.string()),
      role: v.optional(
        v.union(v.literal("writer"), v.literal("manager"), v.literal("admin")),
      ),
      createdAt: v.optional(v.number()),
      hasAuthAccount: v.boolean(),
      isDeveloper: v.boolean(),
      isOwner: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const users = await ctx.db.query("users").take(500);
    return users.map((user) => ({
      _id: user._id,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: userDisplayLabel(user),
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      hasAuthAccount: Boolean(user.authId),
      isDeveloper: user.isDeveloper === true,
      isOwner: user.isOwner === true,
    }));
  },
});

/** Self-service credential update from /settings. Better Auth verifies the current password. */
export const changeMyPassword = mutation({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    if (args.newPassword.length < 8 || args.newPassword.length > 128) {
      domainError(
        "INVALID_INPUT",
        "Password must be between 8 and 128 characters",
      );
    }
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    await auth.api.changePassword({
      body: {
        currentPassword: args.currentPassword,
        newPassword: args.newPassword,
        revokeOtherSessions: true,
      },
      headers,
    });
    return null;
  },
});

/**
 * Admin-assisted account recovery. The target is resolved from our app user
 * document, never from a client-provided Better Auth id. Existing sessions are
 * revoked so the temporary credential becomes the only way back in.
 */
export const setTemporaryPassword = mutation({
  args: {
    userId: v.id("users"),
    temporaryPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin"]);
    if (caller._id === args.userId) {
      domainError(
        "INVALID_INPUT",
        "Use Settings to change your own password with current-password verification",
      );
    }
    if (
      args.temporaryPassword.length < 8 ||
      args.temporaryPassword.length > 128
    ) {
      domainError(
        "INVALID_INPUT",
        "Password must be between 8 and 128 characters",
      );
    }

    const target = await ctx.db.get(args.userId);
    if (!target) domainError("NOT_FOUND", "User not found");
    if (!target.authId) {
      domainError(
        "INVALID_INPUT",
        "This user has not activated their account yet",
      );
    }

    // Use the password implementation configured by Better Auth, then write
    // only through the component's adapter API.
    const authContext = await createAuth(ctx).$context;
    const password = await authContext.password.hash(args.temporaryPassword);
    const credentialAccount = (
      await authContext.internalAdapter.findAccounts(target.authId)
    ).find((account) => account.providerId === "credential");

    if (credentialAccount) {
      await authContext.internalAdapter.updatePassword(target.authId, password);
    } else {
      await authContext.internalAdapter.createAccount({
        accountId: target.authId,
        providerId: "credential",
        userId: target.authId,
        password,
      });
    }

    await authContext.internalAdapter.deleteUserSessions(target.authId);
    return null;
  },
});

/** Self-service name editing (/settings). */
export const updateMyProfile = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!firstName || !lastName) {
      domainError("INVALID_INPUT", "First and last name are required");
    }
    // 2026-11-16: initials are prefilled once, while none are saved, for a
    // team member with a role. No file is checked again: files keep their writer.
    const initials = user.initials === undefined && isLoginMember(user) ? initialsFromName(firstName, lastName) : null;
    await ctx.db.patch(user._id, { firstName, lastName, ...(initials ? { initials } : {}) });
  },
});

// Admin-only role assignment from the Users & roles page.
export const setUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(
      v.literal("writer"),
      v.literal("manager"),
      v.literal("admin"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin"]);
    if (caller._id === args.userId && args.role !== "admin") {
      domainError("INVALID_INPUT", "You cannot remove your own admin role");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) domainError("NOT_FOUND", "User not found");
    await ctx.db.patch(args.userId, { role: args.role });
    return null;
  },
});

// Admin-managed developer-tool exposure. This is deliberately separate from
// roles and capabilities: it only reveals diagnostic/support navigation.
// 2026-08-19: managing these flags is itself limited to developers and
// workspace Owners — plain admins neither see nor change them.
async function requireFlagManager(ctx: MutationCtx) {
  const caller = await requireRole(ctx, ["admin"]);
  if (caller.isDeveloper !== true && caller.isOwner !== true) {
    domainError(
      "NOT_AUTHORIZED",
      "Only developers and workspace owners can change these flags"
    );
  }
  return caller;
}

export const setUserDeveloper = mutation({
  args: {
    userId: v.id("users"),
    isDeveloper: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireFlagManager(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) domainError("NOT_FOUND", "User not found");
    await ctx.db.patch(args.userId, { isDeveloper: args.isDeveloper });
    return null;
  },
});

// Workspace Owner exposure (e.g. the product owner). Same presentation-only
// contract as isDeveloper; distinct from a project's Owner.
export const setUserOwner = mutation({
  args: {
    userId: v.id("users"),
    isOwner: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireFlagManager(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) domainError("NOT_FOUND", "User not found");
    await ctx.db.patch(args.userId, { isOwner: args.isOwner });
    return null;
  },
});

// Run from the CLI to grant a role, e.g.:
//   npx convex run users:setRole '{"email":"demo@banhall.ca","role":"admin"}'
export const setRole = internalMutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal("writer"),
      v.literal("manager"),
      v.literal("admin"),
    ),
  },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("A valid email address is required");
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new Error(`No user with email ${email}`);
    await ctx.db.patch(user._id, { role: args.role });
    return user._id;
  },
});

// CLI helper for workspace Owner exposure, e.g.:
//   npx convex run users:setOwner '{"email":"owner@example.com","isOwner":true}'
export const setOwner = internalMutation({
  args: {
    email: v.string(),
    isOwner: v.boolean(),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("A valid email address is required");
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new Error(`No user with email ${email}`);
    await ctx.db.patch(user._id, { isOwner: args.isOwner });
    return user._id;
  },
});

// CLI helper for initial developer exposure, e.g.:
//   npx convex run users:setDeveloper '{"email":"developer@example.com","isDeveloper":true}'
export const setDeveloper = internalMutation({
  args: {
    email: v.string(),
    isDeveloper: v.boolean(),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("A valid email address is required");
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new Error(`No user with email ${email}`);
    await ctx.db.patch(user._id, { isDeveloper: args.isDeveloper });
    return user._id;
  },
});

// ─── Writers from initials (2026-11-16, docs/product-domain.md) ─────────────
// A team member's saved initials match the writer initials in imported file
// names ("T1.DW.PN"); a writer with no login (a past writer) is listed on
// Team under Past writers. Admins change initials and manage past writers;
// every function here checks that on the server. The freeze rule: a file's
// writer, once it has one, moves only on a firm-wide pick (and its Undo), a
// person setting it on the file, or here an Admin's Link or Unlink, which
// change a writer's account and never a file's writer. A change of a
// member's initials only fills files that have no writer yet (in scheduled
// pages on To review and Deleted, convex/ingestion.ts applyWriterInitials).

/** Checks again the files with these file initials (two or three letters) that have no writer or follow a pick, in scheduled pages. */
async function recheckInitials(ctx: MutationCtx, ...values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  for (const value of values) {
    const initials = writerInitialsKey(value);
    if (initials === null || seen.has(initials)) continue;
    seen.add(initials);
    await ctx.scheduler.runAfter(0, internal.ingestion.applyWriterInitials, { initials, tab: "review", cursor: null });
  }
}

/** Writes a writer's files on To review and Deleted again with its new label, in scheduled pages. */
async function refreshFilesOf(ctx: MutationCtx, writerId: Id<"pdWriters">) {
  await ctx.scheduler.runAfter(0, internal.ingestion.refreshWriterFiles, { writerId, tab: "review", cursor: null });
}

/**
 * Sets a team member's initials (Team, "Edit initials"). Admin only. 1 to 4
 * letters, saved upper case; empty means none, so the member never matches
 * a file. Another member may have the same initials (files with them that
 * have no writer yet then show "Choose writer"). Returns what was saved and
 * the other members who share it. Files with the old and new initials that
 * have no writer yet are checked again; a file that has a writer keeps it
 * (the freeze rule).
 */
export const setUserInitials = mutation({
  args: { userId: v.id("users"), initials: v.string() },
  returns: v.object({ initials: v.string(), sharedWith: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const initials = savedInitials(args.initials);
    if (initials === null) domainError("INVALID_INPUT", INITIALS_RULE);
    const target = await ctx.db.get(args.userId);
    if (!isLoginMember(target)) domainError("NOT_FOUND", "User not found");
    const before = target.initials;
    if (before !== initials) {
      await ctx.db.patch(target._id, { initials });
      forgetWriterMatches(ctx);
      await recheckInitials(ctx, before, initials);
    }
    const sharedWith = initials
      ? (await membersWithInitials(ctx, initials)).filter((user) => user._id !== target._id).map(userDisplayLabel)
      : [];
    return { initials, sharedWith };
  },
});

const USER_INITIALS_BATCH = 100;

/**
 * Prefills saved initials from first and last names (2026-11-16): each team
 * member with a role, no initials saved and both names gets the first
 * letter of each. A value an Admin saved (even empty) is kept. Paged,
 * schedules the rest; safe to run again. It checks no file again (files
 * keep their writer): run it before ingestion.migrateImportWriterInitials.
 */
export const backfillUserInitials = internalMutation({
  args: { paginationOpts: v.optional(paginationOptsValidator) },
  returns: v.object({ updated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("users")
      .paginate(args.paginationOpts ?? { cursor: null, numItems: USER_INITIALS_BATCH });
    let updated = 0;
    for (const user of page.page) {
      if (user.initials !== undefined || !isLoginMember(user)) continue;
      const initials = initialsFromName(user.firstName, user.lastName);
      if (!initials) continue;
      await ctx.db.patch(user._id, { initials });
      updated += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.users.backfillUserInitials, {
        paginationOpts: { cursor: page.continueCursor, numItems: args.paginationOpts?.numItems ?? USER_INITIALS_BATCH },
      });
    }
    return { updated, done: page.isDone };
  },
});

/** Past writers one read lists. */
const PAST_WRITERS_LIMIT = 200;

const pastWriterValidator = v.object({
  _id: v.id("pdWriters"),
  name: v.union(v.string(), v.null()),
  initials: v.union(v.string(), v.null()),
  label: v.string(),
  fileCount: v.number(),
  // No file points at it, and none remembers it from before a pick: Delete is offered.
  canDelete: v.boolean(),
  // The one team member whose saved initials are this writer's, if there is
  // exactly one: a hint, never a link. `canLink`: Link may name them.
  sameInitialsAs: v.union(
    v.object({ userId: v.id("users"), name: v.string(), canLink: v.boolean() }),
    v.null(),
  ),
});

/** Whether a team member may take a past writer by Link: they have no past writer an Admin linked already. */
async function canTakeLink(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<boolean> {
  return (await linkedWriterOf(ctx, userId)) === null;
}

/**
 * The writers with no login (Team, Past writers), by label. Managers and
 * Admins (team.view) read it; everyone else gets an empty list. Bounded:
 * 200 writers.
 */
export const listPastWriters = query({
  args: {},
  returns: v.array(pastWriterValidator),
  handler: async (ctx) => {
    const viewer = await getCurrentUserOrNull(ctx);
    if (!viewer || viewer.isAnonymous === true || !hasCapability(viewer.role, "team.view")) return [];
    const writers = await ctx.db
      .query("pdWriters")
      .withIndex("by_userId", (q) => q.eq("userId", undefined))
      .take(PAST_WRITERS_LIMIT);
    const rows = [];
    for (const writer of writers) {
      let sameInitialsAs: { userId: Id<"users">; name: string; canLink: boolean } | null = null;
      if (writer.initials) {
        const members = await membersWithInitials(ctx, writer.initials);
        if (members.length === 1) {
          sameInitialsAs = {
            userId: members[0]._id,
            name: userDisplayLabel(members[0]),
            canLink: await canTakeLink(ctx, members[0]._id),
          };
        }
      }
      rows.push({
        _id: writer._id,
        name: writer.name ?? null,
        initials: writer.initials ?? null,
        label: writerLabelFor(writer, null),
        fileCount: writer.fileCount,
        canDelete: writer.fileCount === 0 && (writer.heldCount ?? 0) === 0,
        sameInitialsAs,
      });
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  },
});

/** A writer with no login, for an Admin's change; refuses one that is gone or has a login. */
async function pastWriterOrRefuse(ctx: MutationCtx, writerId: Id<"pdWriters">): Promise<Doc<"pdWriters">> {
  const writer = await liveWriter(ctx, writerId);
  if (!writer) domainError("NOT_FOUND", "That writer is no longer in Banhall.");
  if (writer.userId) domainError("INVALID_INPUT", "This writer is linked to an account. Unlink it first.");
  return writer;
}

/**
 * Names a past writer, or with an empty name goes back to its initials
 * (Team, "Edit name" and "Add a name"). Admin only. The name follows the
 * writer name rules. Its files show the name at once; those on To review
 * and Deleted are written again in scheduled pages.
 */
export const renamePastWriter = mutation({
  args: { writerId: v.id("pdWriters"), name: v.string() },
  returns: v.object({ label: v.string() }),
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const writer = await pastWriterOrRefuse(ctx, args.writerId);
    const typed = args.name.trim();
    if (!typed && !writer.initials) domainError("INVALID_INPUT", "Type the writer's name.");
    const name = typed ? cleanWriterName(typed) : undefined;
    if (name !== writer.name) {
      await ctx.db.patch(writer._id, { name, updatedBy: admin._id, updatedAt: Date.now() });
      forgetWriterMatches(ctx);
      await refreshFilesOf(ctx, writer._id);
    }
    return { label: writerLabelFor({ ...writer, name }, null) };
  },
});

/**
 * Links a past writer to a team member's account (Team, "Link to an
 * account"): its PDs, approved ones included, show under that person from
 * then on, and files with no writer yet whose initials it was made from
 * get it (and so that person). Admin only; never automatic. The member must
 * not have a past writer linked already. No file changes writer: the past
 * writer's account changes, so Unlink puts back exactly what there was
 * (the member's own writer and every pick are untouched). Files on To
 * review and Deleted take the new label in scheduled pages.
 */
export const linkPastWriter = mutation({
  args: { writerId: v.id("pdWriters"), userId: v.id("users") },
  returns: v.object({ label: v.string() }),
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const writer = await pastWriterOrRefuse(ctx, args.writerId);
    const user = await ctx.db.get(args.userId);
    if (!isLoginMember(user)) domainError("INVALID_INPUT", "That person is not on the team.");
    if (!(await canTakeLink(ctx, user._id))) {
      domainError("INVALID_INPUT", `${userDisplayLabel(user)} already has past PDs linked. Unlink them first.`);
    }
    const now = Date.now();
    await ctx.db.patch(writer._id, { userId: user._id, linkedBy: admin._id, linkedAt: now, updatedBy: admin._id, updatedAt: now });
    forgetWriterMatches(ctx);
    await refreshFilesOf(ctx, writer._id);
    await recheckInitials(ctx, writer.initials);
    return { label: userDisplayLabel(user) };
  },
});

/**
 * Takes a past writer off the account an Admin linked it to (Team, the
 * member's menu, after a confirm). Admin only. It is listed under Past
 * writers again and its files show its own name or initials; no file
 * changes writer, so Link then Unlink leaves files and picks as they were.
 */
export const unlinkPastWriter = mutation({
  args: { writerId: v.id("pdWriters") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const writer = await liveWriter(ctx, args.writerId);
    if (!writer) domainError("NOT_FOUND", "That writer is no longer in Banhall.");
    if (!writer.userId || writer.linkedAt === undefined) {
      domainError("INVALID_INPUT", "This writer is not linked to an account by an Admin.");
    }
    await ctx.db.patch(writer._id, {
      userId: undefined,
      linkedBy: undefined,
      linkedAt: undefined,
      updatedBy: admin._id,
      updatedAt: Date.now(),
    });
    forgetWriterMatches(ctx);
    await refreshFilesOf(ctx, writer._id);
    await recheckInitials(ctx, writer.initials);
    return null;
  },
});

/**
 * Deletes a past writer no file points at, or remembers from before a pick
 * (Team, "Delete", after a confirm). Admin only. A person's pick that named
 * it goes too, so files with those initials and no writer go back to the
 * check.
 */
export const deletePastWriter = mutation({
  args: { writerId: v.id("pdWriters") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const writer = await pastWriterOrRefuse(ctx, args.writerId);
    if (writer.fileCount > 0 || (writer.heldCount ?? 0) > 0) {
      domainError("INVALID_INPUT", "Files still point at this writer, so it cannot be deleted.");
    }
    const picks = await ctx.db
      .query("pdWriterPicks")
      .withIndex("by_writerId", (q) => q.eq("writerId", writer._id))
      .take(100);
    for (const pick of picks) await ctx.db.delete(pick._id);
    await ctx.db.delete(writer._id);
    forgetWriterMatches(ctx);
    await recheckInitials(ctx, ...picks.map((pick) => pick.initials));
    return null;
  },
});

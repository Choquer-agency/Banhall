import { query, mutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserOrNull, requireInternalActor } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { normalizeEmail } from "./lib/email";
import { hasCapability } from "./lib/roleCapabilities";
import { liveInvitesForEmail, TOO_MANY_PENDING_INVITES } from "./lib/inviteRows";
import { userDisplayLabel, waitingWriterInvite } from "./lib/teamRoster";
import { canManageInvite } from "../shared/capabilities";
import { personInitials } from "../shared/personInitials";

/**
 * Invite-only membership (BNH-50). Managers and Admins invite from the Team
 * page (round 2, decision 47): Managers invite Consultants and Managers,
 * Admins invite anyone. The invitee opens /signup/<token>. Signup is closed
 * at two layers:
 *  - Layer A: hooks.before in createAuth (convex/auth.ts) rejects
 *    /sign-up/email calls without a matching pending invite token.
 *  - Layer B: the user onCreate trigger throws unless a valid invite exists,
 *    a transactional backstop.
 * There is no email provider (decision 50): creating or resending an invite
 * returns the link for the inviter to copy.
 */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_INVITES_PER_REQUEST = 20;
const TEAM_INVITE_LIMIT = 200;
const MAX_NAME_LENGTH = 100;

const roleValidator = v.union(
  v.literal("writer"),
  v.literal("manager"),
  v.literal("admin"),
);
type InviteRole = Doc<"invites">["role"];

function generateInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// The same shape the browser's type="email" accepts: one non-space local
// part, @, and a domain with a dot.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inviteSentAt(invite: Doc<"invites">) {
  return invite.sentAt ?? invite.createdAt;
}

async function requireInviteManager(ctx: MutationCtx, inviteRole: InviteRole) {
  const viewer = await requireInternalActor(ctx);
  if (!canManageInvite(viewer.role, inviteRole)) {
    domainError(
      "NOT_AUTHORIZED",
      inviteRole === "admin"
        ? "Only an Admin can invite Admins"
        : "Only Managers and Admins can manage invites",
    );
  }
  return viewer;
}

async function requirePendingInvite(ctx: MutationCtx, inviteId: Id<"invites">) {
  const invite = await ctx.db.get(inviteId);
  if (!invite) domainError("NOT_FOUND", "Invite not found");
  if (invite.status !== "pending") {
    domainError("INVALID_STATE", "Only pending invites can be changed");
  }
  return invite;
}

/**
 * An invite for a past writer (2026-11-17): only an Admin, since accepting
 * it links the writer to the account (linking is Admin only); one address;
 * a writer with no login that has no invite waiting already.
 */
async function requirePastWriterInvite(
  ctx: MutationCtx,
  viewer: Doc<"users">,
  writerId: Id<"pdWriters">,
  emails: readonly string[],
) {
  if (!hasCapability(viewer.role, "roles.manage")) {
    domainError("NOT_AUTHORIZED", "Only an Admin can invite a past writer");
  }
  if (emails.length !== 1) domainError("INVALID_INPUT", "Add one email address for this person");
  const writer = await ctx.db.get(writerId);
  if (!writer) domainError("NOT_FOUND", "That writer is no longer in Banhall.");
  if (writer.userId) domainError("INVALID_STATE", "This writer is linked to an account already.");
  if ((await waitingWriterInvite(ctx, writerId)) !== null) {
    domainError("INVALID_STATE", "This person has an invite waiting already. Manage it under Pending invites.");
  }
}

/**
 * Resending an invite for a past writer (2026-11-17) revives its link: only
 * an Admin, only while the writer has no login, and only when no other
 * invite for it waits.
 */
async function requirePastWriterResend(ctx: MutationCtx, viewer: Doc<"users">, invite: Doc<"invites">) {
  if (!invite.pdWriterId) return;
  if (!hasCapability(viewer.role, "roles.manage")) {
    domainError("NOT_AUTHORIZED", "Only an Admin can resend an invite for a past writer");
  }
  const writer = await ctx.db.get(invite.pdWriterId);
  if (!writer) domainError("NOT_FOUND", "That writer is no longer in Banhall.");
  if (writer.userId) domainError("INVALID_STATE", "This writer is linked to an account already.");
  if ((await waitingWriterInvite(ctx, invite.pdWriterId, invite._id)) !== null) {
    domainError("INVALID_STATE", "This person has a newer invite waiting. Use that one.");
  }
}

const createResultValidator = v.union(
  v.object({
    email: v.string(),
    status: v.literal("created"),
    inviteId: v.id("invites"),
    token: v.string(),
  }),
  v.object({
    email: v.string(),
    status: v.union(
      v.literal("invalid"),
      v.literal("already_member"),
      v.literal("already_invited"),
    ),
  }),
);

/**
 * C3: one invite per address, reported per address (partial success is never
 * hidden). Names are not asked for (decision 51); the invitee enters them.
 */
export const createInvites = mutation({
  args: {
    emails: v.array(v.string()),
    role: roleValidator,
    // 2026-11-17: an Admin inviting a past writer (Team, "Invite to
    // Banhall"): one address, and accepting links the writer to the account.
    pdWriterId: v.optional(v.id("pdWriters")),
  },
  returns: v.array(createResultValidator),
  handler: async (ctx, args) => {
    // Actor first, so an ineligible caller learns nothing about the addresses.
    const viewer = await requireInviteManager(ctx, args.role);
    if (args.pdWriterId !== undefined) await requirePastWriterInvite(ctx, viewer, args.pdWriterId, args.emails);
    if (args.emails.length === 0) {
      domainError("INVALID_INPUT", "Add at least one email address");
    }
    if (args.emails.length > MAX_INVITES_PER_REQUEST) {
      domainError(
        "INVALID_INPUT",
        `Invite at most ${MAX_INVITES_PER_REQUEST} people at a time`,
      );
    }
    const now = Date.now();
    const seen = new Set<string>();
    const results = [];
    for (const raw of args.emails) {
      const email = normalizeEmail(raw);
      const key = email ?? raw.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!email || !EMAIL_SHAPE.test(email)) {
        results.push({ email: raw.trim(), status: "invalid" as const });
        continue;
      }
      const members = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .take(5);
      if (
        members.some(
          (member) =>
            member.authId ||
            (member.role !== undefined && !canManageInvite(viewer.role, member.role))
        )
      ) {
        results.push({ email, status: "already_member" as const });
        continue;
      }
      const pending = await liveInvitesForEmail(ctx, email, now);
      // More waiting rows than one call reads counts as already invited, so
      // no second live invite is ever made.
      if (!pending.complete || pending.live.length > 0) {
        results.push({ email, status: "already_invited" as const });
        continue;
      }
      const token = generateInviteToken();
      const inviteId = await ctx.db.insert("invites", {
        email,
        role: args.role,
        token,
        invitedBy: viewer._id,
        createdAt: now,
        sentAt: now,
        expiresAt: now + INVITE_TTL_MS,
        status: "pending",
        ...(args.pdWriterId !== undefined ? { pdWriterId: args.pdWriterId } : {}),
      });
      results.push({ email, status: "created" as const, inviteId, token });
    }
    return results;
  },
});

/** C1, C2: pending invites for the Team page; silent empty list otherwise. */
export const listTeamInvites = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("invites"),
      email: v.string(),
      role: roleValidator,
      invitedByName: v.union(v.string(), v.null()),
      sentAt: v.number(),
      expiresAt: v.number(),
      expired: v.boolean(),
      canManage: v.boolean(),
      // Resend apart from canManage: an invite for a past writer is resent
      // by an Admin only (requirePastWriterResend), so a Manager who may
      // copy, change or revoke it sees no Resend.
      canResend: v.boolean(),
      token: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const viewer = await getCurrentUserOrNull(ctx);
    if (
      !viewer ||
      viewer.isAnonymous === true ||
      !hasCapability(viewer.role, "team.view")
    ) {
      return [];
    }
    const pending = await ctx.db
      .query("invites")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(TEAM_INVITE_LIMIT);
    const now = Date.now();
    const inviterNames = new Map<Id<"users">, string | null>();
    for (const invite of pending) {
      if (inviterNames.has(invite.invitedBy)) continue;
      const inviter = await ctx.db.get(invite.invitedBy);
      inviterNames.set(invite.invitedBy, inviter ? userDisplayLabel(inviter) : null);
    }
    return pending
      .map((invite) => {
        const canManage = canManageInvite(viewer.role, invite.role);
        const canResend =
          canManage && (!invite.pdWriterId || hasCapability(viewer.role, "roles.manage"));
        return {
          _id: invite._id,
          email: invite.email,
          role: invite.role,
          invitedByName: inviterNames.get(invite.invitedBy) ?? null,
          sentAt: inviteSentAt(invite),
          expiresAt: invite.expiresAt,
          expired: invite.expiresAt <= now,
          canManage,
          canResend,
          // The link is only handed to someone who may copy or resend it.
          ...(canManage ? { token: invite.token } : {}),
        };
      })
      .sort((a, b) => b.sentAt - a.sentAt);
  },
});

/**
 * Resend (decision 50): a fresh link to copy. The old token stops working at
 * once (it then reads as unavailable) and the 7 days start again.
 */
export const resendInvite = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => {
    const viewer = await requireInternalActor(ctx);
    const invite = await requirePendingInvite(ctx, args.inviteId);
    if (!canManageInvite(viewer.role, invite.role)) {
      domainError("NOT_AUTHORIZED", "You cannot resend this invite");
    }
    await requirePastWriterResend(ctx, viewer, invite);
    const now = Date.now();
    // One live invite per email, as createInvites keeps: sign-up takes the
    // email's live invite (auth.ts onCreate), so two would let it pick the
    // wrong one, and with it the wrong past writer to link.
    const others = await liveInvitesForEmail(ctx, invite.email, now);
    if (!others.complete) domainError("INVALID_STATE", TOO_MANY_PENDING_INVITES);
    if (others.live.some((other) => other._id !== invite._id)) {
      domainError("INVALID_STATE", "This email has a newer invite waiting. Use that one.");
    }
    const token = generateInviteToken();
    await ctx.db.patch(invite._id, {
      token,
      sentAt: now,
      expiresAt: now + INVITE_TTL_MS,
      resendCount: (invite.resendCount ?? 0) + 1,
    });
    return { token };
  },
});

/** C4 "Invite as": the viewer must manage both the old and the new role. */
export const changeInviteRole = mutation({
  args: { inviteId: v.id("invites"), role: roleValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireInternalActor(ctx);
    const invite = await requirePendingInvite(ctx, args.inviteId);
    if (
      !canManageInvite(viewer.role, invite.role) ||
      !canManageInvite(viewer.role, args.role)
    ) {
      domainError("NOT_AUTHORIZED", "You cannot change this invite to that role");
    }
    if (invite.role !== args.role) {
      await ctx.db.patch(invite._id, { role: args.role });
    }
    return null;
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireInternalActor(ctx);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) domainError("NOT_FOUND", "Invite not found");
    if (!canManageInvite(viewer.role, invite.role)) {
      domainError("NOT_AUTHORIZED", "You cannot revoke this invite");
    }
    if (invite.status !== "pending") {
      domainError("INVALID_STATE", "Only pending invites can be revoked");
    }
    await ctx.db.patch(invite._id, {
      status: "revoked",
      revokedAt: Date.now(),
      revokedBy: viewer._id,
    });
    return null;
  },
});

const inviteLookupValidator = v.union(
  v.null(),
  v.object({
    state: v.literal("pending"),
    email: v.string(),
    firstName: v.union(v.string(), v.null()),
    lastName: v.union(v.string(), v.null()),
    role: roleValidator,
    inviter: v.union(v.null(), v.object({ name: v.string(), initials: v.string() })),
    sentAt: v.number(),
    expiresAt: v.number(),
  }),
  v.object({
    state: v.literal("expired"),
    role: roleValidator,
    inviter: v.union(
      v.null(),
      v.object({
        name: v.string(),
        firstName: v.union(v.string(), v.null()),
        email: v.union(v.string(), v.null()),
      }),
    ),
    sentAt: v.number(),
    expiresAt: v.number(),
  }),
  v.object({ state: v.literal("unavailable") }),
);

/**
 * Public, keyed by the unguessable token (J5, J6). The expired state tells
 * the token holder the inviter's name and email so J6 can offer a mailto;
 * nothing else about the workspace is returned. Revoked, accepted, replaced
 * (resent) and unknown tokens all read the same, as unavailable.
 */
export const getInviteByToken = query({
  args: { token: v.string() },
  returns: inviteLookupValidator,
  handler: async (ctx, args) => {
    if (!args.token) return null;
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!invite || invite.status !== "pending") {
      return { state: "unavailable" as const };
    }
    const inviter = await ctx.db.get(invite.invitedBy);
    const inviterName =
      inviter && inviter.isAnonymous !== true ? userDisplayLabel(inviter) : null;
    if (invite.expiresAt <= Date.now()) {
      return {
        state: "expired" as const,
        role: invite.role,
        inviter:
          inviter && inviterName
            ? {
                name: inviterName,
                firstName: inviter.firstName?.trim() || null,
                email: inviter.email?.trim() || null,
              }
            : null,
        sentAt: inviteSentAt(invite),
        expiresAt: invite.expiresAt,
      };
    }
    return {
      state: "pending" as const,
      email: invite.email,
      firstName: invite.firstName?.trim() || null,
      lastName: invite.lastName?.trim() || null,
      role: invite.role,
      inviter:
        inviter && inviterName
          ? { name: inviterName, initials: personInitials(inviter) }
          : null,
      sentAt: inviteSentAt(invite),
      expiresAt: invite.expiresAt,
    };
  },
});

/**
 * J5: the invitee confirms their names right before sign-up, so the names
 * they typed reach the account (the auth trigger copies them from the
 * invite). Public and keyed by the token, like the lookup above.
 */
export const confirmInviteNames = mutation({
  args: { token: v.string(), firstName: v.string(), lastName: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = args.token
      ? await ctx.db
          .query("invites")
          .withIndex("by_token", (q) => q.eq("token", args.token))
          .unique()
      : null;
    if (!invite || invite.status !== "pending") {
      domainError("NOT_FOUND", "This invite link isn't valid");
    }
    if (invite.expiresAt <= Date.now()) {
      domainError("INVALID_STATE", "This invite has expired");
    }
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!firstName || !lastName) {
      domainError("INVALID_INPUT", "First and last name are required");
    }
    if (firstName.length > MAX_NAME_LENGTH || lastName.length > MAX_NAME_LENGTH) {
      domainError(
        "INVALID_INPUT",
        `Names can be at most ${MAX_NAME_LENGTH} characters`,
      );
    }
    await ctx.db.patch(invite._id, { firstName, lastName });
    return null;
  },
});

/** Signup gate (Layer A): a live invite token for the email is the only
 * door. The legacy pre-migration relink window is closed (all original
 * accounts re-created 2026-07-20). */
export const signupAllowed = internalQuery({
  args: { email: v.string(), token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email || !args.token) return false;
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    return Boolean(
      invite &&
      invite.status === "pending" &&
      invite.expiresAt > Date.now() &&
      normalizeEmail(invite.email) === email,
    );
  },
});

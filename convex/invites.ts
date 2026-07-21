import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUserOrNull, requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";

/**
 * Invite-only membership (BNH-50). Admins issue invites from /admin/users;
 * the invitee opens /signup/<token>. Signup is closed at two layers:
 *  - Layer A: hooks.before in createAuth (convex/auth.ts) rejects
 *    /sign-up/email calls without a matching pending invite token.
 *  - Layer B: the user onCreate trigger throws unless a valid invite (or a
 *    legacy relink) exists — transactional backstop.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export const createInvite = mutation({
  args: {
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    role: v.union(
      v.literal("writer"),
      v.literal("manager"),
      v.literal("admin"),
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const email = args.email.trim().toLowerCase();
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!email.includes("@")) {
      domainError("INVALID_INPUT", "A valid email address is required");
    }
    if (!firstName || !lastName) {
      domainError("INVALID_INPUT", "First and last name are required");
    }

    const existingMember = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existingMember?.authId) {
      domainError("INVALID_INPUT", "That email already has an account");
    }
    const now = Date.now();
    const pending = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    if (pending.some((i) => i.status === "pending" && i.expiresAt > now)) {
      domainError(
        "INVALID_INPUT",
        "A pending invite for that email already exists",
      );
    }

    const token = generateInviteToken();
    const inviteId = await ctx.db.insert("invites", {
      email,
      firstName,
      lastName,
      role: args.role,
      token,
      invitedBy: admin._id,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
      status: "pending",
    });
    return { inviteId, token };
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) domainError("NOT_FOUND", "Invite not found");
    if (invite.status !== "pending") {
      domainError("INVALID_STATE", "Only pending invites can be revoked");
    }
    await ctx.db.patch(invite._id, { status: "revoked" });
  },
});

export const listInvites = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getCurrentUserOrNull(ctx);
    if (viewer?.role !== "admin") return [];
    // Accepted invites disappear from the admin surface immediately, while
    // their records remain available as an audit trail. Query only the two
    // visible states so consumed invite tokens are never returned to clients.
    const [pending, revoked] = await Promise.all([
      ctx.db
        .query("invites")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .order("desc")
        .take(100),
      ctx.db
        .query("invites")
        .withIndex("by_status", (q) => q.eq("status", "revoked"))
        .order("desc")
        .take(100),
    ]);
    const invites = [...pending, ...revoked]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);
    const now = Date.now();
    return invites.map((i) => ({
      _id: i._id,
      email: i.email,
      firstName: i.firstName,
      lastName: i.lastName,
      role: i.role,
      // Token returned so the admin can re-copy the link (admin-only surface).
      token: i.token,
      status:
        i.status === "pending" && i.expiresAt <= now
          ? ("expired" as const)
          : i.status,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    }));
  },
});

/** Public, keyed by unguessable token: just enough to prefill the accept form. */
export const getInviteByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token) return null;
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (
      !invite ||
      invite.status !== "pending" ||
      invite.expiresAt <= Date.now()
    ) {
      return null;
    }
    return {
      email: invite.email,
      firstName: invite.firstName,
      lastName: invite.lastName,
    };
  },
});

/** Signup gate (Layer A): a live invite token for the email is the only
 * door — the legacy pre-migration relink window is closed (all original
 * accounts re-created 2026-07-20). */
export const signupAllowed = internalQuery({
  args: { email: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email || !args.token) return false;
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    return Boolean(
      invite &&
      invite.status === "pending" &&
      invite.expiresAt > Date.now() &&
      invite.email === email,
    );
  },
});

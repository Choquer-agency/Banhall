import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { ConvexError } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      // Same transaction as Better Auth's user insert. Match-by-email relinks
      // the pre-migration app users docs (preserving every v.id("users") FK:
      // projects.createdBy, generations.requestedBy, writerProfiles, …) when
      // those accounts re-sign-up under Better Auth.
      onCreate: async (ctx, authUser) => {
        const email = authUser.email?.toLowerCase();
        const now = Date.now();
        // Invite-only (Layer B, transactional backstop to the hooks.before
        // gate): a fresh signup must carry a pending unexpired invite for
        // this email. Legacy relink (pre-migration doc without authId)
        // remains allowed so the original accounts can re-create themselves.
        const invites = email
          ? await ctx.db
              .query("invites")
              .withIndex("by_email", (q) => q.eq("email", email))
              .collect()
          : [];
        const invite =
          invites.find((i) => i.status === "pending" && i.expiresAt > now) ??
          null;
        const existing = email
          ? await ctx.db
              .query("users")
              .withIndex("by_email", (q) => q.eq("email", email))
              .unique()
          : null;
        const legacyRelink = Boolean(existing && !existing.authId);
        if (!invite && !legacyRelink) {
          // Aborts the component's user insert — signup fails.
          throw new ConvexError("Signups are invite-only. Ask an admin for an invite.");
        }
        let userId;
        if (existing) {
          await ctx.db.patch(existing._id, {
            authId: authUser._id,
            ...(invite
              ? {
                  firstName: invite.firstName,
                  lastName: invite.lastName,
                  role: existing.role ?? invite.role,
                }
              : {}),
          });
          userId = existing._id;
        } else {
          userId = await ctx.db.insert("users", {
            authId: authUser._id,
            email: authUser.email,
            firstName: invite!.firstName,
            lastName: invite!.lastName,
            name: authUser.name ?? undefined,
            role: invite!.role,
            createdAt: now,
          });
        }
        if (invite) {
          await ctx.db.patch(invite._id, {
            status: "accepted",
            acceptedAt: now,
            acceptedUserId: userId,
          });
        }
      },
      onDelete: async (ctx, authUser) => {
        const appUser = await ctx.db
          .query("users")
          .withIndex("by_authId", (q) => q.eq("authId", authUser._id))
          .unique();
        if (appUser) await ctx.db.patch(appUser._id, { authId: undefined });
      },
    },
  },
});

// Internal mutations the component calls back into for the triggers above.
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    hooks: {
      // Invite-only (Layer A): reject /sign-up/email without a live invite
      // token for the email. The trigger above is the transactional backstop
      // (Layer B) — but only this layer can check the TOKEN, so an attacker
      // who merely knows an invited email still can't take the seat.
      before: createAuthMiddleware(async (hookCtx) => {
        if (hookCtx.path !== "/sign-up/email") return;
        const body = (hookCtx.body ?? {}) as Record<string, unknown>;
        const email = String(body.email ?? "").trim().toLowerCase();
        const inviteToken = String(body.inviteToken ?? "");
        // Legacy relink escape hatch: pre-migration accounts (users doc
        // without authId) may re-sign-up without a token. Checked in the
        // same runQuery to keep this hook one round-trip.
        const allowed = await (
          ctx as unknown as {
            runQuery: (ref: unknown, args: unknown) => Promise<boolean>;
          }
        ).runQuery(internal.invites.signupAllowed, { email, token: inviteToken });
        if (!allowed) {
          throw new APIError("FORBIDDEN", {
            message: "Signups are invite-only. Ask an admin for an invite.",
          });
        }
      }),
    },
    plugins: [convex({ authConfig })],
  });

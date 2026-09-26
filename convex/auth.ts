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
import { normalizeEmail } from "./lib/email";
import { notify } from "./lib/notify";
import { ROLE_LABELS } from "../shared/roles";
import { customAuthCookiePrefix } from "../shared/authCookies";
import {
  AUTH_CLIENT_IP_HEADER,
  AUTH_RATE_LIMIT,
  authProxySecretProblem,
  trustedAuthRequest,
} from "../shared/authRateLimit";

const authFunctions: AuthFunctions = internal.auth;

// Auth is proxied through the SvelteKit app, so requests carry the app's
// origin rather than the Convex deployment origin. Keep the canonical hosted
// app and local development explicit; BETTER_AUTH_TRUSTED_ORIGINS can append
// any additional deployment-specific origins as a comma-separated list.
const trustedOrigins = [
  "https://banhall.vercel.app",
  "http://localhost:3001",
  ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? []),
]
  .map((origin) => origin.trim())
  .filter(Boolean);

// Optional per-deployment cookie names (shared/authCookies.ts). Local apps on
// different localhost ports share one cookie jar, so each local deployment
// sets its own BETTER_AUTH_COOKIE_PREFIX, and the SvelteKit app that talks to
// it sets the same value. Unset (production), no `advanced` option is passed
// and Better Auth keeps its default `better-auth.*` names. Read from
// process.env like SITE_URL and BETTER_AUTH_TRUSTED_ORIGINS.
const cookiePrefix = customAuthCookiePrefix(process.env.BETTER_AUTH_COOKIE_PREFIX);

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      // Same transaction as Better Auth's user insert. Match-by-email relinks
      // the pre-migration app users docs (preserving every v.id("users") FK:
      // projects.createdBy, generations.requestedBy, writerProfiles, …) when
      // those accounts re-sign-up under Better Auth.
      onCreate: async (ctx, authUser) => {
        const email = normalizeEmail(authUser.email);
        const now = Date.now();
        // Invite-only (Layer B, transactional backstop to the hooks.before
        // gate): a fresh signup must carry a pending unexpired invite for
        // this email. (The legacy pre-migration relink window closed
        // 2026-07-20 — all original accounts re-created.)
        const invites = email
          ? await ctx.db
              .query("invites")
              .withIndex("by_email_and_status", (q) =>
                q.eq("email", email).eq("status", "pending"),
              )
              .take(10)
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
        if (!invite) {
          // Aborts the component's user insert — signup fails.
          throw new ConvexError(
            "Signups are invite-only. Ask an admin for an invite.",
          );
        }
        // Decision 51: the invite may carry no names until the invitee
        // confirms them (invites.confirmInviteNames, called by the signup
        // page right before sign-up). The account keeps requiring both.
        const firstName = invite.firstName?.trim();
        const lastName = invite.lastName?.trim();
        if (!firstName || !lastName) {
          throw new ConvexError("First and last name are required.");
        }
        let userId;
        if (existing) {
          await ctx.db.patch(existing._id, {
            authId: authUser._id,
            firstName,
            lastName,
            role: existing.role ?? invite.role,
          });
          userId = existing._id;
        } else {
          userId = await ctx.db.insert("users", {
            authId: authUser._id,
            email: email ?? undefined,
            firstName,
            lastName,
            name: authUser.name ?? undefined,
            role: invite.role,
            createdAt: now,
          });
        }
        await ctx.db.patch(invite._id, {
          status: "accepted",
          acceptedAt: now,
          acceptedUserId: userId,
        });
        // Round 2 (I3): tell the inviter. Copy follows WS1's
        // shared/notifications.ts proposal; switch to its builder on rebase.
        await notify(ctx, {
          userId: invite.invitedBy,
          kind: "invite_accepted",
          title: `${firstName} ${lastName} joined Banhall`,
          body: `They accepted your invite as ${ROLE_LABELS[invite.role]}.`,
          href: "/team",
          dedupeKey: `invite_accepted:${invite._id}`,
        });
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

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const auth = betterAuth({
    baseURL: process.env.SITE_URL,
    trustedOrigins,
    advanced: {
      ...(cookiePrefix ? { cookiePrefix } : {}),
      // Security wave 1 (a2 P1-2, a4 #7): the browser's address comes from
      // the SvelteKit proxy's header, kept only when the proxy vouched for it
      // (see the handler below and shared/authRateLimit.ts).
      ipAddress: { ipAddressHeaders: [AUTH_CLIENT_IP_HEADER] },
    },
    // Counted in the component's rateLimit table; per address per path.
    rateLimit: AUTH_RATE_LIMIT,
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
        if (
          hookCtx.path !== "/sign-up/email" &&
          hookCtx.path !== "/sign-in/email"
        ) {
          return;
        }
        const body = (hookCtx.body ?? {}) as Record<string, unknown>;
        const email = normalizeEmail(String(body.email ?? ""));
        if (!email) {
          throw new APIError("BAD_REQUEST", {
            message: "A valid email address is required.",
          });
        }
        // Return a replacement context instead of relying on middleware body
        // mutation. Better Auth then validates and processes the canonical
        // address even when a caller bypasses our UI.
        const normalizedContext = {
          context: { body: { ...body, email } },
        };
        if (hookCtx.path === "/sign-in/email") return normalizedContext;
        const inviteToken = String(body.inviteToken ?? "");
        // Legacy relink escape hatch: pre-migration accounts (users doc
        // without authId) may re-sign-up without a token. Checked in the
        // same runQuery to keep this hook one round-trip.
        const allowed = await (
          ctx as unknown as {
            runQuery: (ref: unknown, args: unknown) => Promise<boolean>;
          }
        ).runQuery(internal.invites.signupAllowed, {
          email,
          token: inviteToken,
        });
        if (!allowed) {
          throw new APIError("FORBIDDEN", {
            message: "Signups are invite-only. Ask an admin for an invite.",
          });
        }
        return normalizedContext;
      }),
    },
    plugins: [convex({ authConfig })],
  });
  // Every auth request passes through here (registerRoutes calls
  // `createAuth(ctx).handler`): drop a client address the proxy did not vouch
  // for. AUTH_PROXY_SECRET is read like SITE_URL. A production deployment
  // without a usable secret logs an error on every request and drops every
  // address, so the limit stays per path rather than per invented address;
  // local development (a localhost SITE_URL, or none) is unchanged.
  const handler = auth.handler;
  return Object.assign(auth, {
    handler: (request: Request) => {
      const secret = process.env.AUTH_PROXY_SECRET;
      const problem = authProxySecretProblem(secret, process.env.SITE_URL);
      if (problem) console.error(problem);
      return handler(
        trustedAuthRequest(request, secret, { requireSecret: problem !== null })
      );
    },
  });
};

import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
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
        const existing = email
          ? await ctx.db
              .query("users")
              .withIndex("by_email", (q) => q.eq("email", email))
              .unique()
          : null;
        if (existing) {
          await ctx.db.patch(existing._id, { authId: authUser._id });
        } else {
          await ctx.db.insert("users", {
            authId: authUser._id,
            email: authUser.email,
            name: authUser.name ?? undefined,
            createdAt: Date.now(),
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
    plugins: [convex({ authConfig })],
  });

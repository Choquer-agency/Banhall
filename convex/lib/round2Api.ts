import {
  anyApi,
  type ApiFromModules,
  type FilterApi,
  type FunctionReference,
} from "convex/server";
import type * as account from "../account.js";
import type * as adminAttention from "../adminAttention.js";
import type * as notifications from "../notifications.js";

type Round2Modules = ApiFromModules<{
  account: typeof account;
  adminAttention: typeof adminAttention;
  notifications: typeof notifications;
}>;

/**
 * Typed stand-ins for `api` / `internal` covering the round 2 modules whose
 * codegen has not run yet (`convex/_generated/api.d.ts` is never hand-edited).
 * At runtime both are `anyApi`, which builds the same "module:function"
 * references codegen does.
 *
 * Remove once `npx convex dev` regenerates api.d.ts: replace `round2Api.`
 * with `api.` and `round2Internal.` with `internal.`.
 */
export const round2Api = anyApi as unknown as FilterApi<
  Round2Modules,
  FunctionReference<any, "public">
>;
export const round2Internal = anyApi as unknown as FilterApi<
  Round2Modules,
  FunctionReference<any, "internal">
>;

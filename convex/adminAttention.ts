/**
 * The Admin attention signal for the rail and the Admin flyout (WS1 spec
 * section 3): the amber dot on Admin and "{n} failed" next to OneDrive
 * import. More signals need a decision first.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { getCurrentUserOrNull } from "./lib/auth";
import { hasCapability } from "../shared/capabilities";

/** Failed ingestion items counted at most; the flyout shows the number as is. */
export const ATTENTION_INGESTION_FAILED_CAP = 100;

/**
 * `{ total, ingestionFailed }`. Zeros for anyone without
 * `settings.configure` (signed out, anonymous, roleless, Consultant,
 * Manager): a plain read that never throws, so the rail subscribes for every
 * role. `total` is how many admin pages need a look (0 or 1 today).
 */
export const getAttention = query({
  args: {},
  returns: v.object({ total: v.number(), ingestionFailed: v.number() }),
  handler: async (ctx) => {
    const viewer = await getCurrentUserOrNull(ctx);
    if (
      !viewer ||
      viewer.isAnonymous === true ||
      !hasCapability(viewer.role, "settings.configure")
    ) {
      return { total: 0, ingestionFailed: 0 };
    }
    const failed = await ctx.db
      .query("ingestionItems")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .take(ATTENTION_INGESTION_FAILED_CAP);
    const ingestionFailed = failed.length;
    return { total: ingestionFailed > 0 ? 1 : 0, ingestionFailed };
  },
});

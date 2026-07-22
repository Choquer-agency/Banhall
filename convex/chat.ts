import { query } from "./_generated/server";
import { v } from "convex/values";
import { getInternalProjectAccessOrNull } from "./lib/auth";

// The legacy per-report chat pipeline (BNH-10 parallel run) was retired on
// 2026-07-22 — live chat is convex/chatV2.ts on @convex-dev/agent. This module
// remains only to read the historical chatMessages rows for the project log.

export const listProjectLog = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];

    const msgs = await ctx.db
      .query("chatMessages")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("asc")
      .collect();

    return msgs
      // Skip empty pending placeholders that were never answered.
      .filter((m) => !(m.role === "assistant" && m.status === "pending" && !m.content))
      .map((m) => ({
        _id: m._id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        highlight: m.highlight?.text ?? null,
        proposedEdit: m.proposedEdit
          ? {
              newText:
                m.proposedEdit.newText ??
                (m.proposedEdit.replacements
                  ? m.proposedEdit.replacements
                      .map((r) => `"${r.find}" → "${r.replaceWith}"`)
                      .join(", ")
                  : undefined),
              state: m.proposedEdit.state,
            }
          : null,
      }));
  },
});

"use node";

/**
 * Jul 17 meeting: AI digest of writers' one-line score comments per model
 * (Amazon-review style) for the admin Model preferences page. On-demand, no
 * persistence — comment volume is small and the digest should always reflect
 * the latest feedback.
 */
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import { clientForRole } from "./providers";
import { HUMAN_PROSE_FOR_OWN_WORDING } from "../../shared/humanProse";

export const summarizeModelFeedback = action({
  args: { model: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const user = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!user || user.role !== "admin") {
      throw new Error("Admin only");
    }
    const comments = await ctx.runQuery(internal.generations.getModelComments, {
      model: args.model,
    });
    if (!comments.length) return "No written feedback for this model yet.";
    // Model catalog: the feedback_summary role's model, not a "haiku"
    // substring match on the registry.
    const { client, model } = await clientForRole(ctx, "feedback_summary", {
      callSite: "admin:model_feedback_summary",
      userId: user._id,
    });
    const list = comments.map((c) => `- (${c.score}/10) ${c.comment}`).join("\n");
    const response = await client.messages.create({
      model,
      max_tokens: 300,
      system: HUMAN_PROSE_FOR_OWN_WORDING,
      messages: [
        {
          role: "user",
          content: `Summarize this writer feedback about an AI drafting model in 2-3 plain sentences (strengths, weaknesses, overall sentiment). No preamble.\n\n${list}`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "No summary available.";
  },
});

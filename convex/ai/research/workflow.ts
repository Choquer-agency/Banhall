import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { researchWorkflowManager } from "./manager";

/**
 * Durable fan-out/fan-in orchestration. Provider calls run once and in
 * parallel; their actions record failures instead of throwing so the reviewer
 * can still consolidate a surviving independent result.
 */
export const runResearch = researchWorkflowManager.define({
  args: { sessionId: v.id("researchSessions") },
  returns: v.null(),
  handler: async (step, args): Promise<null> => {
    const active = await step.runMutation(
      internal.research.markResearchStarted,
      { sessionId: args.sessionId },
      { name: "mark research started" }
    );
    if (!active) return null;

    await Promise.all([
      step.runMutation(
        internal.research.collectProjectEvidence,
        { sessionId: args.sessionId },
        { name: "retrieve project documents" }
      ),
      step.runAction(
        internal.ai.research.actions.runExternalResearch,
        { sessionId: args.sessionId, provider: "gpt" },
        { name: "GPT web research", retry: false }
      ),
      step.runAction(
        internal.ai.research.actions.runExternalResearch,
        { sessionId: args.sessionId, provider: "perplexity" },
        { name: "Perplexity deep research", retry: false }
      ),
      step.runAction(
        internal.ai.research.actions.collectBrainEvidence,
        { sessionId: args.sessionId },
        { name: "retrieve Brain patterns", retry: false }
      ),
    ]);

    const shouldReview = await step.runMutation(
      internal.research.markResearchReviewing,
      { sessionId: args.sessionId },
      { name: "mark research reviewing" }
    );
    if (!shouldReview) return null;
    await step.runAction(
      internal.ai.research.actions.reviewResearch,
      { sessionId: args.sessionId },
      { name: "consolidate and review evidence", retry: false }
    );
    return null;
  },
});

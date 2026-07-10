import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { CANDIDATE_MODELS } from "./ai/model";
import {
  anthropicConfiguration,
  brainConfiguration,
} from "./lib/providerConfig";

export const getCapabilities = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const anthropic = anthropicConfiguration();
    const brain = brainConfiguration();
    return {
      generation: anthropic.state,
      review: anthropic.state,
      chat: anthropic.state,
      financial: anthropic.state,
      brain: brain.state,
      anthropicMessage: anthropic.message,
      brainMessage: brain.message,
      candidateModels: CANDIDATE_MODELS.map((model) => model.id),
    };
  },
});

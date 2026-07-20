import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { CANDIDATE_MODELS } from "./ai/model";
import {
  anthropicConfiguration,
  brainConfiguration,
  openRouterConfiguration,
} from "./lib/providerConfig";

export const getCapabilities = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const anthropic = anthropicConfiguration();
    const brain = brainConfiguration();
    const openrouter = openRouterConfiguration();
    return {
      generation: anthropic.state,
      review: anthropic.state,
      chat: anthropic.state,
      financial: anthropic.state,
      brain: brain.state,
      openrouter: openrouter.state,
      anthropicMessage: anthropic.message,
      brainMessage: brain.message,
      openrouterMessage: openrouter.message,
      candidateModels: CANDIDATE_MODELS.map((model) => model.id),
      // Models actually runnable with the currently configured keys — pickers
      // grey out the rest.
      availableCandidateModels: CANDIDATE_MODELS.filter(
        (model) =>
          model.gateway === "anthropic" || openrouter.state === "configured"
      ).map((model) => model.id),
    };
  },
});

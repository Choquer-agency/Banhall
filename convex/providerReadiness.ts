import { query } from "./_generated/server";
import { CANDIDATE_MODELS } from "./ai/model";
import {
  anthropicConfiguration,
  brainConfiguration,
  openRouterConfiguration,
} from "./lib/providerConfig";
import { defaultModelId } from "./appSettings";
import { getCurrentUserOrNull } from "./lib/auth";

export const getCapabilities = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return null;
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
      // Admin-set default generation model (appSettings), registry default
      // when unset. Pickers label their "Default" option with this.
      defaultModel: await defaultModelId(ctx),
    };
  },
});

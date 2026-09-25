import { query } from "./_generated/server";
import {
  anthropicConfiguration,
  brainConfiguration,
  openRouterConfiguration,
} from "./lib/providerConfig";
import { defaultModelId } from "./appSettings";
import { getCurrentUserOrNull } from "./lib/auth";
import { catalogEntry, listSelectableModels } from "./lib/modelRoles";

export const getCapabilities = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return null;
    const anthropic = anthropicConfiguration();
    const brain = brainConfiguration();
    const openrouter = openRouterConfiguration();
    // The model catalog's selectable set (enabled rows, seed fallback), so
    // every picker shows exactly what a writer may run today.
    const selectable = await listSelectableModels(ctx);
    const available = (gateway: string) =>
      gateway === "anthropic" || openrouter.state === "configured";
    const defaultModel = await defaultModelId(ctx);
    const defaultEntry =
      selectable.find((model) => model.id === defaultModel) ??
      (await catalogEntry(ctx, defaultModel));
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
      candidateModels: selectable.map((model) => model.id),
      // Models actually runnable with the currently configured keys — pickers
      // grey out the rest.
      availableCandidateModels: selectable
        .filter((model) => available(model.gateway))
        .map((model) => model.id),
      // Display data for the pickers. No prices or benchmark scores: those
      // stay on the admin-only catalog page.
      models: selectable.map((model) => ({
        id: model.id,
        label: model.label,
        provider: model.provider,
        gateway: model.gateway,
        description: model.description ?? "",
        available: available(model.gateway),
      })),
      // The writing role's model (model catalog). Pickers label their
      // "Default" option with it.
      defaultModel,
      defaultModelLabel: defaultEntry?.label ?? defaultModel,
    };
  },
});

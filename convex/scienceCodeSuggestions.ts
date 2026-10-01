import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { clientForRole } from "./ai/providers";
import { gatewayForModel } from "../shared/generationModels";
import {
  CRA_SCIENCE_CODES,
  normalizeCraScienceCode,
  scienceCodeLabel,
} from "../shared/craScienceCodes";
import { firstResponseText } from "./ai/openrouterCore";
import { pseudonymize, restorePlaceholders } from "./lib/deidentify";
import { limitUserAction } from "./lib/aiRateLimits";

const MAX_CONTEXT_CHARS = 80_000;

export const suggest = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<{ code: string; label: string } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const context = await ctx.runQuery(
      internal.projects.getScienceCodeSuggestionContext,
      { projectId: args.projectId }
    );
    if (!context) throw new Error("Project not found or access denied");

    const codeCatalog = CRA_SCIENCE_CODES.map(
      ({ code, label, group }) => `${code} | ${group} | ${label}`
    ).join("\n");
    // Names become placeholders before the call (decision 26, review
    // 2026-09-26 P2-6); the answer is a bare code, restored all the same.
    const projectContext = pseudonymize(
      [
        `Project title: ${context.title}`,
        context.sredTitle ? `SR&ED title: ${context.sredTitle}` : "",
        context.industry ? `Industry: ${context.industry}` : "",
        context.transcript ? `Interview transcript:\n${context.transcript}` : "",
        context.report ? `Current report:\n${context.report}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      context.placeholders
    ).slice(0, MAX_CONTEXT_CHARS);

    // Model catalog: the suggestion runs on the science_code role's model.
    const { client, model } = await clientForRole(ctx, "science_code", {
      callSite: "science-code-suggestion",
      projectId: args.projectId,
      userId: identity.tokenIdentifier,
    });
    // Audit wave 2: 30 suggestions an hour per user, spent once the provider
    // is resolved, just before the call.
    await limitUserAction(ctx, "scienceCodePerUser", context.userId);
    const response = await client.messages.create({
      model,
      // A bare code needs 16 tokens on a direct Anthropic model; an
      // OpenRouter reasoning model spends its thinking from the same budget.
      max_tokens: gatewayForModel(model) === "anthropic" ? 16 : 2048,
      system:
        "Choose the single best CRA T4088 line 206 field-of-science or technology code for the project. Return only the exact numeric code from the supplied catalog, with no explanation, punctuation, or formatting. If the evidence is insufficient, return NONE.",
      messages: [
        {
          role: "user",
          content: `CRA code catalog:\n${codeCatalog}\n\nProject evidence:\n${projectContext}`,
        },
      ],
    });
    const output = restorePlaceholders(firstResponseText(response), context.placeholders);
    const code = normalizeCraScienceCode(output);
    return code ? { code, label: scienceCodeLabel(code) } : null;
  },
});

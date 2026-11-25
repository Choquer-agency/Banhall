import { action } from "./_generated/server";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { clientForRole } from "./ai/providers";
import { generateStructured } from "./ai/structured";
import {
  CRA_SCIENCE_CODES,
  normalizeCraScienceCode,
  scienceCodeLabel,
} from "../shared/craScienceCodes";
import { pseudonymize, restorePlaceholders } from "./lib/deidentify";
import { limitUserAction } from "./lib/aiRateLimits";

const MAX_CONTEXT_CHARS = 80_000;

export const SCIENCE_CODE_TOOL_NAME = "select_science_code";
export const SCIENCE_CODE_MAX_TOKENS = 128;

const SCIENCE_CODE_CHOICES: [string, ...string[]] = [
  "NONE",
  ...CRA_SCIENCE_CODES.map((entry) => entry.code),
];

export const scienceCodeSuggestionSchema = z.object({
  code: z.enum(SCIENCE_CODE_CHOICES),
});

export const SCIENCE_CODE_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    code: {
      type: "string",
      enum: SCIENCE_CODE_CHOICES,
      description:
        "Exact CRA T4088 line 206 field-of-science or technology code from the catalog, or NONE if evidence is insufficient.",
    },
  },
  required: ["code"],
  additionalProperties: false,
};

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

    // Model catalog: the suggestion runs on the science_code role's model
    // (Haiku 5.5 by default; forced tool call skips thinking on Haiku and
    // adapts with reasoning headroom if an admin picks an always-thinking model).
    const { client, model } = await clientForRole(ctx, "science_code", {
      callSite: "science-code-suggestion",
      projectId: args.projectId,
      userId: identity.tokenIdentifier,
    });
    // Audit wave 2: 30 suggestions an hour per user, spent once the provider
    // is resolved, just before the call.
    await limitUserAction(ctx, "scienceCodePerUser", context.userId);
    const structured = await generateStructured(client, {
      model,
      maxTokens: SCIENCE_CODE_MAX_TOKENS,
      system:
        "Choose the single best CRA T4088 line 206 field-of-science or technology code for the project. Call select_science_code with the exact numeric code from the supplied catalog, or NONE if the evidence is insufficient.",
      user: `CRA code catalog:\n${codeCatalog}\n\nProject evidence:\n${projectContext}`,
      toolName: SCIENCE_CODE_TOOL_NAME,
      description: "Select the single best CRA T4088 line 206 science or technology code, or NONE.",
      schema: SCIENCE_CODE_INPUT_SCHEMA,
      validate: scienceCodeSuggestionSchema,
    });
    const output = restorePlaceholders(structured.code, context.placeholders);
    const code = normalizeCraScienceCode(output);
    return code ? { code, label: scienceCodeLabel(code) } : null;
  },
});

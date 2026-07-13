import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { MODEL } from "./ai/model";
import { instrumentedAnthropic } from "./ai/instrument";
import {
  CRA_SCIENCE_CODES,
  normalizeCraScienceCode,
  scienceCodeLabel,
} from "../shared/craScienceCodes";

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
    const projectContext = [
      `Project title: ${context.title}`,
      context.sredTitle ? `SR&ED title: ${context.sredTitle}` : "",
      context.industry ? `Industry: ${context.industry}` : "",
      context.transcript ? `Interview transcript:\n${context.transcript}` : "",
      context.report ? `Current report:\n${context.report}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, MAX_CONTEXT_CHARS);

    const anthropic = instrumentedAnthropic(ctx, {
      callSite: "science-code-suggestion",
      capability: "generation",
      projectId: args.projectId,
      userId: identity.tokenIdentifier,
    });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16,
      system:
        "Choose the single best CRA T4088 line 206 field-of-science or technology code for the project. Return only the exact numeric code from the supplied catalog, with no explanation, punctuation, or formatting. If the evidence is insufficient, return NONE.",
      messages: [
        {
          role: "user",
          content: `CRA code catalog:\n${codeCatalog}\n\nProject evidence:\n${projectContext}`,
        },
      ],
    });
    const output =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const code = normalizeCraScienceCode(output);
    return code ? { code, label: scienceCodeLabel(code) } : null;
  },
});

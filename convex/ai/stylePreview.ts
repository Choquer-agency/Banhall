/**
 * Round 2 (I2, decision 58): the Writing preferences Preview. Writes a short
 * sample of a Line 242 paragraph from a fixed, fictional set of facts, once
 * with the house rules alone and once with the writer's saved preferences,
 * so a writer can see what their instructions change before a real draft.
 *
 * - Model: the `planning` role's model (decision 58). That role never
 *   switches on its own, so this call site needs no evaluation task.
 * - Cache: `writerStylePreviews` keyed by a hash of everything that shapes
 *   the sample (variant, instructions, effective waivers, org modes, model,
 *   prompt version). A hit makes no model call. The house sample carries no
 *   instructions, so every writer with the same org modes shares it.
 * - Limit: 20 generated previews per person per firm day; cache hits are
 *   free.
 */
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { clientForRole } from "./providers";
import { startActionDeadline } from "./actionDeadline";
import { firstResponseText, isCutOffStopReason } from "./openrouterCore";
import { buildSharedWritingRules, waivedCategoryLabels } from "./prompts";
import { STYLE_GUIDANCE_SCAFFOLDS } from "./promptDefinitions";
import { sha256 } from "../lib/contracts";
import { STYLE_PREVIEW_DAILY_CAP } from "../writerProfiles";
import { gatewayForModel } from "../../shared/generationModels";
import type { StyleOverrides } from "../../shared/styleOverrides";

export const STYLE_PREVIEW_PROMPT_VERSION = "style-preview.2026-09-26.1";
export const STYLE_PREVIEW_MAX_WORDS = 180;
export const STYLE_PREVIEW_LIMIT_MESSAGE = "You have used today's previews. Try again tomorrow.";

/** Fictional facts (the FrostLine board sample). No real client data. */
export const STYLE_PREVIEW_FIXTURE = `Company: Cedarline Systems, a cold-storage controls maker.
Project: FrostLine, a controller that holds warehouse cold rooms at their setpoint.
Problem: dock doors at the Delta warehouse stay open for most of a shift. Standard setpoint tables assume a closed room, so the controller overshot and the room drifted up to 6 degrees above setpoint for 20 minutes after each long door opening.
What was not known: whether any control approach could hold temperature within 1 degree while a door stayed open, and how fast the heat load changes once a door opens. Nobody had measured it; supplier data and published guidance covered closed rooms only.
Approach: the team ran three builds in the Delta warehouse. Each build changed one thing: the sensor interval, the model inputs, or the control step.`;

export const STYLE_PREVIEW_SYSTEM_INTRO = `You write a short sample for a settings preview in an SR&ED report-writing tool. The sample shows a writer how their style settings read on a Line 242 (scientific or technological uncertainty) paragraph of a Canadian SR&ED project description.

Use ONLY the facts supplied. Write one or two paragraphs, ${STYLE_PREVIEW_MAX_WORDS} words at most in total. Plain text only: no heading, no title, no list, no markdown, no quotation marks around the answer. Separate the paragraphs with one blank line.`;

export type StylePreviewVariant = "house" | "preferences";

/** The writer's instructions, framed exactly as a generation frames them. */
function preferencesBlock(instructions: string, overrides: StyleOverrides): string {
  const waived = waivedCategoryLabels(overrides);
  const text = instructions.trim();
  if (overrides.reportSkeleton) {
    const scaffold = STYLE_GUIDANCE_SCAFFOLDS.writerSkeletonWaived;
    return `${scaffold.prefix}${waived.join("; ")}${scaffold.contentPrefix}${text}`;
  }
  if (waived.length > 0) {
    const scaffold = STYLE_GUIDANCE_SCAFFOLDS.writerWithWaivers;
    return `${scaffold.prefix}${waived.join("; ")}${scaffold.contentPrefix}${text}`;
  }
  return `${STYLE_GUIDANCE_SCAFFOLDS.writerDefault.prefix}${text}`;
}

/** Pure prompt builder, unit-tested without a model call. */
export function buildStylePreviewPrompt(input: {
  instructions: string | null;
  styleOverrides: StyleOverrides;
}): { system: string; user: string } {
  const system = `${STYLE_PREVIEW_SYSTEM_INTRO}\n\n${buildSharedWritingRules(input.styleOverrides)}`;
  const guidance = input.instructions?.trim()
    ? preferencesBlock(input.instructions, input.styleOverrides)
    : "";
  return {
    system,
    user: `## Facts\n\n${STYLE_PREVIEW_FIXTURE}${guidance}\n\n## Task\n\nWrite the Line 242 sample now.`,
  };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * The model's reply as at most two plain paragraphs within the word cap:
 * markdown markers, headings and list bullets are removed; a paragraph that
 * would pass the cap ends at its last full sentence inside it.
 */
export function toPreviewParagraphs(raw: string, maxWords = STYLE_PREVIEW_MAX_WORDS): string[] {
  const blocks = raw
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !/^\s*#{1,6}\s/.test(line))
        .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""))
        .join(" ")
        .replace(/\*\*|__|`/g, "")
        .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|[.,;:!?]|$)/g, "$1$2")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 2);
  const out: string[] = [];
  let used = 0;
  for (const block of blocks) {
    const left = maxWords - used;
    if (left <= 0) break;
    if (wordCount(block) <= left) {
      out.push(block);
      used += wordCount(block);
      continue;
    }
    const sentences = block.match(/[^.!?]+[.!?]+(?:\s+|$)/g) ?? [];
    let kept = "";
    for (const sentence of sentences) {
      if (wordCount(kept + sentence) > left) break;
      kept += sentence;
    }
    kept = kept.trim() || block.split(/\s+/).slice(0, left).join(" ");
    out.push(kept);
    used += wordCount(kept);
  }
  return out;
}

async function previewInputsHash(input: {
  variant: StylePreviewVariant;
  instructions: string | null;
  styleOverrides: StyleOverrides;
  modes: Record<string, string>;
  model: string;
}): Promise<string> {
  const keys = (record: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  return await sha256(
    JSON.stringify({
      version: STYLE_PREVIEW_PROMPT_VERSION,
      variant: input.variant,
      instructions: input.instructions ? await sha256(input.instructions.trim()) : null,
      overrides: keys(input.styleOverrides),
      modes: keys(input.modes),
      model: input.model,
    }),
  );
}

export type StylePreviewResult =
  | { status: "ready"; paragraphs: string[]; cached: boolean }
  | { status: "limit"; message: string };

export const previewMyStyle = action({
  args: { variant: v.union(v.literal("house"), v.literal("preferences")) },
  returns: v.union(
    v.object({ status: v.literal("ready"), paragraphs: v.array(v.string()), cached: v.boolean() }),
    v.object({ status: v.literal("limit"), message: v.string() }),
  ),
  handler: async (ctx, args): Promise<StylePreviewResult> => {
    startActionDeadline(ctx);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    // Throws for roleless and anonymous callers (requireInternalActor).
    const context = await ctx.runQuery(internal.writerProfiles.getStylePreviewContext, {
      variant: args.variant,
    });
    const { client, model } = await clientForRole(ctx, "planning", {
      callSite: "settings:style_preview",
      userId: identity.tokenIdentifier,
    });
    const inputsHash = await previewInputsHash({
      variant: args.variant,
      instructions: context.instructions,
      styleOverrides: context.styleOverrides,
      modes: context.modes,
      model,
    });
    const cached = await ctx.runQuery(internal.writerProfiles.getCachedStylePreview, { inputsHash });
    if (cached) return { status: "ready", paragraphs: cached, cached: true };
    if (context.usedToday >= STYLE_PREVIEW_DAILY_CAP) {
      return { status: "limit", message: STYLE_PREVIEW_LIMIT_MESSAGE };
    }

    const { system, user } = buildStylePreviewPrompt({
      instructions: context.instructions,
      styleOverrides: context.styleOverrides,
    });
    const response = await client.messages.create({
      model,
      // About 300 output tokens; the headroom covers a reasoning model that
      // spends its thinking from the same budget.
      max_tokens: gatewayForModel(model) === "anthropic" ? 2048 : 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    if (isCutOffStopReason(response.stop_reason)) {
      throw new Error("The preview could not be written. Try again.");
    }
    const paragraphs = toPreviewParagraphs(firstResponseText(response));
    if (paragraphs.length === 0) throw new Error("The preview could not be written. Try again.");
    await ctx.runMutation(internal.writerProfiles.recordStylePreview, {
      variant: args.variant,
      inputsHash,
      paragraphs,
      model,
    });
    return { status: "ready", paragraphs, cached: false };
  },
});

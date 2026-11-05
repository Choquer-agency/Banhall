/**
 * The company summary (2026-11-04, docs/product-domain.md "The company
 * profile"): two or three plain sentences on what a company does, stored on
 * the company (`clients.summary`) and shown on its page only. Drafts and the
 * Assistant never read it; the website file they already read holds the same
 * facts.
 *
 * - The AI drafts it (`ai/companySummary.draftCompanySummary`, the Haiku
 *   tier, the website text only, the company's names hidden as for company
 *   file labels, no web search) after a website read saves its text, while no
 *   person has written one. A failed draft leaves the summary as it was
 *   (empty when there was none); nothing blocks.
 * - Managers and Admins (Edit company's rule, `requireRole(["manager",
 *   "admin"])`) write or change it (`updateCompanySummary`). A person's text
 *   is never replaced by a later read.
 * - The draft is counted in AI usage as its own feature (call site
 *   `company_summary`).
 */
import { internalMutation, internalQuery, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { companyIdentityNames } from "./lib/clients";
import { readCompanyFileTextOrNull } from "./lib/companyFileText";
import { placeholderMapFrom } from "./lib/transcriptPlaceholders";
import { placeholderMapValidator } from "./lib/placeholderValidators";
import { transcriptPlaceholdersEnabled } from "./appSettings";
import { clipText } from "../shared/searchPieces";
import {
  COMPANY_SUMMARY_INPUT_CHARS,
  MAX_COMPANY_SUMMARY_CHARS,
  MAX_DRAFTED_SUMMARY_CHARS,
} from "../shared/companySummary";

/** A summary a person wrote: never replaced by the AI. */
export function summaryWrittenByPerson(client: Pick<Doc<"clients">, "summary">): boolean {
  return client.summary?.editedBy !== undefined;
}

/**
 * The names the draft hides: the company's name and every name tied to it,
 * and the firm's names, exactly as company file labels hide them
 * (`companyFileWork.companyLabelInput`).
 */
async function companyPlaceholderMap(ctx: QueryCtx, client: Doc<"clients">, texts: readonly string[]) {
  const { organizations, people } = await companyIdentityNames(ctx, client);
  return await placeholderMapFrom(ctx, { clientName: client.name }, [{ people, organizations, phrases: [] }], texts);
}

/**
 * What one draft reads: the website file's text (its opening) with the map
 * that hides the company's names, or null when nothing should be drafted
 * (the company is gone, a person wrote the summary, the read is no longer
 * the company's latest, or the file has no text).
 */
export const summaryInput = internalQuery({
  args: {
    clientId: v.id("clients"),
    companyFileId: v.id("companyFiles"),
    url: v.string(),
    requestedAt: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      text: v.string(),
      placeholders: placeholderMapValidator,
    })
  ),
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active" || summaryWrittenByPerson(client)) return null;
    if (client.website !== args.url || client.websiteRead?.requestedAt !== args.requestedAt) return null;
    const file = await ctx.db.get(args.companyFileId);
    if (!file || file.clientId !== client._id || file.archived === true || !file.hasText) return null;
    const full = await readCompanyFileTextOrNull(ctx, file, 0, COMPANY_SUMMARY_INPUT_CHARS);
    const text = full?.trim() ? clipText(full, COMPANY_SUMMARY_INPUT_CHARS) : "";
    if (!text) return null;
    const placeholders = (await transcriptPlaceholdersEnabled(ctx)) ? [...(await companyPlaceholderMap(ctx, client, [text]))] : [];
    return {
      text,
      placeholders: placeholders.map((entry) => ({
        token: entry.token,
        value: entry.value,
        ...(entry.bare ? { bare: true } : {}),
        ...(entry.at ? { at: entry.at } : {}),
      })),
    };
  },
});

/**
 * Keeps a drafted summary, unless a person wrote one meanwhile or the read
 * it came from is no longer the company's latest. Returns what happened.
 */
export const saveDraftedSummary = internalMutation({
  args: {
    clientId: v.id("clients"),
    url: v.string(),
    requestedAt: v.number(),
    text: v.string(),
  },
  returns: v.union(v.literal("saved"), v.literal("person"), v.literal("stale"), v.literal("empty")),
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") return "stale" as const;
    if (summaryWrittenByPerson(client)) return "person" as const;
    if (client.website !== args.url || client.websiteRead?.requestedAt !== args.requestedAt) return "stale" as const;
    const text = args.text.replace(/\s+/g, " ").trim();
    if (!text) return "empty" as const;
    // The summary is not part of Edit company's stale check: the company's
    // last change (`updatedAt`) stays as it is, as for a website read.
    await ctx.db.patch(client._id, {
      summary: { text: clipText(text, MAX_DRAFTED_SUMMARY_CHARS), aiDraftedFrom: args.url, aiDraftedAt: Date.now() },
    });
    return "saved" as const;
  },
});

/**
 * A Manager or Admin writes or changes the company's summary (Edit company's
 * rule). Empty text removes it, so a later website read may draft one again.
 * The AI's draft address is kept, so the card still names where it came from.
 */
export const updateCompanySummary = mutation({
  args: { clientId: v.id("clients"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["manager", "admin"]);
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") domainError("NOT_FOUND", "This company no longer exists.");
    const text = args.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length > MAX_COMPANY_SUMMARY_CHARS) {
      domainError("INVALID_INPUT", `A summary can be at most ${MAX_COMPANY_SUMMARY_CHARS.toLocaleString("en-CA")} characters.`);
    }
    if (!text) {
      await ctx.db.patch(client._id, { summary: undefined });
      return null;
    }
    if (client.summary?.text === text && client.summary.editedBy !== undefined) return null;
    await ctx.db.patch(client._id, {
      summary: {
        text,
        ...(client.summary?.aiDraftedFrom ? { aiDraftedFrom: client.summary.aiDraftedFrom } : {}),
        ...(client.summary?.aiDraftedAt ? { aiDraftedAt: client.summary.aiDraftedAt } : {}),
        editedBy: user._id,
        editedAt: Date.now(),
      },
    });
    return null;
  },
});

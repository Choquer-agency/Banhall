/**
 * A company's website read into a company file (owner, 2026-10-29: "We can
 * include the company website field"). Saving a website (New company, Edit
 * company) asks `companyWebsiteNode.readCompanyWebsite` to fetch the home
 * page and at most one about page; this file saves what it read as a company
 * file named "Website: <host>", so the company file pipeline (search pieces,
 * labels, drafts and Seeds as company background) does the rest. Only the
 * company's own address is fetched: no AI call and no web search.
 *
 * A new website archives the file the old one was read into, a removed
 * website archives it too, and a failed read is kept on the company row with
 * a plain reason; none of it ever blocks the save.
 */
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { companyFileTextFacts, insertCompanyFileTextPieces } from "./lib/companyFileText";
import { deriveProcessingStatus } from "../shared/documentStatus";
import { companyWebsiteFileName } from "../shared/companyWebsite";

async function logFileEvent(
  ctx: MutationCtx,
  file: Pick<Doc<"companyFiles">, "_id" | "clientId" | "fileName">,
  action: "add" | "archive",
  userId: Id<"users">,
  at: number
) {
  await ctx.db.insert("companyFileEvents", {
    clientId: file.clientId,
    companyFileId: file._id,
    fileName: file.fileName,
    action,
    userId,
    at,
  });
}

/** Archives the company's website file, if it has one still in use. */
async function archiveWebsiteFile(ctx: MutationCtx, client: Doc<"clients">, userId: Id<"users">, at: number, keep?: Id<"companyFiles">) {
  if (!client.websiteFileId || client.websiteFileId === keep) return;
  const file = await ctx.db.get(client.websiteFileId);
  if (!file || file.archived === true || file.clientId !== client._id) return;
  await ctx.db.patch(file._id, { archived: true });
  await logFileEvent(ctx, file, "archive", userId, at);
}

/**
 * Called in the same transaction as a website change on a company row
 * (`clients.createClient`, `clients.updateCompany`), after the row holds the
 * new `website`. A new website is marked as being read and the read is
 * scheduled; a removed one archives its file.
 */
export async function onCompanyWebsiteChanged(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  website: string | undefined,
  userId: Id<"users">,
  now: number
) {
  const client = await ctx.db.get(clientId);
  if (!client) return;
  if (!website) {
    await archiveWebsiteFile(ctx, client, userId, now);
    await ctx.db.patch(clientId, { websiteRead: undefined, websiteFileId: undefined });
    return;
  }
  await ctx.db.patch(clientId, { websiteRead: { url: website, status: "reading", requestedAt: now } });
  await ctx.scheduler.runAfter(0, internal.companyWebsiteNode.readCompanyWebsite, {
    clientId,
    url: website,
    requestedAt: now,
    userId,
  });
}

export const websiteReadResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    text: v.string(),
    title: v.union(v.string(), v.null()),
    pages: v.array(v.string()),
  }),
  v.object({ ok: v.literal(false), reason: v.string() })
);

/**
 * Saves a finished read, if it is still the company's latest: the text as
 * the company's website file (the same text already there is kept), the
 * file it replaces archived, both logged; or the plain reason it failed. A
 * read for an address the company no longer has, or overtaken by a newer
 * read, is dropped.
 */
export const finishWebsiteRead = internalMutation({
  args: {
    clientId: v.id("clients"),
    url: v.string(),
    requestedAt: v.number(),
    userId: v.id("users"),
    result: websiteReadResultValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (
      !client ||
      client.status !== "active" ||
      client.website !== args.url ||
      client.websiteRead?.requestedAt !== args.requestedAt
    ) {
      return null;
    }
    const now = Date.now();
    const read = { url: args.url, requestedAt: args.requestedAt, finishedAt: now };
    if (!args.result.ok) {
      await ctx.db.patch(client._id, { websiteRead: { ...read, status: "failed", reason: args.result.reason } });
      return null;
    }
    const text = args.result.text;
    const fileName = companyWebsiteFileName(args.url);
    const facts = await companyFileTextFacts(text);
    // The same text under the same name, still in use: nothing new to add.
    const same = await ctx.db
      .query("companyFiles")
      .withIndex("by_clientId_and_textHash_and_fileName_and_archived", (q) =>
        q.eq("clientId", client._id).eq("textHash", facts.textHash).eq("fileName", fileName).eq("archived", undefined)
      )
      .first();
    let fileId: Id<"companyFiles">;
    if (same) {
      fileId = same._id;
    } else {
      const user = await ctx.db.get(args.userId);
      const derived = deriveProcessingStatus({ fileName, content: text, intake: "pasted" });
      fileId = await ctx.db.insert("companyFiles", {
        clientId: client._id,
        fileName,
        fileType: "txt",
        category: "background",
        mimeType: "text/plain",
        ...facts,
        processingStatus: derived.status,
        ...(derived.detail ? { processingDetail: derived.detail } : {}),
        uploadedBy: args.userId,
        ...(user?.role ? { uploaderRole: user.role } : {}),
        createdAt: now,
        ...(facts.hasText ? { searchPiecesDue: true as const, searchPiecesNextAt: 0 } : {}),
      });
      await insertCompanyFileTextPieces(ctx, fileId, text);
      await logFileEvent(ctx, { _id: fileId, clientId: client._id, fileName }, "add", args.userId, now);
    }
    await archiveWebsiteFile(ctx, client, args.userId, now, fileId);
    await ctx.db.patch(client._id, { websiteRead: { ...read, status: "read" }, websiteFileId: fileId });
    return null;
  },
});

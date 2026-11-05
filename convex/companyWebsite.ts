/**
 * A company's website read into a company file (owner, 2026-10-29: "We can
 * include the company website field"). Saving a website (New company, Edit
 * company) asks `companyWebsiteNode.readCompanyWebsite` to fetch the home
 * page and at most one about page; this file saves what it read as a company
 * file named "Website: <host>", so the company file pipeline (search pieces,
 * labels, drafts and Seeds as company background) does the rest. Only the
 * company's own address is fetched: no AI call and no web search.
 *
 * A new website archives the file the old one was read into, once the new
 * read is saved or has failed; a removed website archives it at once. A
 * failed read (or one still not finished after WEBSITE_READ_EXPIRY_MS) is
 * kept on the company row with a plain reason; none of it ever blocks the
 * save. Each person may ask for website reads at the rate of
 * `websiteReadPerUser`; past it the read fails with a plain reason.
 */
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { companyFileTextFacts, insertCompanyFileTextPieces } from "./lib/companyFileText";
import { deriveProcessingStatus } from "../shared/documentStatus";
import { companyWebsiteFileName, companyWebsiteHost } from "../shared/companyWebsite";
import { limitUserAction } from "./lib/aiRateLimits";
import { WEBSITE_READ_REASONS } from "./lib/websiteRead";
import { requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { summaryWrittenByPerson } from "./companySummary";

/** A read still not finished this long after it was asked for has failed. */
export const WEBSITE_READ_EXPIRY_MS = 2 * 60_000;
/** The reason a read past the hourly limit shows, after "The website could not be read: ". */
export const WEBSITE_READ_RATE_LIMITED =
  "more than 20 websites were saved for reading in the last hour. Remove it and add it again later.";

function rateLimited(error: unknown): boolean {
  return error instanceof ConvexError && (error.data as { code?: unknown } | null)?.code === "RATE_LIMITED";
}

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
 * A read that failed: its plain reason on the company row, and the file of
 * the address it replaced archived, so an old website's text stops feeding
 * drafts once the address changed. A read of the same address asked for
 * again (Read again, 2026-11-04) keeps the file it was already read into.
 */
/**
 * Logs a finished read for the company's Activity tab (2026-11-04): saved
 * as a new file, unchanged, or failed with its reason (companyWebsiteReads).
 */
async function logWebsiteRead(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  url: string,
  outcome: Doc<"companyWebsiteReads">["outcome"],
  userId: Id<"users">,
  at: number,
  extra: { reason?: string; companyFileId?: Id<"companyFiles"> } = {}
) {
  await ctx.db.insert("companyWebsiteReads", {
    clientId,
    url,
    host: companyWebsiteHost(url),
    outcome,
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.companyFileId ? { companyFileId: extra.companyFileId } : {}),
    userId,
    at,
  });
}

async function failRead(
  ctx: MutationCtx,
  client: Doc<"clients">,
  read: { url: string; requestedAt: number; again?: true },
  reason: string,
  userId: Id<"users">,
  now: number
) {
  await logWebsiteRead(ctx, client._id, read.url, "failed", userId, now, { reason });
  if (read.again) {
    await ctx.db.patch(client._id, { websiteRead: { ...read, status: "failed", reason, finishedAt: now } });
    return;
  }
  await archiveWebsiteFile(ctx, client, userId, now);
  await ctx.db.patch(client._id, {
    websiteRead: { ...read, status: "failed", reason, finishedAt: now },
    websiteFileId: undefined,
  });
}

/**
 * Called in the same transaction as a website change on a company row
 * (`clients.createClient`, `clients.updateCompany`), after the row holds the
 * new `website`. A new website is marked as being read, and the read and
 * its expiry check are scheduled (past the hourly limit the read fails at
 * once); a removed one archives its file.
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
  try {
    await limitUserAction(ctx, "websiteReadPerUser", userId);
  } catch (error) {
    if (!rateLimited(error)) throw error;
    await failRead(ctx, client, { url: website, requestedAt: now }, WEBSITE_READ_RATE_LIMITED, userId, now);
    return;
  }
  await scheduleWebsiteRead(ctx, clientId, website, userId, now, false);
}

/** Marks the website as being read and schedules the read and its expiry check. */
async function scheduleWebsiteRead(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  website: string,
  userId: Id<"users">,
  now: number,
  again: boolean
) {
  await ctx.db.patch(clientId, {
    websiteRead: { url: website, status: "reading", requestedAt: now, ...(again ? { again: true as const } : {}) },
  });
  await ctx.scheduler.runAfter(0, internal.companyWebsiteNode.readCompanyWebsite, {
    clientId,
    url: website,
    requestedAt: now,
    userId,
  });
  await ctx.scheduler.runAfter(WEBSITE_READ_EXPIRY_MS, internal.companyWebsite.expireWebsiteRead, {
    clientId,
    requestedAt: now,
    userId,
  });
}

/**
 * Read again (2026-11-04, the company profile's Details tab; Managers and
 * Admins, Edit company's rule): reads the company's saved website again
 * through the same read, under the same hourly limit. Past the limit it is
 * refused with the limit's words and the company is left as it is. A read
 * still running is not asked for twice. Text read again unchanged keeps
 * the file it has; a failed read keeps it too. The company's last change
 * does not move.
 */
export const readWebsiteAgain = mutation({
  args: { clientId: v.id("clients") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["manager", "admin"]);
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active") domainError("NOT_FOUND", "This company no longer exists.");
    if (!client.website) domainError("INVALID_INPUT", "This company has no website to read.");
    if (client.websiteRead?.status === "reading" && client.websiteRead.url === client.website) return null;
    try {
      await limitUserAction(ctx, "websiteReadPerUser", user._id);
    } catch (error) {
      if (!rateLimited(error)) throw error;
      domainError("RATE_LIMITED", "More than 20 websites were read for you in the last hour. Try again later.");
    }
    // A read of an address never read into a file is a first read, not a re-read.
    const again = client.websiteFileId !== undefined;
    await scheduleWebsiteRead(ctx, client._id, client.website, user._id, Date.now(), again);
    return null;
  },
});

/**
 * A read that never finished (its action was stopped, or never ran) fails
 * WEBSITE_READ_EXPIRY_MS after it was asked for, as unreachable, instead of
 * reading forever. A read that finished, or a newer one, is left alone.
 */
export const expireWebsiteRead = internalMutation({
  args: { clientId: v.id("clients"), requestedAt: v.number(), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    const read = client?.websiteRead;
    if (!client || !read || read.status !== "reading" || read.requestedAt !== args.requestedAt) return null;
    await failRead(ctx, client, read, WEBSITE_READ_REASONS.unreachable, args.userId, Date.now());
    return null;
  },
});

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
      await failRead(ctx, client, { ...read, ...(client.websiteRead?.again ? { again: true as const } : {}) }, args.result.reason, args.userId, now);
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
    await logWebsiteRead(ctx, client._id, args.url, same ? "unchanged" : "saved", args.userId, now, { companyFileId: fileId });
    // 2026-11-04: the AI drafts the company summary from this text, once
    // per read, while no person has written one (never over their text).
    if (facts.hasText && !summaryWrittenByPerson(client)) {
      await ctx.scheduler.runAfter(0, internal.ai.companySummary.draftCompanySummary, {
        clientId: client._id,
        companyFileId: fileId,
        url: args.url,
        requestedAt: args.requestedAt,
        userId: args.userId,
      });
    }
    return null;
  },
});

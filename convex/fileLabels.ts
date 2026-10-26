/**
 * Labels for project files (2026-10-26, context pipeline plan Phase B4;
 * part 2 of the first 2026-10-26 entry): the kind of document, the fiscal
 * year it is about, a title and a two-line summary, from the file_labels
 * model role (Claude Haiku), for the file list drafting and chat read.
 * Labels describe a file; they are never evidence, and no draft or quote
 * cites them. Names are hidden as placeholders before the call and put back
 * after it (convex/ai/fileLabels.ts).
 *
 * A file is due when its search pieces are cut and its labels describe
 * another text, name or prompt version, or when it is restored with stale
 * labels. A sweep every minute claims due files a few at a time; a failed
 * call is tried again after 1, 10 and 60 minutes, then left until the
 * one-off pass marks it due again.
 */
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  LABEL_CLAIM_MS,
  LABEL_RETRY_DELAYS_MS,
  LABEL_SWEEP_FILES,
  LABEL_SWEEP_SPACING_MS,
  labelSamples,
  labelsCurrent,
} from "./lib/fileLabels";
import { documentHasText, documentTextHash, documentTextLength, readDocumentText } from "./lib/documentText";
import { isProjectDeleting } from "./lib/projectDeletion";
import { listProjectTranscripts } from "./lib/transcripts";
import { projectPlaceholderMap } from "./lib/transcriptPlaceholders";
import { transcriptPlaceholdersEnabled } from "./appSettings";
import { quotableFileText } from "../shared/wordMarkdown";
import { placeholderMapValidator } from "./lib/placeholderValidators";

/** Clears a file from the label queue. */
const OFF_THE_QUEUE = { labelsDue: undefined, labelsNextAt: undefined } as const;

/**
 * Starts the due files' labels, a few at a time (crons.ts, every minute):
 * the files whose next try has come, oldest first, project files before
 * company files. A file that no longer needs labels (archived, empty,
 * already labelled) leaves the queue here.
 * Claiming one moves its next try on by LABEL_CLAIM_MS, so a stopped call
 * is tried again then and never holds a place in the queue.
 */
export const sweepDueFileLabels = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    // Bytes capped: a row that still holds its own text is heavy.
    const { page: due } = await ctx.db
      .query("projectDocuments")
      .withIndex("by_labelsDue_and_labelsNextAt", (q) => q.eq("labelsDue", true).lte("labelsNextAt", now))
      .paginate({ numItems: LABEL_SWEEP_FILES, cursor: null, maximumBytesRead: 4 * 1024 * 1024 });
    let started = 0;
    for (const doc of due) {
      if (doc.archived || !documentHasText(doc) || labelsCurrent(doc, await documentTextHash(doc))) {
        await ctx.db.patch(doc._id, OFF_THE_QUEUE);
        continue;
      }
      await ctx.db.patch(doc._id, { labelsNextAt: now + LABEL_CLAIM_MS });
      await ctx.scheduler.runAfter(started * LABEL_SWEEP_SPACING_MS, internal.ai.fileLabels.labelFile, { documentId: doc._id });
      started += 1;
    }
    // Company files (Phase C) take the places project files left.
    const room = LABEL_SWEEP_FILES - due.length;
    if (room <= 0) return started;
    const companyDue = await ctx.db
      .query("companyFiles")
      .withIndex("by_labelsDue_and_labelsNextAt", (q) => q.eq("labelsDue", true).lte("labelsNextAt", now))
      .take(room);
    for (const file of companyDue) {
      if (file.archived || !file.hasText || labelsCurrent(file, file.textHash)) {
        await ctx.db.patch(file._id, OFF_THE_QUEUE);
        continue;
      }
      await ctx.db.patch(file._id, { labelsNextAt: now + LABEL_CLAIM_MS });
      await ctx.scheduler.runAfter(started * LABEL_SWEEP_SPACING_MS, internal.ai.fileLabels.labelCompanyFile, {
        companyFileId: file._id,
      });
      started += 1;
    }
    return started;
  },
});

/** A due file that a label call found nothing to label for leaves the queue. */
export const retireFileLabels = internalMutation({
  args: { documentId: v.id("projectDocuments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    if (
      doc.archived ||
      !documentHasText(doc) ||
      (await isProjectDeleting(ctx, doc.projectId)) ||
      labelsCurrent(doc, await documentTextHash(doc))
    ) {
      await ctx.db.patch(doc._id, OFF_THE_QUEUE);
    }
    return null;
  },
});

/**
 * What one label call reads: the file's name and kind, its length, the
 * opening and samples of its text as the AI reads it, and the project's
 * placeholder map (every name drafts hide, transcript speakers included).
 * Null when the file is gone, archived, empty, already labelled, or its
 * project is being erased.
 */
export const labelInput = internalQuery({
  args: { documentId: v.id("projectDocuments") },
  returns: v.union(
    v.null(),
    v.object({
      projectId: v.id("projects"),
      fileName: v.string(),
      category: v.union(v.string(), v.null()),
      pageCount: v.union(v.number(), v.null()),
      textLength: v.number(),
      textHash: v.string(),
      samples: v.object({ opening: v.string(), middle: v.optional(v.string()), end: v.optional(v.string()) }),
      placeholders: placeholderMapValidator,
    })
  ),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.archived || !documentHasText(doc)) return null;
    const project = await ctx.db.get(doc.projectId);
    if (!project || (await isProjectDeleting(ctx, doc.projectId))) return null;
    const textHash = await documentTextHash(doc);
    if (labelsCurrent(doc, textHash)) return null;
    const samples = labelSamples(quotableFileText(await readDocumentText(ctx, doc), doc.textFormat));
    const texts = [doc.fileName, samples.opening, samples.middle ?? "", samples.end ?? ""];
    const placeholders = (await transcriptPlaceholdersEnabled(ctx))
      ? [...(await projectPlaceholderMap(ctx, project, await listProjectTranscripts(ctx, project._id), texts))]
      : [];
    return {
      projectId: doc.projectId,
      fileName: doc.fileName,
      category: doc.category ?? null,
      pageCount: doc.pageCount ?? null,
      textLength: documentTextLength(doc),
      textHash,
      samples,
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
 * Keeps a file's labels when the file still has the text and name they were
 * made from and its project is not being erased.
 */
export const saveFileLabels = internalMutation({
  args: {
    documentId: v.id("projectDocuments"),
    textHash: v.string(),
    fileName: v.string(),
    model: v.string(),
    /** The prompt version the call was made with. */
    promptVersion: v.string(),
    labels: v.object({
      documentType: v.string(),
      fiscalYear: v.union(v.number(), v.null()),
      title: v.string(),
      summary: v.string(),
    }),
  },
  returns: v.union(v.literal("kept"), v.literal("changed")),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return "changed";
    if (await isProjectDeleting(ctx, doc.projectId)) {
      await ctx.db.patch(doc._id, OFF_THE_QUEUE);
      return "changed";
    }
    // The file changed meanwhile: it is due again, at once.
    if (doc.fileName !== args.fileName || (await documentTextHash(doc)) !== args.textHash) {
      await ctx.db.patch(doc._id, { labelsDue: true, labelsNextAt: 0 });
      return "changed";
    }
    await ctx.db.patch(doc._id, {
      labels: {
        ...args.labels,
        model: args.model,
        promptVersion: args.promptVersion,
        textHash: args.textHash,
        fileName: args.fileName,
        labeledAt: Date.now(),
      },
      ...OFF_THE_QUEUE,
      labelsAttempts: undefined,
      labelsLastError: undefined,
    });
    return "kept";
  },
});

/** A failed label call: tried again after a wait, up to four tries in all. */
export const failFileLabels = internalMutation({
  args: { documentId: v.id("projectDocuments"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    const attempts = (doc.labelsAttempts ?? 0) + 1;
    const wait = LABEL_RETRY_DELAYS_MS[attempts - 1];
    if (wait === undefined) {
      console.warn(`fileLabels: ${doc._id} left without labels after ${attempts} tries (${args.reason})`);
      await ctx.db.patch(doc._id, { ...OFF_THE_QUEUE, labelsAttempts: attempts, labelsLastError: args.reason });
      return null;
    }
    await ctx.db.patch(doc._id, { labelsAttempts: attempts, labelsNextAt: Date.now() + wait, labelsLastError: args.reason });
    return null;
  },
});

/**
 * One-off pass, run by hand (dev first, then production): marks every file
 * with text whose labels are missing or stale as due, a page at a time.
 * `dryRun` only counts; the last page logs the total.
 */
export const markFileLabelsDue = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    markedSoFar: v.optional(v.number()),
  },
  returns: v.object({ marked: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("projectDocuments")
      .paginate({ numItems: 100, cursor: args.cursor ?? null, maximumBytesRead: 4 * 1024 * 1024 });
    let marked = args.markedSoFar ?? 0;
    for (const doc of page.page) {
      if (doc.archived || !documentHasText(doc) || doc.labelsDue) continue;
      if (labelsCurrent(doc, await documentTextHash(doc))) continue;
      if (!args.dryRun) await ctx.db.patch(doc._id, { labelsDue: true, labelsNextAt: 0, labelsAttempts: undefined });
      marked += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.fileLabels.markFileLabelsDue, {
        cursor: page.continueCursor,
        ...(args.dryRun ? { dryRun: true } : {}),
        markedSoFar: marked,
      });
    } else {
      console.info(`markFileLabelsDue: ${args.dryRun ? "would mark" : "marked"} ${marked} files in all`);
    }
    return { marked, isDone: page.isDone };
  },
});

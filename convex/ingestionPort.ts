import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getCurrentUserOrNull } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { requireCapability } from "./lib/roleCapabilities";
import { userDisplayLabel } from "./lib/teamRoster";
import { extensionOf, fiscalYearEndFromLabel } from "./lib/ingestionClassify";
import { deriveProcessingStatus } from "../shared/documentStatus";
import { workflowStageRank } from "../shared/workflowStages";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import {
  projectDashboardProjectionPatch,
  upsertDashboardCompany,
} from "./lib/dashboardProjection";
import { generateShareToken } from "./projects";

// ─── Historical projects ported from OneDrive ingestion ─────────────────────
// 2026-08-18 amendment (client meeting): an approved historical PD in the
// ingestion queue can be ported into the Projects repository so a
// client+fiscal-year card exists holding last year's PD (e.g. for QA review
// when a rollover project starts). Porting is a deliberate act separate from
// Brain approval. Matching is exact-normalized dashboardCompanyKey + fiscal
// year; ambiguous multi-matches fail closed (D7 — never auto-merge). See
// docs/product-domain.md, 2026-08-18 amendment.

const FILE_TYPES: Record<string, "txt" | "md" | "pdf" | "docx"> = {
  txt: "txt",
  md: "md",
  pdf: "pdf",
  docx: "docx",
};
const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
};

/** Assert the port preconditions and return what the action needs. */
export const getItemForPort = internalQuery({
  args: { itemId: v.id("ingestionItems") },
  returns: v.object({
    alreadyPortedProjectId: v.union(v.id("projects"), v.null()),
    text: v.union(v.string(), v.null()),
    textStorageId: v.union(v.id("_storage"), v.null()),
    storageId: v.union(v.id("_storage"), v.null()),
    name: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrNull(ctx);
    if (user?.role !== "admin") domainError("NOT_AUTHORIZED", "Admin only");
    const item = await ctx.db.get(args.itemId);
    if (!item) domainError("NOT_FOUND", "Ingestion item not found");
    if (item.portedProjectId) {
      return {
        alreadyPortedProjectId: item.portedProjectId,
        text: null,
        textStorageId: null,
        storageId: null,
        name: item.name,
      };
    }
    if (item.status !== "approved") {
      domainError("INVALID_STATE", "Only approved files can be ported to a project");
    }
    if (item.docKind !== "pd") {
      domainError("INVALID_STATE", "Only PDs can be ported to a project");
    }
    if (!item.clientName?.trim() || !item.fiscalYear) {
      domainError(
        "INVALID_STATE",
        "This file has no client or fiscal year — fix its folder metadata first"
      );
    }
    if (!item.text && !item.textStorageId) {
      domainError("INVALID_STATE", "No extracted text on this item");
    }
    return {
      alreadyPortedProjectId: null,
      text: item.text ?? null,
      textStorageId: item.textStorageId ?? null,
      storageId: item.storageId ?? null,
      name: item.name,
    };
  },
});

export const finalizePort = internalMutation({
  args: {
    itemId: v.id("ingestionItems"),
    content: v.string(),
    copiedStorageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
  },
  returns: v.object({
    projectId: v.id("projects"),
    documentId: v.id("projectDocuments"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user || user.role !== "admin") {
      domainError("NOT_AUTHORIZED", "Admin only");
    }
    // Same authority as project creation: the porting admin becomes Creator
    // and initial Owner (2026-07-30 amendment) when a project is created.
    await requireCapability(ctx, "project.create");

    const item = await ctx.db.get(args.itemId);
    if (!item) domainError("NOT_FOUND", "Ingestion item not found");
    // Compare-and-set inside the transaction: retries and double-clicks
    // resolve to the first port's result.
    if (item.portedProjectId && item.portedDocumentId) {
      return {
        projectId: item.portedProjectId,
        documentId: item.portedDocumentId,
        created: false,
      };
    }
    if (item.status !== "approved" || item.docKind !== "pd") {
      domainError("INVALID_STATE", "Only approved PDs can be ported to a project");
    }
    const clientName = item.clientName?.trim();
    if (!clientName || !item.fiscalYear) {
      domainError("INVALID_STATE", "This file has no client or fiscal year");
    }
    if (!args.content.trim()) {
      domainError("INVALID_STATE", "No extracted text on this item");
    }

    const companyKey = dashboardCompanyKey(clientName);
    const matches = (
      await ctx.db
        .query("projects")
        .withIndex("by_dashboardCompanyKey_and_dashboardFiscalYearRank", (q) =>
          q
            .eq("dashboardCompanyKey", companyKey)
            .eq("dashboardFiscalYearRank", -item.fiscalYear!)
        )
        .take(10)
    );
    if (matches.length > 1) {
      domainError(
        "INVALID_INPUT",
        `More than one project matches ${clientName} fiscal ${item.fiscalYear} — attach this PD from the project page instead`
      );
    }

    const now = Date.now();
    let projectId: Id<"projects">;
    let created = false;
    if (matches.length === 1) {
      projectId = matches[0]._id;
    } else {
      created = true;
      const fiscalYearEnd = fiscalYearEndFromLabel(
        item.fiscalYearLabel,
        item.fiscalYear!
      );
      const title = `${clientName} — Fiscal ${item.fiscalYear} (historical)`;
      const dashboardProjection = projectDashboardProjectionPatch({
        title,
        clientName,
        fiscalYearEnd,
        workflowStage: "intake",
      });
      projectId = await ctx.db.insert("projects", {
        title,
        clientName,
        ...dashboardProjection,
        dashboardCompanyCounted: true,
        fiscalYearEnd,
        projectType: "writing",
        ownerId: user._id,
        workflowStage: "intake",
        workflowStageRank: workflowStageRank("intake"),
        workflowUpdatedAt: now,
        workflowVersion: 0,
        status: "draft",
        createdBy: user._id,
        shareToken: generateShareToken(),
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("projectEvents", {
        projectId,
        type: "ownership_transferred",
        actorId: user._id,
        to: user._id,
        note: "creation:initial-owner",
        at: now,
      });
      await ctx.db.insert("projectEvents", {
        projectId,
        type: "stage_changed",
        actorId: user._id,
        to: "intake",
        note: "creation:ingestion-port",
        at: now,
      });
      // Born at intake; the company row's stage bucket moves in the same
      // transaction (2026-08-06 second amendment).
      await upsertDashboardCompany(ctx, companyKey, clientName, 1, "intake");
      // Both existing creation paths insert an empty transcript row and
      // downstream consumers assume one exists.
      await ctx.db.insert("transcripts", {
        projectId,
        content: "",
        createdAt: now,
      });
    }

    const ext = extensionOf(item.name);
    const derived = deriveProcessingStatus({
      fileName: item.name,
      content: args.content,
      extractionFailed: false,
      intake: "file",
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: item.name,
      fileType: FILE_TYPES[ext] ?? "other",
      content: args.content,
      ...(args.copiedStorageId ? { storageId: args.copiedStorageId } : {}),
      ...(args.mimeType ? { mimeType: args.mimeType } : {}),
      source: "ingestion_port",
      category: "previous_pd",
      processingStatus: derived.status,
      processingDetail: derived.detail,
      uploadedBy: userDisplayLabel(user),
      createdAt: now,
    });

    await ctx.db.patch(item._id, {
      portedProjectId: projectId,
      portedDocumentId: documentId,
      portedAt: now,
      portedBy: user._id,
      updatedAt: now,
    });

    return { projectId, documentId, created };
  },
});

/** Port an approved historical PD into its client+fiscal-year project,
 * creating the project when none exists. Idempotent per item. */
export const portItemToProject = action({
  args: { itemId: v.id("ingestionItems") },
  returns: v.object({ projectId: v.id("projects"), created: v.boolean() }),
  handler: async (
    ctx,
    args
  ): Promise<{ projectId: Id<"projects">; created: boolean }> => {
    const item = await ctx.runQuery(internal.ingestionPort.getItemForPort, {
      itemId: args.itemId,
    });
    if (item.alreadyPortedProjectId) {
      return { projectId: item.alreadyPortedProjectId, created: false };
    }
    let content = item.text ?? "";
    if (item.textStorageId) {
      const blob = await ctx.storage.get(item.textStorageId);
      if (!blob) domainError("INVALID_STATE", "Extracted text not found in storage");
      content = await blob.text();
    }
    // Fresh copy of the original bytes — never share a blob id across tables
    // whose deletion lifecycles differ.
    let copiedStorageId: Id<"_storage"> | undefined;
    if (item.storageId) {
      const original = await ctx.storage.get(item.storageId);
      if (original) copiedStorageId = await ctx.storage.store(original);
    }
    const result: {
      projectId: Id<"projects">;
      documentId: Id<"projectDocuments">;
      created: boolean;
    } = await ctx.runMutation(internal.ingestionPort.finalizePort, {
      itemId: args.itemId,
      content,
      copiedStorageId,
      mimeType: MIME_TYPES[extensionOf(item.name)],
    });
    return { projectId: result.projectId, created: result.created };
  },
});

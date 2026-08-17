"use node";

// OneDrive → ingestionItems sync (BNH-17, Path A).
//
// App-only Microsoft Graph client-credentials flow against the client's
// drive. Walks the delta feed for the corpus root (default "Applications"),
// classifies files by the folder convention Michael showed on Jun 19
// (`<root>/<Client>/<Fiscal year>/…`, PDs in Submitted-style folders,
// transcripts under WIP/Technical/Audio), downloads + extracts text, and
// stages everything as pending_review. The admin approves items into The
// Brain at /admin/ingestion — this file never touches brainSources.
//
// Delta-protocol notes (learn.microsoft.com driveitem-delta):
//   - deltaLink is only saved when a walk completes; a mid-walk nextLink is
//     checkpointed every page so huge initial crawls resume, not replay.
//   - HTTP 410 = resyncRequired → cursors are dropped and the walk restarts.
//   - deleted facets retire the staged row (markDriveItemRemoved).
//   - items can arrive without parentReference.path; those are resolved with
//     a per-item metadata GET before classification.
//   - Folder renames do NOT re-emit descendants; a full re-crawl (clear the
//     oneDriveSyncState row) is the recovery for reorganized trees.

import { internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireGraphConfigured, type GraphConfig } from "./lib/providerConfig";
import {
  INGEST_EXTENSIONS,
  MAX_FILE_BYTES,
  classify,
  extensionOf,
} from "./lib/ingestionClassify";
import mammoth from "mammoth";
import { createHash } from "node:crypto";

const GRAPH = "https://graph.microsoft.com/v1.0";
// Full extracted text is byte-capped (UTF-8) and stored as a blob; only a
// short preview lives on the row so list/pair queries stay tiny.
const MAX_TEXT_BYTES = 700_000;
const PREVIEW_CHARS = 8_000;
const PROCESS_BATCH = 20;
const BATCHES_PER_INVOCATION = 6; // ~120 files, then reschedule
const PAGES_PER_INVOCATION = 40; // ~8k delta items, then reschedule

type DriveItem = {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string; hashes?: { quickXorHash?: string } };
  folder?: unknown;
  deleted?: unknown;
  parentReference?: { path?: string };
};

async function graphToken(cfg: GraphConfig): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Graph token request failed (${res.status})`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Graph token response had no token");
  return json.access_token;
}

async function graphGet(token: string, url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429 || res.status === 503) {
      if (attempt >= 4) return res;
      const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    return res;
  }
}

type PathResolution =
  | { kind: "ok"; rel: string }
  | { kind: "no_path" }
  | { kind: "outside" };

/** Path under the sync root, e.g. "Acme/2025 - Dec 31/Submitted". */
function relativePath(item: DriveItem, rootPath: string): PathResolution {
  const raw = item.parentReference?.path;
  if (!raw) return { kind: "no_path" };
  const marker = raw.indexOf("root:");
  if (marker === -1) return { kind: "no_path" };
  let decoded = raw.slice(marker + "root:".length);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep the raw form — better an odd-looking path than a dropped file
  }
  const segments = decoded.split("/").filter(Boolean);
  const rootSegments = rootPath.split("/").filter(Boolean);
  for (let i = 0; i < rootSegments.length; i++) {
    if (segments[i]?.toLowerCase() !== rootSegments[i].toLowerCase()) {
      return { kind: "outside" };
    }
  }
  return { kind: "ok", rel: segments.slice(rootSegments.length).join("/") };
}

/** Delta items may omit parentReference.path — resolve it by item id. */
async function resolveItemPath(
  token: string,
  cfg: GraphConfig,
  itemId: string
): Promise<DriveItem | null> {
  const res = await graphGet(
    token,
    `${GRAPH}/drives/${cfg.driveId}/items/${itemId}?$select=id,name,size,file,folder,parentReference,lastModifiedDateTime`
  );
  if (!res.ok) return null;
  return (await res.json()) as DriveItem;
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) return { text, truncated: false };
  // Slice on the byte budget, then decode ignoring a torn trailing character.
  const sliced = encoded.slice(0, maxBytes);
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(sliced).replace(/�+$/, ""),
    truncated: true,
  };
}

async function extractText(
  bytes: ArrayBuffer,
  fileName: string
): Promise<{ text?: string; note?: string }> {
  const ext = extensionOf(fileName);
  if (ext === "txt" || ext === "vtt") {
    return { text: new TextDecoder("utf-8").decode(bytes) };
  }
  if (ext === "docx") {
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    return { text: result.value };
  }
  if (ext === "pdf") {
    return { note: "PDF — text extraction not yet supported server-side" };
  }
  if (ext === "doc") {
    return { note: "Legacy .doc — re-save as .docx to extract text" };
  }
  return { note: `Unsupported type .${ext}` };
}

/** Store extracted text (bounded) and mark the item reviewed-ready. */
async function finishExtraction(
  ctx: ActionCtx,
  itemId: Id<"ingestionItems">,
  storageId: Id<"_storage">,
  bytes: ArrayBuffer,
  fileName: string
) {
  const { text, note } = await extractText(bytes, fileName);
  const trimmed = text?.trim();
  if (!trimmed) {
    await ctx.runMutation(internal.ingestion.markItemProcessed, {
      itemId,
      storageId,
      extractNote: note,
    });
    return;
  }
  const bounded = truncateUtf8(trimmed, MAX_TEXT_BYTES);
  const textStorageId = await ctx.storage.store(
    new Blob([bounded.text], { type: "text/plain" })
  );
  await ctx.runMutation(internal.ingestion.markItemProcessed, {
    itemId,
    storageId,
    text: bounded.text.slice(0, PREVIEW_CHARS),
    textStorageId,
    extractNote: bounded.truncated
      ? `${note ? `${note}; ` : ""}text truncated at ${MAX_TEXT_BYTES} bytes`
      : note,
  });
}

/** Fetch + extract batches of discovered items. */
async function processBatches(
  ctx: ActionCtx,
  cfg: GraphConfig,
  token: string,
  runId: Id<"oneDriveSyncRuns">
): Promise<{ done: boolean }> {
  const groupKeys = new Set<string>();
  const flushGroups = async () => {
    const keys = [...groupKeys];
    groupKeys.clear();
    // recomputePairs bounds itself to 25 groups per mutation.
    for (let i = 0; i < keys.length; i += 25) {
      await ctx.runMutation(internal.ingestion.recomputePairs, {
        groupKeys: keys.slice(i, i + 25),
      });
    }
  };

  for (let batch = 0; batch < BATCHES_PER_INVOCATION; batch++) {
    const items = await ctx.runQuery(internal.ingestion.takeUnprocessedItems, {
      limit: PROCESS_BATCH,
    });
    if (items.length === 0) {
      await flushGroups();
      return { done: true };
    }

    let processed = 0;
    for (const item of items) {
      try {
        if (item.size > MAX_FILE_BYTES) {
          await ctx.runMutation(internal.ingestion.markItemFailed, {
            itemId: item._id,
            error: `File too large to ingest (${Math.round(item.size / 1024 / 1024)}MB)`,
          });
          groupKeys.add(item.pairGroupKey);
          continue;
        }
        const res = await graphGet(
          token,
          `${GRAPH}/drives/${cfg.driveId}/items/${item.driveItemId}/content`
        );
        if (!res.ok) {
          throw new Error(`Download failed (${res.status})`);
        }
        const bytes = await res.arrayBuffer();
        const storageId = await ctx.storage.store(new Blob([bytes]));
        await finishExtraction(ctx, item._id, storageId, bytes, item.name);
        groupKeys.add(item.pairGroupKey);
        processed++;
      } catch (err) {
        // markItemFailed recomputes the group itself.
        await ctx.runMutation(internal.ingestion.markItemFailed, {
          itemId: item._id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await ctx.runMutation(internal.ingestion.updateSyncRun, {
      runId,
      addProcessed: processed,
    });
  }
  await flushGroups();
  return { done: false };
}

function initialDeltaUrl(cfg: GraphConfig): string {
  return `${GRAPH}/drives/${cfg.driveId}/root:/${cfg.rootPath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/")}:/delta?$top=200`;
}

/**
 * Walk the delta feed for up to PAGES_PER_INVOCATION pages. Returns whether
 * the walk reached its deltaLink (complete) or was checkpointed mid-walk.
 */
async function walkDelta(
  ctx: ActionCtx,
  cfg: GraphConfig,
  token: string,
  runId: Id<"oneDriveSyncRuns">
): Promise<{ complete: boolean }> {
  const state = await ctx.runQuery(internal.ingestion.getSyncState, {});
  let url = state?.nextLink ?? state?.deltaLink ?? initialDeltaUrl(cfg);
  let resyncs = 0;

  for (let page = 0; page < PAGES_PER_INVOCATION; page++) {
    const res = await graphGet(token, url);
    if (res.status === 410) {
      // resyncRequired: cursors are stale — drop them and start over once.
      if (resyncs++ > 0) throw new Error("Graph delta resync loop (410)");
      await ctx.runMutation(internal.ingestion.clearSyncCursor, {});
      url = res.headers.get("Location") ?? initialDeltaUrl(cfg);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Graph delta request failed (${res.status})`);
    }
    const json = (await res.json()) as {
      value?: DriveItem[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };

    const batch: Array<Record<string, unknown>> = [];
    let skipped = 0;
    for (let item of json.value ?? []) {
      if (item.deleted) {
        await ctx.runMutation(internal.ingestion.markDriveItemRemoved, {
          driveItemId: item.id,
        });
        continue;
      }
      if (item.folder || !item.file) continue;
      if (!INGEST_EXTENSIONS.has(extensionOf(item.name))) {
        skipped++;
        continue;
      }
      let resolved = relativePath(item, cfg.rootPath);
      if (resolved.kind === "no_path") {
        // Delta may omit parentReference.path — fetch the item to resolve it.
        const full = await resolveItemPath(token, cfg, item.id);
        if (full) {
          item = { ...full, file: full.file ?? item.file };
          resolved = relativePath(item, cfg.rootPath);
        }
      }
      if (resolved.kind !== "ok") {
        skipped++;
        continue;
      }
      const relPath = resolved.rel;
      const meta = classify(relPath, item.name);
      const contentHash =
        item.file?.hashes?.quickXorHash ??
        createHash("sha256")
          .update(`${item.id}:${item.size}:${item.lastModifiedDateTime}`)
          .digest("hex");
      batch.push({
        driveItemId: item.id,
        path: relPath ? `${relPath}/${item.name}` : item.name,
        name: item.name,
        clientName: meta.clientName,
        fiscalYearLabel: meta.fiscalYearLabel,
        fiscalYear: meta.fiscalYear,
        docKind: meta.docKind,
        size: item.size ?? 0,
        lastModifiedAt: item.lastModifiedDateTime
          ? Date.parse(item.lastModifiedDateTime)
          : Date.now(),
        contentHash,
        pairGroupKey: meta.pairGroupKey,
      });
    }

    const inserted =
      batch.length > 0
        ? await ctx.runMutation(internal.ingestion.upsertDiscoveredBatch, {
            items: batch as never,
          })
        : 0;
    await ctx.runMutation(internal.ingestion.updateSyncRun, {
      runId,
      addDiscovered: inserted,
      addSkipped: skipped,
    });

    if (json["@odata.deltaLink"]) {
      await ctx.runMutation(internal.ingestion.saveDeltaLink, {
        deltaLink: json["@odata.deltaLink"],
      });
      return { complete: true };
    }
    if (!json["@odata.nextLink"]) return { complete: true };
    url = json["@odata.nextLink"];
    // Durable checkpoint: a crash or the page cap resumes from here.
    await ctx.runMutation(internal.ingestion.saveNextLink, { nextLink: url });
  }
  return { complete: false };
}

async function runSyncSlice(
  ctx: ActionCtx,
  runId: Id<"oneDriveSyncRuns">,
  phase: "discover" | "process"
) {
  try {
    const cfg = requireGraphConfigured();
    const token = await graphToken(cfg);

    if (phase === "discover") {
      const { complete } = await walkDelta(ctx, cfg, token, runId);
      if (!complete) {
        // More delta pages remain — keep discovering before processing.
        await ctx.scheduler.runAfter(0, internal.ingestionSync.syncOneDrive, {
          runId,
        });
        return;
      }
    }

    const { done } = await processBatches(ctx, cfg, token, runId);
    if (done) {
      await ctx.runMutation(internal.ingestion.updateSyncRun, {
        runId,
        status: "completed",
      });
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.ingestionSync.continueProcessing,
        { runId }
      );
    }
  } catch (err) {
    await ctx.runMutation(internal.ingestion.updateSyncRun, {
      runId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const syncOneDrive = internalAction({
  args: { runId: v.id("oneDriveSyncRuns") },
  handler: async (ctx, args) => {
    await runSyncSlice(ctx, args.runId, "discover");
    return null;
  },
});

/** Continuation for large backlogs — fresh token, next slice of the queue. */
export const continueProcessing = internalAction({
  args: { runId: v.id("oneDriveSyncRuns") },
  handler: async (ctx, args) => {
    await runSyncSlice(ctx, args.runId, "process");
    return null;
  },
});

/**
 * Extract one crawler-uploaded item (Path B). The upload endpoint in
 * convex/http.ts stores the bytes and stages the row as "fetched"; this
 * action runs the same extraction as the Graph path and lands it in review.
 */
export const extractUploadedItem = internalAction({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    const item = await ctx.runQuery(internal.ingestion.getItem, {
      itemId: args.itemId,
    });
    if (!item || item.status !== "fetched" || !item.storageId) return null;
    try {
      const blob = await ctx.storage.get(item.storageId);
      if (!blob) throw new Error("Stored bytes not found");
      const bytes = await blob.arrayBuffer();
      await finishExtraction(ctx, item._id, item.storageId, bytes, item.name);
      await ctx.runMutation(internal.ingestion.recomputePairs, {
        groupKeys: [item.pairGroupKey],
      });
    } catch (err) {
      // markItemFailed recomputes the pair group itself, so a failed
      // extraction still surfaces its gap (e.g. lone-PD missing_transcript).
      await ctx.runMutation(internal.ingestion.markItemFailed, {
        itemId: args.itemId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  },
});

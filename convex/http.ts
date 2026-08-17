import { httpRouter } from "convex/server";
import { httpAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import {
  INGEST_EXTENSIONS,
  MAX_FILE_BYTES,
  classify,
  extensionOf,
  sanitizeRelPath,
} from "./lib/ingestionClassify";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

/** Constant-time-ish comparison — no early exit on first mismatched byte. */
function keysMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Path B: crawler upload intake (BNH-17) ─────────────────────────────────
// scripts/onedrive-crawler.mjs walks a locally synced OneDrive folder and
// POSTs one file per request. Server never trusts the client: bearer key,
// path sanitization, extension allowlist, and size cap are all re-checked
// here, and classification happens server-side. Uploads land as staged
// ingestionItems (pending admin review) — never directly in the Brain.
http.route({
  path: "/ingestion/upload",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const configured = env.INGEST_API_KEY?.trim();
    if (!configured || configured.length < 32) {
      return Response.json(
        { error: "Upload intake is not configured" },
        { status: 503 }
      );
    }
    const auth = req.headers.get("Authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!presented || !keysMatch(presented, configured)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const relPath = sanitizeRelPath(url.searchParams.get("path") ?? "");
    const mtimeRaw = Number(url.searchParams.get("mtime") ?? "");
    const claimedHash = (url.searchParams.get("hash") ?? "").trim();
    if (!relPath || relPath.split("/").length < 2) {
      return Response.json(
        { error: "Invalid or missing ?path (expected Client/Fiscal year/…/file)" },
        { status: 400 }
      );
    }
    if (!/^[a-f0-9]{64}$/.test(claimedHash)) {
      return Response.json(
        { error: "Missing ?hash (sha256 hex of file bytes)" },
        { status: 400 }
      );
    }
    const name = relPath.split("/").pop()!;
    if (!INGEST_EXTENSIONS.has(extensionOf(name))) {
      return Response.json(
        { skipped: true, reason: "unsupported file type" },
        { status: 200 }
      );
    }

    const bytes = await req.arrayBuffer();
    if (bytes.byteLength === 0) {
      return Response.json({ error: "Empty body" }, { status: 400 });
    }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return Response.json(
        { skipped: true, reason: "file too large" },
        { status: 200 }
      );
    }
    // Never trust the client's hash: recompute from the received bytes. The
    // claimed hash is only an integrity check on the upload itself — a
    // mismatch means corruption in transit (or a lying client) and would
    // otherwise poison content dedupe.
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== claimedHash) {
      return Response.json(
        { error: "Body does not match ?hash — upload corrupted?" },
        { status: 400 }
      );
    }

    const dirPath = relPath.split("/").slice(0, -1).join("/");
    const meta = classify(dirPath, name);
    const itemId = await ctx.runMutation(
      internal.ingestion.upsertDiscoveredItem,
      {
        driveItemId: `local:${relPath}`,
        path: relPath,
        name,
        clientName: meta.clientName,
        fiscalYearLabel: meta.fiscalYearLabel,
        fiscalYear: meta.fiscalYear,
        docKind: meta.docKind,
        size: bytes.byteLength,
        lastModifiedAt: Number.isFinite(mtimeRaw) && mtimeRaw > 0 ? mtimeRaw : Date.now(),
        contentHash: hash,
        pairGroupKey: meta.pairGroupKey,
      }
    );
    if (itemId === null) {
      // Same content already staged (or already reviewed) — idempotent no-op.
      return Response.json({ skipped: true, reason: "unchanged" }, { status: 200 });
    }

    const storageId = await ctx.storage.store(new Blob([bytes]));
    await ctx.runMutation(internal.ingestion.attachUpload, {
      itemId,
      storageId,
    });
    return Response.json(
      { staged: true, docKind: meta.docKind, group: meta.pairGroupKey },
      { status: 200 }
    );
  }),
});

export default http;

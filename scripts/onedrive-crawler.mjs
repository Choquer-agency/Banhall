#!/usr/bin/env node
/**
 * OneDrive corpus crawler (Path B — BNH-17).
 *
 * Walks a locally synced OneDrive folder (read-only) and uploads PD /
 * transcript / supporting files to the Banhall ingestion endpoint, where they
 * are staged for admin review — nothing enters the Brain without approval.
 *
 * Security posture (keep it this way):
 *   - Node standard library only. No npm dependencies, no install step.
 *   - Strictly read-only on the crawled tree: files are opened for reading
 *     only; nothing is written, moved, renamed, or deleted. Symlinks are
 *     never followed. The only file this script writes is its own manifest
 *     log, in the current working directory.
 *   - Uploads go to exactly one HTTPS endpoint (printed at startup).
 *   - Auth key comes from the ONEDRIVE_INGEST_KEY environment variable —
 *     never from a CLI flag (flags leak into shell history / process lists).
 *   - Refuses to crawl a filesystem root, home directory, or system dir.
 *   - Idempotent: the server dedupes by content hash, so re-runs are safe.
 *
 * Usage:
 *   export ONEDRIVE_INGEST_KEY=…                # from `npx convex env get INGEST_API_KEY`
 *   node onedrive-crawler.mjs --root "~/OneDrive/Applications" \
 *     --url https://<deployment>.convex.site --dry-run
 *   # review the dry-run output, then re-run without --dry-run
 *
 * Flags:
 *   --root <dir>     Folder to crawl (the `Applications` folder). Required.
 *   --url <https://> Convex site URL. Required unless --dry-run.
 *   --dry-run        List what WOULD upload; no network calls at all.
 *   --limit <n>      Stop after n uploads (smoke tests).
 *   --manifest <f>   Log file (JSONL). Default: crawler-manifest.jsonl
 */

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

const INGEST_EXTENSIONS = new Set(["docx", "doc", "pdf", "txt", "vtt"]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const SKIP_NAMES = new Set(["desktop.ini", "thumbs.db", ".ds_store"]);
const CONCURRENCY = 3;

function parseArgs(argv) {
  const args = { dryRun: false, limit: Infinity, manifest: "crawler-manifest.jsonl" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--manifest") args.manifest = argv[++i];
    else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function shouldSkipName(name) {
  if (name.startsWith("~$")) return true; // Word lock/temp files
  if (name.startsWith(".")) return true;
  if (SKIP_NAMES.has(name.toLowerCase())) return true;
  return false;
}

/** Recursively collect candidate files. lstat only — symlinks are skipped. */
async function collect(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`  ! cannot read ${dir}: ${err.message}`);
      continue;
    }
    for (const entry of entries) {
      if (shouldSkipName(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!INGEST_EXTENSIONS.has(extensionOf(entry.name))) continue;
      out.push(full);
    }
  }
  return out.sort();
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.root) fail("--root is required");
  const root = path.resolve(
    args.root.startsWith("~") ? args.root.replace(/^~/, os.homedir()) : args.root
  );

  // Scope guard: never crawl a whole disk / home / system directory.
  const forbidden = [path.parse(root).root, os.homedir(), "/etc", "/usr", "C:\\Windows"];
  if (forbidden.some((f) => path.resolve(f) === root)) {
    fail(`Refusing to crawl ${root} — point --root at the Applications folder`);
  }
  const rootStat = await fs.lstat(root).catch(() => null);
  if (!rootStat?.isDirectory()) fail(`--root is not a directory: ${root}`);

  const key = process.env.ONEDRIVE_INGEST_KEY?.trim();
  if (!args.dryRun) {
    if (!args.url) fail("--url is required (or use --dry-run)");
    if (!args.url.startsWith("https://")) fail("--url must be https://");
    if (!key || key.length < 32) {
      fail("Set ONEDRIVE_INGEST_KEY (≥32 chars) in the environment");
    }
  }
  const endpoint = args.dryRun ? null : new URL("/ingestion/upload", args.url);

  console.log(`Crawling (read-only): ${root}`);
  if (endpoint) console.log(`Uploading to:        ${endpoint.origin}${endpoint.pathname}`);
  if (args.dryRun) console.log("DRY RUN — no network calls will be made.\n");

  const files = await collect(root);
  console.log(`Found ${files.length} candidate file(s) (.docx/.doc/.pdf/.txt/.vtt)\n`);

  const manifest = [];
  let uploaded = 0, skipped = 0, failed = 0, tooLarge = 0;

  async function processFile(full) {
    const relPath = path.relative(root, full).split(path.sep).join("/");
    const stat = await fs.stat(full);
    if (stat.size > MAX_FILE_BYTES) {
      tooLarge++;
      manifest.push({ relPath, result: "too_large", size: stat.size });
      console.log(`  – too large   ${relPath}`);
      return;
    }
    if (args.dryRun) {
      uploaded++;
      manifest.push({ relPath, result: "would_upload", size: stat.size });
      console.log(`  → would send  ${relPath}`);
      return;
    }
    const bytes = await fs.readFile(full);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const url = new URL(endpoint);
    url.searchParams.set("path", relPath);
    url.searchParams.set("hash", hash);
    url.searchParams.set("mtime", String(Math.trunc(stat.mtimeMs)));

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/octet-stream",
          },
          body: bytes,
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          failed++;
          manifest.push({ relPath, result: "rejected", status: res.status, ...json });
          console.log(`  ✗ rejected    ${relPath} (${json.error ?? res.status})`);
        } else if (json.skipped) {
          skipped++;
          manifest.push({ relPath, result: "skipped", reason: json.reason });
          console.log(`  – skipped     ${relPath} (${json.reason})`);
        } else {
          uploaded++;
          manifest.push({ relPath, result: "staged", docKind: json.docKind, hash });
          console.log(`  ✓ staged      ${relPath} [${json.docKind}]`);
        }
        return;
      } catch (err) {
        if (attempt >= 3) {
          failed++;
          manifest.push({ relPath, result: "error", error: String(err.message ?? err) });
          console.log(`  ✗ error       ${relPath} (${err.message ?? err})`);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  const queue = [...files];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0 && uploaded < args.limit) {
      const next = queue.shift();
      if (!next) return;
      await processFile(next);
    }
  });
  await Promise.all(workers);

  await fs.writeFile(
    args.manifest,
    manifest.map((m) => JSON.stringify({ at: new Date().toISOString(), ...m })).join("\n") + "\n"
  );
  console.log(
    `\nDone. ${args.dryRun ? "would upload" : "staged"}: ${uploaded}, skipped: ${skipped}, ` +
      `too large: ${tooLarge}, failed: ${failed}. Manifest: ${args.manifest}`
  );
  if (!args.dryRun) {
    console.log("Review + approve at /admin/ingestion — nothing is in the Brain yet.");
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => fail(err.stack ?? String(err)));

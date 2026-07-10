#!/usr/bin/env node
/**
 * Bulk-import curated PDs into The Brain (BNH-10 Phase 0).
 *
 * Usage:
 *   node scripts/seed-brain.mjs [path/to/seed.json] [--pending] [--dry-run]
 *
 * Defaults to data/brain-seed.json. Each entry ships to
 * internal.brain.seedPdPair via `npx convex run` (deploy-key auth, one call
 * per entry so shell arg limits never bite). Re-running is safe — the server
 * dedups by content hash.
 *
 * Entry shape (see data/brain-seed.example.json):
 *   {
 *     "title": "...",            required
 *     "industry": "...",         required — becomes the RAG namespace
 *     "content": "...",          required — extracted plain text
 *     "writerTier": 1.0,         required — 0..1 (Tracy 1.0 / 0.7 / 0.4)
 *     "docType": "pd",           default "pd"
 *     "kind": "pd_pair",         default "pd_pair"
 *     "writerName": "...",       optional
 *     "fiscalYear": 2025,        optional
 *     "scienceCode": "2.02.09", optional — validated against CRA Appendix 1
 *     "craOutcome": "approved",  optional
 *     "approve": true            default true (curated gold → straight into the Brain)
 *   }
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const fileArg = argv.find((a) => !a.startsWith("--"));
const path = resolve(fileArg ?? "data/brain-seed.json");
const forcePending = flags.has("--pending");
const dryRun = flags.has("--dry-run");

let entries;
try {
  entries = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  console.error(`Cannot read ${path}: ${e.message}`);
  console.error("Copy data/brain-seed.example.json to data/brain-seed.json and fill it in.");
  process.exit(1);
}
if (!Array.isArray(entries) || entries.length === 0) {
  console.error(`${path} must be a non-empty JSON array.`);
  process.exit(1);
}

const errors = [];
entries.forEach((e, i) => {
  for (const field of ["title", "industry", "content"]) {
    if (typeof e[field] !== "string" || !e[field].trim())
      errors.push(`entry ${i}: missing/empty "${field}"`);
  }
  if (typeof e.writerTier !== "number" || e.writerTier < 0 || e.writerTier > 1)
    errors.push(`entry ${i} ("${e.title ?? "?"}"): writerTier must be a number 0..1`);
});
if (errors.length) {
  console.error("Validation failed:\n  " + errors.join("\n  "));
  process.exit(1);
}

console.log(`Seeding ${entries.length} source(s) from ${path}${dryRun ? " (dry run)" : ""}\n`);

let ok = 0;
for (const [i, e] of entries.entries()) {
  const args = {
    kind: e.kind ?? "pd_pair",
    title: e.title,
    industry: e.industry,
    writerName: e.writerName,
    writerTier: e.writerTier,
    docType: e.docType ?? "pd",
    fiscalYear: e.fiscalYear,
    craOutcome: e.craOutcome,
    scienceCode: e.scienceCode,
    content: e.content,
    approve: forcePending ? false : e.approve ?? true,
  };
  for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k];

  const label = `[${i + 1}/${entries.length}] ${e.title} (${e.industry}, tier ${e.writerTier}, ${args.approve ? "approve" : "pending"})`;
  if (dryRun) {
    console.log(`would seed ${label} — ${e.content.length} chars`);
    continue;
  }
  try {
    const out = execFileSync(
      "npx",
      ["convex", "run", "brain:seedPdPair", JSON.stringify(args)],
      { encoding: "utf8" }
    );
    console.log(`seeded ${label} → ${out.trim()}`);
    ok++;
  } catch (err) {
    console.error(`FAILED ${label}\n${err.stderr ?? err.message}`);
  }
}

if (!dryRun) {
  console.log(`\nDone: ${ok}/${entries.length} seeded. Approved entries embed in the background (watch \`npx convex logs\`).`);
  if (ok < entries.length) process.exit(1);
}

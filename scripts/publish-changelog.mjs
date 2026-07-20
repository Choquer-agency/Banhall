#!/usr/bin/env node
/**
 * Changelog pipeline (Jul 20): summarize committed work into /changelog.
 *
 *   npm run changelog            → process all unprocessed commits on this branch
 *   npm run changelog -- --dry   → print the day groups without publishing
 *
 * Flow: read `git log` (author-date, newest first) → drop commits already
 * covered by an existing entry (watermark from convex changelog:lastProcessedCommits)
 * → group by local work day → call the Convex action once per day; Haiku
 * rewrites the commit log into a non-technical summary that writers read at
 * /changelog. Re-running a day replaces its entry (upsert by workDay).
 */
import { execFileSync } from "node:child_process";

const dry = process.argv.includes("--dry");

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function convexRun(fn, argsObj) {
  return execFileSync(
    "npx",
    ["convex", "run", fn, JSON.stringify(argsObj ?? {})],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
}

// ── Collect commits ─────────────────────────────────────────────────────────
// %ad with --date=format-local gives the author's local work day.
const SEP = "";
const raw = git(
  "log",
  "--no-merges",
  "--date=format-local:%Y-%m-%d",
  `--pretty=format:%H${SEP}%ad${SEP}%s${SEP}%b`,
  "-n",
  "400"
);

const commits = raw
  .split("")
  .map((chunk) => chunk.trim())
  .filter(Boolean)
  .map((chunk) => {
    const [hash, day, subject, body = ""] = chunk.split(SEP);
    return { hash, day, subject, body: body.trim() };
  })
  // The Co-Authored-By trailer is noise for summaries.
  .map((c) => ({
    ...c,
    body: c.body
      .split("\n")
      .filter((l) => !/^co-authored-by:/i.test(l.trim()))
      .join("\n")
      .trim(),
  }));

// ── Watermark ───────────────────────────────────────────────────────────────
let processed = new Set();
try {
  const out = convexRun("changelog:lastProcessedCommits", {});
  processed = new Set(JSON.parse(out));
} catch {
  console.warn("Could not read watermark (first run?) — processing all commits.");
}

const fresh = commits.filter((c) => !processed.has(c.hash));
if (fresh.length === 0) {
  console.log("Nothing new — every commit is already summarized.");
  process.exit(0);
}

// ── Group by work day ───────────────────────────────────────────────────────
const byDay = new Map();
for (const c of fresh) {
  if (!byDay.has(c.day)) byDay.set(c.day, []);
  byDay.get(c.day).push({ hash: c.hash, subject: c.subject, ...(c.body ? { body: c.body } : {}) });
}

const days = [...byDay.keys()].sort(); // oldest first so entries publish in order

console.log(`Processing ${fresh.length} commit(s) across ${days.length} day(s):`);
for (const day of days) {
  console.log(`  ${day} — ${byDay.get(day).length} commit(s)`);
  if (dry) {
    for (const c of byDay.get(day)) console.log(`      ${c.hash.slice(0, 8)} ${c.subject}`);
  }
}
if (dry) process.exit(0);

// ── Publish ─────────────────────────────────────────────────────────────────
let failures = 0;
for (const day of days) {
  try {
    const out = convexRun("ai/changelogPipeline:publishDay", {
      workDay: day,
      commits: byDay.get(day),
    });
    const result = JSON.parse(out);
    console.log(
      result.skipped
        ? `  ${day}: skipped (no commits)`
        : `  ${day}: “${result.title}” (${result.kind})`
    );
  } catch (err) {
    failures += 1;
    console.error(`  ${day}: FAILED — ${err.message ?? err}`);
  }
}
process.exit(failures > 0 ? 1 : 0);

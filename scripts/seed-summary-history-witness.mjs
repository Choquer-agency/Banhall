#!/usr/bin/env node
// Real-SvelteKit-router witness for the Seed Summary history transitions and
// the concurrent-tab draft schedule (stories 5–6, A2 / A7 / R3-11 / R4-16 /
// R5-10 / R5-11 / R5-12 / R5-13 / R5-14).
//
// What it proves, and what it does not:
// - PRODUCTION ROUTER: the page is served by the SvelteKit dev server from
//   `vite.integration.config.ts`, so the hosts' `pushState` calls create real
//   history entries through SvelteKit's own shallow routing, and a real
//   Chromium traverses them with Back/Forward. The canonical component suite
//   (which stubs `$app/navigation` and dispatches synthetic `popstate`)
//   remains separate and unchanged.
// - SEPARATE PAGES SHARING STORAGE: the concurrent-tab journeys open two real
//   pages of one browser context (one origin, one localStorage) and drive a
//   controlled overlapping write schedule: an init script records every
//   storage write and holds one page's draft-key writes for a while, so the
//   other page's write demonstrably lands in between. The app code is not
//   touched; the report records the schedule and each page's written keys.
//   A discard is exercised while the other tab's independent draft still
//   exists, and that draft's exact wording is checked in storage and after
//   recreation.
// - MOCKED BACKEND TRANSPORT: `convex-svelte` is the component-test stub, seeded
//   through `window.__banhallConvexStub`; no Convex deployment and no live
//   model are involved. This is not an authenticated live-model run.
// - OUTPUT OWNERSHIP: every run reserves a fresh output location exclusively
//   (a non-recursive mkdir) before any log, screenshot or report is opened, so
//   repeated, colliding or simultaneous runs never overwrite prior evidence.
// - SERVER OWNERSHIP: readiness is accepted only from the dev server this
//   invocation spawned (it answers `/__seed-witness/ready` with this run's
//   token), never from whatever else holds the port. The owned server is the
//   whole process group it leads: an unexpected exit during the run fails the
//   run, and cleanup assesses and terminates the group independently of the
//   direct child's exit, with bounded SIGTERM → SIGKILL escalation. A failing
//   log stream ends the run through the same failure and cleanup path.
//
// Usage: node scripts/seed-summary-history-witness.mjs [--out <dir>] [--port <n>] [--headed]
//        [--startup-timeout-ms <n>] [--reserve-only] [--server-command <json array>]
//        [--inject-log-failure] [--stand-in-journey-ms <n>]
// `--out` names either a fresh directory (reserved exclusively) or an existing
// directory that receives a freshly reserved run directory inside it; a path
// that exists and is not a directory is refused (exit 2). Without `--out`, a
// run directory is reserved under SEED_WITNESS_EVIDENCE_ROOT (default: the
// loop-05 evidence folder). `--port`, `--startup-timeout-ms` and
// `--stand-in-journey-ms` must be positive integers (the port at most 65535);
// anything else is refused with a diagnostic before anything is reserved or
// spawned (exit 2). `--reserve-only`, `--server-command`, `--inject-log-failure`
// and `--stand-in-journey-ms` exist for the harness's own tests
// (src/lib/test/seedSummaryHistoryWitness.harness.test.ts), which run under
// `npm test` and therefore never launch a browser: `--stand-in-journey-ms`
// replaces the browser journeys with a hold of that length, raced against the
// owned server exactly like every journey. A stand-in run proves failure
// routing only; it is never a witness and never exits 0.
// Exit code 0 only when every assertion in both hosts passed in a real
// browser; the JSON report, the dev-server log and screenshots land in the
// reserved directory.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
// A named option with no value following it yields "" (present, empty), so a
// trailing `--port` is refused by validation instead of silently defaulting.
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? "") : fallback;
};
const flag = (name) => args.includes(name);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

// ---------------------------------------------------------------------------
// Option validation (R5-13): nonfinite, nonpositive, fractional, signed or
// otherwise non-numeric timeouts and ports are refused explicitly before any
// reservation or spawn, so the startup bound can never be defeated.
function positiveInteger(name, raw) {
  const invalid = () => new Error(`${name} must be a positive integer, received ${JSON.stringify(raw)}`);
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw invalid();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw invalid();
  return value;
}

function serverCommandOption(raw) {
  if (raw === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--server-command must be a JSON array of strings: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== "string" || part.length === 0)) {
    throw new Error("--server-command must be a non-empty JSON array of non-empty strings");
  }
  return parsed;
}

let port;
let startupTimeoutMs;
let serverCommandOverride;
let standInJourneyMs;
try {
  port = positiveInteger("--port", option("--port", "3107"));
  if (port > 65535) throw new Error(`--port must be at most 65535, received ${port}`);
  startupTimeoutMs = positiveInteger("--startup-timeout-ms", option("--startup-timeout-ms", "180000"));
  // Harness self-tests only: a JSON array that replaces the dev-server command.
  serverCommandOverride = serverCommandOption(option("--server-command", null));
  // Harness self-tests only: a browser-free hold in place of the journeys.
  const standIn = option("--stand-in-journey-ms", null);
  standInJourneyMs = standIn === null ? null : positiveInteger("--stand-in-journey-ms", standIn);
} catch (error) {
  console.error(`seed-summary-history-witness: ${error.message}`);
  process.exit(2);
}
const headed = flag("--headed");
const reserveOnly = flag("--reserve-only");
// Harness self-tests only: fails the dev-server log stream once the owned
// server is ready, to prove the failure reaches cleanup and the report.
const injectLogFailure = flag("--inject-log-failure");
const serverCommand = serverCommandOverride ?? [
  join(root, "node_modules/.bin/vite"),
  "dev", "--config", "vite.integration.config.ts",
  "--port", String(port), "--strictPort", "--host", "127.0.0.1",
];
const evidenceRoot = resolve(
  root,
  process.env.SEED_WITNESS_EVIDENCE_ROOT || ".git-local-evidence/stories5-6-20260922/loop-05"
);
const base = `http://127.0.0.1:${port}`;
// This invocation's identity (R5-11): only a server answering the readiness
// endpoint with this token is this run's server.
const runToken = randomBytes(12).toString("hex");
const READY_PATH = "/__seed-witness/ready";

// ---------------------------------------------------------------------------
// Exclusive output reservation (R4-13): the directory itself is the lock. A
// non-recursive mkdir either creates a fresh directory or refuses with EEXIST,
// so two simultaneous runs can never share a location, and nothing is opened
// before the reservation succeeded.
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.(\d+)Z$/, "$1Z");
const runName = () => `router-witness-${stamp()}-${process.pid}-${randomBytes(3).toString("hex")}`;

function reserveDirectory(path) {
  mkdirSync(path);
  return path;
}

function reserveOutput(explicit) {
  if (!explicit) {
    mkdirSync(evidenceRoot, { recursive: true });
    return { out: reserveDirectory(join(evidenceRoot, runName())), reservation: "default" };
  }
  const target = resolve(root, explicit);
  mkdirSync(dirname(target), { recursive: true });
  try {
    return { out: reserveDirectory(target), reservation: "explicit" };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if (!statSync(target).isDirectory()) {
    throw new Error(`refusing --out ${target}: it exists and is not a directory`);
  }
  // An existing directory is never written into directly: a fresh run
  // directory inside it is reserved, so its prior artifacts stay untouched.
  return { out: reserveDirectory(join(target, runName())), reservation: "run-directory" };
}

let reservation;
try {
  reservation = reserveOutput(option("--out", null));
} catch (error) {
  console.error(`seed-summary-history-witness: ${error.message}`);
  process.exit(2);
}
const out = reservation.out;
writeFileSync(
  join(out, "reservation.json"),
  JSON.stringify({ at: new Date().toISOString(), out, reservation: reservation.reservation, pid: process.pid, args }, null, 2) + "\n"
);
if (reserveOnly) {
  console.log(JSON.stringify({ out, reservation: reservation.reservation }));
  process.exit(0);
}

const env = {
  ...process.env,
  PUBLIC_CONVEX_URL: process.env.PUBLIC_CONVEX_URL || "https://placeholder.convex.cloud",
  PUBLIC_CONVEX_SITE_URL: process.env.PUBLIC_CONVEX_SITE_URL || "https://placeholder.convex.site",
  SEED_WITNESS_RUN_TOKEN: runToken,
};

const budget = {
  limit: 1_000_000,
  estimatedBytesRead: 0,
  reservedDocumentBytes: 0,
  rangesRead: 0,
  rangeLimit: 100,
  exhausted: false,
};
const frozenSettings = { lengthTarget: "standard", modelId: "claude-test", writerProfile: null };
const project = {
  _id: "project-seed-host",
  title: "Adaptive controller",
  sredTitle: "Adaptive control under load",
  clientName: "Acme Labs",
  writer: "Wren Writer",
  interviewer: "",
  interviewees: [],
  tagIds: [],
  mode: "generate",
  status: "generating",
  workflowStage: "drafting",
  industry: "manufacturing",
  scienceCode: "1.02.01",
  fiscalYearEnd: Date.UTC(2025, 11, 31),
  createdBy: "writer-1",
  ownerId: "writer-1",
  createdAt: 1,
  updatedAt: 1,
  shareToken: "seed-host-token",
  activeGenerationId: "generation-seed-host",
};
const user = { _id: "writer-1", role: "writer", firstName: "Wren", lastName: "Writer", email: "writer@example.test" };
const generationId = "generation-seed-host";
const seedItem = (seedId, bullet) => ({
  seedId,
  batchId: "batch-host-1",
  roleId: "company_context",
  bullets: [bullet],
  originalBullets: [bullet],
  tags: ["technical"],
  support: "source_supported",
  originalSupport: "source_supported",
  selected: true,
  edited: false,
  revisionOfSeedId: null,
  feedbackRequestId: null,
  uncertaintySeedId: null,
  experimentSeedIds: [],
  provenance: [],
  provenanceTruncated: false,
  outdated: null,
});
const workspaceItems = [
  { seedId: "seed-host-1", bullet: "Server workspace wording." },
  { seedId: "seed-host-2", bullet: "Second workspace wording." },
];
const summaryItems = [
  { seedId: "seed-summary-0", roleId: "company_context", bullet: "Server workspace wording." },
  { seedId: "seed-summary-1", roleId: "goal_problem", bullet: "Second Summary wording." },
];
const summaryPage = (owner, summaryVersionId, frozen, entries) => ({
  page: entries.map((entry) => ({
    kind: "selection",
    seedId: entry.seedId,
    roleId: entry.roleId,
    subsectionKind: "standard",
    bullets: [entry.bullet],
    support: "source_supported",
    tags: ["technical"],
    uncertaintySeedId: null,
    experimentSeedIds: [],
  })),
  skippedRoleIds: [],
  isDone: true,
  continueCursor: "done",
  partial: false,
  frozen,
  generationId: owner,
  summaryVersionId,
  seedStageVersion: 4,
  settings: frozenSettings,
  budget,
});
const emptyLists = [
  "documents:listDocuments",
  "comments:listComments",
  "pdReviews:listPdReviewEvents",
  "chatV2:listThreads",
  "chatV2:listProposals",
  "research:listSessions",
  "uploadAttempts:listUploadAttempts",
  "snapshots:listSnapshots",
  "tags:listTags",
  "transcripts:listTranscripts",
];

function commonQueries() {
  const queries = {
    "projects:getProject": project,
    "projects:getProjectEditAccess": { canEditDetails: true },
    "users:getCurrentUser": user,
    "pdReviews:getLatestPdReview": null,
    "reportViews:getViewSummary": null,
    "workspaceRollout:getAccess": { available: true },
  };
  for (const name of emptyLists) queries[name] = [];
  return queries;
}

/** The seeding phase: workspace ↔ live Summary, with one or two Seeds. */
function seedingFixture(itemCount = 1) {
  return {
    queries: {
      ...commonQueries(),
      "reports:getLatestReport": null,
      "generations:getLatestGeneration": {
        _id: generationId,
        status: "awaiting_input",
        candidateMode: "iterative",
        gatedWorkflow: "seeds",
        seedPhase: "seeding",
        seedStageVersion: 4,
        summaryVersionId: null,
        briefVersionId: "brief-seed-host",
        seedCanEdit: true,
        candidatesDone: 0,
        candidatesFailed: 0,
        totalCandidates: 1,
      },
      "seeds:getSubsection": {
        generationId,
        roleId: "company_context",
        state: "in_progress",
        stale: false,
        staleReason: null,
        items: workspaceItems.slice(0, itemCount).map((entry) => seedItem(entry.seedId, entry.bullet)),
        feedbackGroups: [],
        shownBatchId: null,
        pendingBatchId: null,
        approvalChallenge: null,
        seedStageVersion: 4,
        truncated: false,
        budget,
      },
      "seeds:getSummary": summaryPage(generationId, null, false, summaryItems.slice(0, itemCount)),
    },
    outline: {
      generationId,
      readiness: { ready: true, complete: true, blockingRoleIds: [] },
      usage: { requests: 1, notice: false },
      seedStageVersion: 4,
      truncated: false,
      budget,
      canEdit: true,
      workflow: "seeds",
      frozen: { briefVersionId: "brief-seed-host", summaryVersionId: null, ...frozenSettings },
    },
  };
}

/** A completed report owned by a signed-off Seed generation. */
function reportFixture() {
  return {
    queries: {
      ...commonQueries(),
      "reports:getLatestReport": {
        _id: "report-seed-host",
        projectId: "project-seed-host",
        generationId: "generation-report-owner",
        content: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Completed Seed report." }] }],
        }),
        version: 1,
        revisionNumber: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      "generations:getLatestGeneration": {
        _id: "generation-report-owner",
        status: "completed",
        candidateMode: "iterative",
        gatedWorkflow: "seeds",
        seedPhase: "completed",
        summaryVersionId: "summary-report-owner",
        seedCanEdit: true,
      },
      "generations:getGenerationSeedView": {
        _id: "generation-report-owner",
        gatedWorkflow: "seeds",
        seedPhase: "completed",
        summaryVersionId: "summary-report-owner",
        seedCanEdit: true,
      },
      "seeds:getSummary": summaryPage("generation-report-owner", "summary-report-owner", true, [
        { seedId: "seed-frozen-0", roleId: "company_context", bullet: "Frozen report-owned Summary item." },
      ]),
      "chatV2:listMessages": { streams: { kind: "list", messages: [] } },
    },
    outline: null,
  };
}

const results = [];
let failures = 0;
function check(host, name, ok, detail) {
  results.push({ host, name, ok: !!ok, detail: detail === undefined ? null : detail });
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} [${host}] ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

// ---------------------------------------------------------------------------
// Dev server ownership (R4-12 / R4-15 / R5-10 / R5-11 / R5-14). The child is
// registered the moment it is spawned; every readiness request is bounded by
// the remaining startup budget and accepted only with this run's token; the
// owned process group is assessed and terminated on its own lifetime; an
// unexpected exit or a failing log stream rejects `ownedFailure`, which every
// phase of the run races against.
let serverProcess = null;

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    // EPERM: something in the group exists but cannot be signalled from here.
    return error.code === "EPERM";
  }
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function waitForGroupExit(pid, budgetMs) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (!groupAlive(pid)) return true;
    if (Date.now() >= deadline) return !groupAlive(pid);
    await sleep(100);
  }
}

/** Stops the owned server: the whole process group it leads, whether or not
 * the direct child already exited, with bounded SIGTERM → SIGKILL escalation,
 * then the log stream (bounded, even after a stream failure). Every caller
 * (the run's cleanup, a startup failure, a SIGINT/SIGTERM arriving meanwhile)
 * awaits the same single cleanup, so none can exit before it completes. */
function stopServer() {
  const server = serverProcess;
  if (!server) return Promise.resolve();
  server.stopping ??= stopOwnedServer(server);
  return server.stopping;
}

async function stopOwnedServer(server) {
  server.stopped = true;
  const { child, pid } = server;
  let group = "absent";
  if (pid) {
    if (groupAlive(pid)) {
      signalGroup(pid, "SIGTERM");
      if (await waitForGroupExit(pid, 3000)) {
        group = "terminated";
      } else {
        signalGroup(pid, "SIGKILL");
        group = (await waitForGroupExit(pid, 3000)) ? "killed" : "survived";
      }
    } else {
      group = "exited";
    }
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    // The direct child's exit event may still be in flight after the group
    // is gone; give it a bounded moment so the report can name the exit.
    await Promise.race([server.exited, sleep(1000)]);
  }
  await server.closeLog();
  server.exit = child ? { code: child.exitCode, signal: child.signalCode } : null;
  server.group = group;
}

/** Readiness belongs to this invocation: the server must answer the witness
 * endpoint with this run's token. Any other answer, from any other service on
 * the port, is not readiness. */
async function probe(timeoutMs) {
  try {
    const response = await fetch(`${base}${READY_PATH}`, {
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body !== null && typeof body === "object" && body.token === runToken;
  } catch {
    return false;
  }
}

async function startServer() {
  const logPath = join(out, "dev-server.log");
  const log = createWriteStream(logPath);
  const logClosed = new Promise((resolveClose) => log.once("close", resolveClose));
  // Every failure of the owned run rejects this promise: a spawn error, the
  // child exiting while it is owned (early, or later during the journeys),
  // or the log stream failing. Nothing awaits it alone; every phase races it.
  let rejectOwned;
  const ownedFailure = new Promise((_resolveOwned, reject) => {
    rejectOwned = reject;
  });
  ownedFailure.catch(() => {});
  const server = {
    pid: null,
    child: null,
    log,
    stopped: false,
    stopping: null,
    ready: false,
    exit: null,
    group: null,
    unexpectedExit: null,
    logFailure: null,
    ownedFailure,
    exited: Promise.resolve(),
    closeLog: async () => {
      if (!log.destroyed && !log.writableEnded) log.end();
      // A destroyed (failed) stream has closed or will not: never hang on it.
      await Promise.race([logClosed, sleep(2000)]);
    },
  };
  serverProcess = server;
  log.on("error", (error) => {
    server.logFailure = error.message;
    rejectOwned(new Error(`dev-server log stream failed: ${error.message}`));
  });
  let child;
  try {
    child = spawn(serverCommand[0], serverCommand.slice(1), {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
  } catch (error) {
    await stopServer();
    throw new Error(`dev server could not be spawned: ${error.message}`);
  }
  server.child = child;
  server.pid = child.pid ?? null;
  server.exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  // Spawn errors (a missing binary) and exits arrive asynchronously; both are
  // observed through the owned-failure promise, never as an unhandled
  // rejection. An exit requested by cleanup is not a failure.
  child.once("error", (error) => rejectOwned(new Error(`dev server could not be spawned: ${error.message}`)));
  child.once("exit", (code, signal) => {
    if (server.stopped) return;
    server.unexpectedExit = { code, signal, at: new Date().toISOString(), afterReady: server.ready };
    rejectOwned(new Error(
      server.ready
        ? `dev server exited unexpectedly during the run (${code ?? signal}); see ${logPath}`
        : `dev server exited early (${code ?? signal}); see ${logPath}`
    ));
  });
  const deadline = Date.now() + startupTimeoutMs;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`dev server did not become ready within ${startupTimeoutMs} ms`);
      // Each readiness request is bounded by the remaining startup budget, so a
      // connection that is accepted but never answered cannot outlast it.
      const ready = await Promise.race([probe(Math.min(remaining, 5000)), ownedFailure]);
      if (ready) {
        server.ready = true;
        return;
      }
      const pause = Math.min(500, deadline - Date.now());
      if (pause > 0) await Promise.race([sleep(pause), ownedFailure]);
    }
  } catch (error) {
    await stopServer();
    throw error;
  }
}

/** Races one phase of the run against the owned server's failure, so an
 * unexpected exit or a failed log ends the run instead of the journeys
 * continuing against a server that is gone. The losing phase is drained. */
function owned(phase) {
  phase.catch(() => {});
  return Promise.race([phase, serverProcess.ownedFailure]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stopServer().finally(() => process.exit(130));
  });
}

/** Seeds the stub through the window hook; repeats after any optimizer reload. */
async function openAndSeed(page, url, fixture, readySelector) {
  let loads = 0;
  page.on("load", () => { loads += 1; });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const loadsBefore = loads;
    await page.waitForFunction(() => !!window.__banhallConvexStub, null, { timeout: 60_000 });
    await page.evaluate((seed) => {
      const stub = window.__banhallConvexStub;
      for (const [name, data] of Object.entries(seed.queries)) stub.__setQueryData(name, data);
      if (seed.outline) {
        stub.__setQueryData("seeds:getOutline", {
          ...seed.outline,
          rows: stub.PD_SUBSECTIONS.map((definition) => ({
            ...definition,
            state: "in_progress",
            stale: false,
            staleReason: null,
            outdated: false,
            selectedCount: 0,
            selectedWordCount: 0,
            countsComplete: true,
            previewLines: [],
            pendingBatchId: null,
            shownBatchId: null,
          })),
        });
      }
    }, fixture);
    try {
      await page.waitForSelector(readySelector, { state: "visible", timeout: 20_000 });
      return;
    } catch {
      if (loads === loadsBefore) {
        // No reload happened; give the lazy host one more chance after a reload.
        await page.reload({ waitUntil: "domcontentloaded" });
      }
    }
  }
  throw new Error(`${readySelector} did not render within the budget at ${url}`);
}

const hostUrl = (host) =>
  host === "current" ? `${base}/project/project-seed-host?workspace=current` : `${base}/project/project-seed-host`;

/** Counts page loads the journey did not ask for (a dev-server optimizer
 * reload, for instance), which would reset the stub and the in-memory drafts
 * behind the journey's back; each journey names them in an explicit check. */
function trackReloads(page) {
  let count = 0;
  page.on("load", () => { count += 1; });
  return {
    expected() { count = 0; },
    unexpected() { return count; },
  };
}
const view = (page) => new URL(page.url()).searchParams.get("view");
const focusedId = (page) => page.evaluate(() => document.activeElement?.id ?? "");
async function waitFocus(page, id) {
  try {
    await page.waitForFunction((expected) => document.activeElement?.id === expected, id, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
async function shot(page, host, name) {
  await page.screenshot({ path: join(out, `${host}-${name}.png`), fullPage: false });
}

async function seedingJourney(browser, host) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const url = hostUrl(host);
  const reloads = trackReloads(page);
  await openAndSeed(page, url, seedingFixture(), '[aria-label="Seed workspace"]');
  reloads.expected();
  check(host, "seeding: workspace rendered through the production router", true, page.url());

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Bullet 1" }).fill("Workspace draft survives the Summary.");

  // Keyboard entry: the host's SvelteKit pushState creates the Summary entry.
  await page.locator("#seed-review-summary-trigger").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Summary review", exact: true }).waitFor({ state: "visible" });
  check(host, "seeding: pushState wrote ?view=summary", view(page) === "summary", page.url());
  check(host, "seeding: entry focused the Summary heading", await waitFocus(page, "summary-review-title"), await focusedId(page));
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Bullet 1" }).fill("Summary draft survives the workspace.");
  await shot(page, host, "01-summary-entered");

  // Real browser Back through SvelteKit's history entry.
  await page.goBack();
  await page.locator('[aria-label="Seed workspace"]').waitFor({ state: "visible" });
  check(host, "seeding: Back restored the workspace URL", view(page) === null, page.url());
  check(host, "seeding: Back focused the recreated Review Summary trigger", await waitFocus(page, "seed-review-summary-trigger"), await focusedId(page));
  check(
    host,
    "seeding: Back kept the workspace draft",
    (await page.getByRole("textbox", { name: "Bullet 1" }).inputValue()) === "Workspace draft survives the Summary.",
  );
  await shot(page, host, "02-back-to-workspace");

  // Real browser Forward.
  await page.goForward();
  await page.getByRole("heading", { name: "Summary review", exact: true }).waitFor({ state: "visible" });
  check(host, "seeding: Forward restored ?view=summary", view(page) === "summary", page.url());
  check(host, "seeding: Forward focused the Summary heading", await waitFocus(page, "summary-review-title"), await focusedId(page));
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  check(
    host,
    "seeding: Forward kept the Summary draft",
    (await page.getByRole("textbox", { name: "Bullet 1" }).inputValue()) === "Summary draft survives the workspace.",
  );
  await shot(page, host, "03-forward-to-summary");

  // The in-page Back action makes a third entry; history Back/Forward still
  // move between the Summary and workspace with the same transitions.
  await page.getByRole("button", { name: "Back to plan", exact: true }).click();
  await page.locator('[aria-label="Seed workspace"]').waitFor({ state: "visible" });
  check(host, "seeding: Back to plan action removed ?view", view(page) === null, page.url());
  check(host, "seeding: Back to plan action focused the trigger", await waitFocus(page, "seed-review-summary-trigger"), await focusedId(page));
  await page.goBack();
  await page.getByRole("heading", { name: "Summary review", exact: true }).waitFor({ state: "visible" });
  check(host, "seeding: Back after the action reopened the Summary entry", view(page) === "summary" && (await waitFocus(page, "summary-review-title")), page.url());
  await page.goForward();
  await page.locator('[aria-label="Seed workspace"]').waitFor({ state: "visible" });
  check(host, "seeding: Forward after the action returned to the workspace entry", view(page) === null && (await waitFocus(page, "seed-review-summary-trigger")), page.url());
  check(
    host,
    "seeding: drafts survived every traversal",
    (await page.getByRole("textbox", { name: "Bullet 1" }).inputValue()) === "Workspace draft survives the Summary.",
  );
  check(host, "seeding: no page errors", pageErrors.length === 0, pageErrors);
  check(host, "seeding: no unexpected page reload", reloads.unexpected() === 0, { reloads: reloads.unexpected() });
  await context.close();
}

async function reportJourney(browser, host) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const url = hostUrl(host);
  const reloads = trackReloads(page);
  await openAndSeed(page, url, reportFixture(), "#seed-signed-off-summary-trigger");
  reloads.expected();
  check(host, "report: completed Seed report rendered with its Signed-off Summary trigger", true, page.url());

  await page.locator("#seed-signed-off-summary-trigger").focus();
  await page.keyboard.press("Enter");
  await page.getByText("Frozen report-owned Summary item.", { exact: true }).waitFor({ state: "visible" });
  check(host, "report: pushState wrote ?view=summary", view(page) === "summary", page.url());
  check(host, "report: entry focused the Summary heading", await waitFocus(page, "summary-review-title"), await focusedId(page));
  await shot(page, host, "04-frozen-summary");

  await page.goBack();
  await page.getByText("Completed Seed report.", { exact: true }).waitFor({ state: "visible" });
  check(host, "report: Back returned to the report URL", view(page) === null, page.url());
  check(host, "report: Back focused the Signed-off Summary trigger", await waitFocus(page, "seed-signed-off-summary-trigger"), await focusedId(page));
  await shot(page, host, "05-back-to-report");

  await page.goForward();
  await page.getByText("Frozen report-owned Summary item.", { exact: true }).waitFor({ state: "visible" });
  check(host, "report: Forward reopened the frozen Summary", view(page) === "summary", page.url());
  check(host, "report: Forward focused the Summary heading", await waitFocus(page, "summary-review-title"), await focusedId(page));
  check(host, "report: no page errors", pageErrors.length === 0, pageErrors);
  check(host, "report: no unexpected page reload", reloads.unexpected() === 0, { reloads: reloads.unexpected() });
  await context.close();
}

// ---------------------------------------------------------------------------
// Concurrent independent drafts in separate pages sharing storage (A2 / R4-16 / R5-12).
//
// Installed into every page of the concurrency context before any script runs:
// it records every localStorage write and removal and, while a page carries
// `window.__banhallStorageHold`, spins that page's main thread inside each
// draft-key write for the given time. Holding page A's write while page B
// writes its own item is the controlled overlapping schedule: with a shared
// collection written back as a whole, A's later write would replace B's item;
// with one record per item, both survive. The app code is unchanged.
const STORAGE_HOLD_MS = 800;
const storageInstrumentation = `(() => {
  const log = [];
  window.__banhallStorageLog = log;
  const spin = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
  for (const op of ["setItem", "removeItem"]) {
    const original = Storage.prototype[op];
    Storage.prototype[op] = function (key, ...rest) {
      const hold = window.__banhallStorageHold;
      const entry = { op, key, heldFrom: null, wroteAt: null };
      if (this === window.localStorage && hold && typeof key === "string" && key.startsWith(hold.prefix)) {
        entry.heldFrom = Date.now();
        spin(hold.ms);
      }
      const result = original.call(this, key, ...rest);
      entry.wroteAt = Date.now();
      log.push(entry);
      return result;
    };
  }
})();`;

const surfaces = {
  workspace: {
    prefix: `seeds.draft:${user._id}:${generationId}:`,
    itemKeys: workspaceItems.map((entry) => `seeds.draft:${user._id}:${generationId}:${entry.seedId}`),
    serverWording: workspaceItems.map((entry) => entry.bullet),
    draftText: (record) => record?.edit?.bulletOne,
  },
  summary: {
    prefix: `seeds.summaryDraft:${user._id}:${generationId}:live:`,
    itemKeys: summaryItems.map((entry) => `seeds.summaryDraft:${user._id}:${generationId}:live:${entry.seedId}`),
    serverWording: summaryItems.map((entry) => entry.bullet),
    draftText: (record) => record?.bulletOne,
  },
};

async function enterSummary(page) {
  await page.locator("#seed-review-summary-trigger").click();
  await page.getByRole("heading", { name: "Summary review", exact: true }).waitFor({ state: "visible" });
  await page.getByText(summaryItems[1].bullet, { exact: true }).waitFor({ state: "visible" });
}

async function concurrentTabsJourney(browser, host, surface) {
  const label = `${surface} tabs`;
  const { prefix, itemKeys, serverWording, draftText } = surfaces[surface];
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(storageInstrumentation);
  const url = hostUrl(host);
  const fixture = seedingFixture(2);
  const pageErrors = [];
  const reloadTrackers = new Map();
  const reopen = async (page) => {
    await openAndSeed(page, url, fixture, '[aria-label="Seed workspace"]');
    if (surface === "summary") await enterSummary(page);
    reloadTrackers.get(page)?.expected();
  };
  const open = async () => {
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    reloadTrackers.set(page, trackReloads(page));
    await reopen(page);
    return page;
  };
  const unexpectedReloads = () => [...reloadTrackers.values()].reduce((sum, tracker) => sum + tracker.unexpected(), 0);
  /** Storage as a fresh page of the same origin sees it, decoded per item. */
  const storage = async () => {
    const probePage = await context.newPage();
    await probePage.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    const entries = await probePage.evaluate(
      (keyPrefix) =>
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith(keyPrefix))
          .map(([key, value]) => [key, JSON.parse(value)]),
      prefix
    );
    await probePage.close();
    return Object.fromEntries(entries);
  };
  const setHold = (page, active) =>
    page.evaluate((hold) => { window.__banhallStorageHold = hold; }, active ? { prefix, ms: STORAGE_HOLD_MS } : null);
  const writesSince = async (page, since) =>
    (await page.evaluate(() => window.__banhallStorageLog)).filter((entry) => entry.key.startsWith(prefix) && entry.wroteAt >= since);
  const overlapped = (heldWrites, otherWrites) =>
    heldWrites.some((held) => otherWrites.some((other) => other.wroteAt > held.heldFrom && other.wroteAt < held.wroteAt));
  const ownKeysOnly = (writes, key) => writes.length > 0 && writes.every((entry) => entry.key === key);
  // A hydrated workspace draft keeps its card's editor open, so a workspace
  // tab can hold several editors at once: each edit is scoped to its own card.
  // Summary Review shows one editor at a time.
  const editItem = async (page, index, wording) => {
    if (surface === "workspace") {
      const card = page.locator(`[data-seed-id="${workspaceItems[index].seedId}"]`);
      await card.getByRole("button", { name: "Edit", exact: true }).click();
      await card.getByRole("textbox", { name: "Bullet 1" }).fill(wording);
      return;
    }
    await page.getByRole("button", { name: "Edit", exact: true }).nth(index).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill(wording);
  };

  const tabA = await open();
  const tabB = await open();

  // The two pages must run independently for an overlap to be possible at all:
  // page B answers while page A's main thread is deliberately busy.
  const spin = tabA.evaluate(() => { const end = Date.now() + 1500; while (Date.now() < end) {} return true; });
  const asked = Date.now();
  await tabB.evaluate(() => true);
  const latencyMs = Date.now() - asked;
  await spin;
  check(host, `${label}: two pages run independently (B answered while A was busy)`, latencyMs < 750, { latencyMs });

  // Overlapping schedule 1: A's draft writes are held; B writes its own item meanwhile.
  const wordingA = `Tab A wording for the ${surface}.`;
  const wordingB = `Tab B wording for the ${surface}.`;
  const phaseOne = Date.now();
  await setHold(tabA, true);
  const editA = editItem(tabA, 0, wordingA);
  await sleep(150);
  const editB = editItem(tabB, 1, wordingB);
  await Promise.all([editA, editB]);
  await setHold(tabA, false);
  const heldA = (await writesSince(tabA, phaseOne)).filter((entry) => entry.heldFrom !== null);
  const writesB = await writesSince(tabB, phaseOne);
  check(host, `${label}: tab B's write landed while tab A's write was held`, overlapped(heldA, writesB), {
    heldA: heldA.map((entry) => ({ op: entry.op, heldFrom: entry.heldFrom, wroteAt: entry.wroteAt })),
    writesB: writesB.map((entry) => ({ op: entry.op, wroteAt: entry.wroteAt })),
  });
  check(host, `${label}: each tab wrote only its own item key`, ownKeysOnly(heldA, itemKeys[0]) && ownKeysOnly(writesB, itemKeys[1]), {
    keysA: [...new Set(heldA.map((entry) => entry.key))],
    keysB: [...new Set(writesB.map((entry) => entry.key))],
  });
  const afterOverlap = await storage();
  check(
    host,
    `${label}: both independent drafts survived the overlapping writes`,
    draftText(afterOverlap[itemKeys[0]]) === wordingA && draftText(afterOverlap[itemKeys[1]]) === wordingB,
    Object.keys(afterOverlap)
  );
  await shot(tabA, host, `06-${surface}-tab-a-overlap`);
  await shot(tabB, host, `07-${surface}-tab-b-overlap`);

  // Recreation: both tabs reload and hydrate both drafts.
  await reopen(tabA);
  await reopen(tabB);
  const hydrated = async (page) => {
    if (surface === "workspace") {
      const boxes = page.getByRole("textbox", { name: "Bullet 1" });
      return [await boxes.nth(0).inputValue(), await boxes.nth(1).inputValue()];
    }
    // Summary drafts open on Edit; opening the other item keeps the first draft.
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const first = await page.getByRole("textbox", { name: "Bullet 1" }).inputValue();
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const second = await page.getByRole("textbox", { name: "Bullet 1" }).inputValue();
    return [first, second];
  };
  const shownA = await hydrated(tabA);
  const shownB = await hydrated(tabB);
  check(
    host,
    `${label}: recreation hydrated both drafts in both tabs`,
    shownA[0] === wordingA && shownA[1] === wordingB && shownB[0] === wordingA && shownB[1] === wordingB,
    { shownA, shownB }
  );
  await shot(tabA, host, `08-${surface}-tab-a-recreated`);

  // Overlapping schedule 2: A saves its item (its removal is held) while B
  // keeps typing its own item.
  const phaseTwo = Date.now();
  await setHold(tabA, true);
  const saveA = (async () => {
    if (surface === "summary") await tabA.getByRole("button", { name: "Edit", exact: true }).first().click();
    await tabA.getByRole("button", { name: "Save wording", exact: true }).first().click();
  })();
  await sleep(150);
  const moreB = `${wordingB} More.`;
  const typeB = tabB.getByRole("textbox", { name: "Bullet 1" }).last().fill(moreB);
  await Promise.all([saveA, typeB]);
  await setHold(tabA, false);
  const heldSaveA = (await writesSince(tabA, phaseTwo)).filter((entry) => entry.heldFrom !== null);
  const laterWritesB = await writesSince(tabB, phaseTwo);
  check(host, `${label}: tab B's write landed while tab A's save was held`, overlapped(heldSaveA, laterWritesB), {
    heldA: heldSaveA.map((entry) => ({ op: entry.op, heldFrom: entry.heldFrom, wroteAt: entry.wroteAt })),
    writesB: laterWritesB.map((entry) => ({ op: entry.op, wroteAt: entry.wroteAt })),
  });
  check(host, `${label}: the save removed tab A's own record and nothing else`, heldSaveA.some((entry) => entry.op === "removeItem" && entry.key === itemKeys[0]) && ownKeysOnly(heldSaveA, itemKeys[0]));
  const afterSave = await storage();
  check(
    host,
    `${label}: tab A's save removed only its own item; tab B's newest wording survived`,
    afterSave[itemKeys[0]] === undefined && draftText(afterSave[itemKeys[1]]) === moreB,
    Object.keys(afterSave)
  );

  // Discard while another tab's independent unsaved draft still exists
  // (A2 / R5-12): tab A recreates its own draft before tab B discards, and
  // A's exact wording must survive both a fresh storage read and recreation.
  const wordingA2 = `Tab A recreated wording for the ${surface}.`;
  await editItem(tabA, 0, wordingA2);
  const beforeDiscard = await storage();
  check(
    host,
    `${label}: tab A's recreated draft sits beside tab B's before the discard`,
    draftText(beforeDiscard[itemKeys[0]]) === wordingA2 && draftText(beforeDiscard[itemKeys[1]]) === moreB,
    Object.keys(beforeDiscard)
  );
  await tabB.getByRole("button", { name: "Cancel", exact: true }).last().click();
  const afterDiscard = await storage();
  check(
    host,
    `${label}: tab B's discard removed only its own item; tab A's exact wording survived in storage`,
    afterDiscard[itemKeys[1]] === undefined && draftText(afterDiscard[itemKeys[0]]) === wordingA2 && Object.keys(afterDiscard).length === 1,
    Object.keys(afterDiscard)
  );
  await reopen(tabA);
  let survivingA;
  let survived;
  if (surface === "workspace") {
    const boxes = tabA.getByRole("textbox", { name: "Bullet 1" });
    const count = await boxes.count();
    survivingA = { count, first: count > 0 ? await boxes.first().inputValue() : null };
    survived = count === 1 && survivingA.first === wordingA2;
  } else {
    await tabA.getByRole("button", { name: "Edit", exact: true }).first().click();
    survivingA = {
      first: await tabA.getByRole("textbox", { name: "Bullet 1" }).inputValue(),
      secondShowsServerWording: await tabA.getByText(serverWording[1], { exact: true }).isVisible(),
    };
    survived = survivingA.first === wordingA2 && survivingA.secondShowsServerWording;
  }
  check(host, `${label}: recreation after tab B's discard hydrates tab A's exact wording and no draft for tab B's item`, survived, survivingA);
  await shot(tabA, host, `09-${surface}-tab-a-survives-discard`);

  // Tab A discards its own recreated draft: nothing unsaved remains.
  await tabA.getByRole("button", { name: "Cancel", exact: true }).first().click();
  const afterBothDiscards = await storage();
  check(host, `${label}: tab A's own discard leaves no stored draft`, Object.keys(afterBothDiscards).length === 0, Object.keys(afterBothDiscards));

  // Recreated once more: nothing unsaved remains, the server wording stands.
  await reopen(tabA);
  let clean;
  if (surface === "workspace") {
    clean = (await tabA.getByRole("textbox", { name: "Bullet 1" }).count()) === 0;
  } else {
    await tabA.getByRole("button", { name: "Edit", exact: true }).first().click();
    clean = (await tabA.getByRole("textbox", { name: "Bullet 1" }).inputValue()) === serverWording[0];
  }
  check(host, `${label}: recreation after save and discard shows no unsaved draft`, clean);
  check(host, `${label}: no page errors`, pageErrors.length === 0, pageErrors);
  check(host, `${label}: no unexpected page reload`, unexpectedReloads() === 0, { reloads: unexpectedReloads() });
  await context.close();
}

let browser;
let exitCode = 1;
try {
  await startServer();
  if (injectLogFailure) serverProcess.log.destroy(new Error("injected log failure"));
  // An owned failure that already happened (a server that exited right after
  // readiness, a failed log) ends the run before a browser is launched.
  await owned(sleep(50));
  if (standInJourneyMs !== null) {
    // Harness self-tests only: the journeys' place in the run, raced against
    // the owned server like every journey, without launching a browser. It
    // exercised no journey, so it is recorded as a failed witness.
    await owned(sleep(standInJourneyMs));
    check("harness", "stand-in hold completed; a stand-in run exercises no journey and is never a witness", false, {
      standInJourneyMs,
    });
  } else {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: !headed });
    for (const host of ["current", "preview"]) {
      await owned(seedingJourney(browser, host));
      await owned(reportJourney(browser, host));
      await owned(concurrentTabsJourney(browser, host, "workspace"));
      await owned(concurrentTabsJourney(browser, host, "summary"));
    }
  }
  exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  console.error(error);
  results.push({ host: "harness", name: "run completed", ok: false, detail: String(error) });
  failures += 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  const report = {
    at: new Date().toISOString(),
    command: `node scripts/seed-summary-history-witness.mjs --out ${out} --port ${port}`,
    args,
    reservation: reservation.reservation,
    journeys: standInJourneyMs === null
      ? "real Chromium journeys"
      : `harness stand-in hold of ${standInJourneyMs} ms (no browser; never a witness)`,
    router: "production SvelteKit (vite dev, vite.integration.config.ts)",
    transport: "mocked convex-svelte stub seeded through window.__banhallConvexStub; no Convex deployment, no live model",
    storage: "concurrency journeys: two pages of one browser context share localStorage; an init script records writes and holds one page's draft-key writes to schedule the overlap",
    readiness: `owned server only: ${READY_PATH} must answer with this invocation's token`,
    hosts: ["current", "preview"],
    server: serverProcess
      ? {
          pid: serverProcess.pid,
          ready: serverProcess.ready,
          exit: serverProcess.exit,
          group: serverProcess.group,
          unexpectedExit: serverProcess.unexpectedExit,
          logFailure: serverProcess.logFailure,
        }
      : null,
    passed: results.filter((r) => r.ok).length,
    failed: failures,
    results,
  };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ out, passed: report.passed, failed: report.failed }));
}
process.exit(exitCode);

#!/usr/bin/env node
// @ts-nocheck: plain Node script; tests/stressData.test.ts covers its pure parts.
//
// F5 stress test, first part (docs/todos/phase-f-scale.md): on the LOCAL
// deployment of a checkout only, with real models and a spend cap, it makes a
// fictional company and an evaluation project, uploads the data
// scripts/stress/generate.mjs wrote (the interview, 50 large files, one file
// at the 1,000,000-character maximum and one over it, which must be refused
// by name), waits for search pieces and file labels, starts a Step by step
// draft and waits for its Seeds.
//
// Safety:
// - Every read and write goes to the checkout's local deployment (its
//   .convex/local/default/config.json and `npx convex run --deployment
//   local`), never a cloud one.
// - The project is named as a release eval project and marked as an
//   evaluation project (left out of learning, writer memory, edit size and
//   the Brain) before anything paid can start; if the mark fails, the run
//   stops.
// - The data is scanned against this deployment's names, and each file's
//   fingerprint checked against the manifest, before the first upload.
// - The spend is read inside every wait; past the cap less a margin, the run
//   stops and the draft is cancelled. A draft is cancelled too when the
//   script ends for any other reason; one that reached its Seeds is left for
//   the manual steps only on a clean finish. File labels and the Brief
//   prepared ahead keep running in the background after a stop; the script
//   keeps reading the spend until they settle and records the final figure.
//   Erasing the project stops them.
//
//   node scripts/stress/run.mjs --data /tmp/stress --checkout <checkout running convex dev> \
//     --subject <auth subject of an internal user> --cap 40 --confirm-spend --out /tmp/stress-results.json
//
// The later steps (picks, a long Brief, failing checks, chat at scale, a
// duplicate, two drafts at once, 100 files) are run by hand with the app and
// recorded in the same results file. Erase the project and the company
// through the app afterwards.
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inventedWordsFound, namesFound } from "./generate.mjs";

/** Must match shared/releaseEval.ts RELEASE_EVAL_PROJECT_PREFIX (a test pins it). */
export const RELEASE_EVAL_PREFIX = "Release eval - ";

export function stressProjectTitle(company) {
  return `${RELEASE_EVAL_PREFIX}Stress test - ${company}`;
}

/** The run stops this far below the cap: the check runs after money is spent. */
export function capWithMargin(cap) {
  return cap - Math.max(1, cap * 0.1);
}

/**
 * Characters per input token by call site and model, from rows that recorded
 * their characters and were charged input (as the Admin report counts them),
 * with the part sent in user turns. A whole-request figure: evidence-only
 * token counts come from the token count script (F1, step 5).
 */
export function spendByCallSite(rows) {
  const groups = {};
  for (const row of rows) {
    const key = `${row.callSite} ${row.model}`;
    const group = (groups[key] ??= { callSite: row.callSite, model: row.model, calls: 0, costUsd: 0, outputTokens: 0, stops: {}, requestChars: 0, evidenceChars: 0, inputSideTokens: 0 });
    group.calls += 1;
    group.costUsd += row.costUsd;
    group.outputTokens += row.outputTokens;
    const stop = row.stopReason ?? "none";
    group.stops[stop] = (group.stops[stop] ?? 0) + 1;
    const inputSide = row.inputTokens + (row.cacheCreationInputTokens ?? 0) + (row.cacheReadInputTokens ?? 0);
    if (row.requestChars !== undefined && row.requestChars !== null && inputSide > 0) {
      group.requestChars += row.requestChars;
      group.evidenceChars += row.evidenceChars ?? 0;
      group.inputSideTokens += inputSide;
    }
  }
  return Object.values(groups).map((group) => ({
    ...group,
    charsPerToken: group.inputSideTokens > 0 ? Math.round((group.requestChars / group.inputSideTokens) * 100) / 100 : null,
  }));
}

function argument(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function main(argv) {
  const dataDir = argument(argv, "--data");
  const checkout = argument(argv, "--checkout");
  const subject = argument(argv, "--subject");
  const cap = Number(argument(argv, "--cap", "NaN"));
  const outPath = argument(argv, "--out");
  if (!dataDir || !checkout || !subject || !outPath || !Number.isFinite(cap) || cap <= 0 || !argv.includes("--confirm-spend")) {
    console.error("stress/run: needs --data, --checkout, --subject, --cap USD, --out FILE and --confirm-spend (it makes paid model calls)");
    return 2;
  }
  const configPath = path.join(checkout, ".convex/local/default/config.json");
  if (!existsSync(configPath)) {
    console.error(`stress/run: ${checkout} has no local deployment (${configPath}); this script runs only on a local one`);
    return 2;
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const url = `http://127.0.0.1:${config.ports.cloud}`;
  const manifest = JSON.parse(readFileSync(path.join(dataDir, "manifest.json"), "utf8"));
  const text = (name) => readFileSync(path.join(dataDir, name), "utf8");

  const require = (await import("node:module")).createRequire(path.join(checkout, "package.json"));
  const { ConvexHttpClient } = require("convex/browser");
  const { makeFunctionReference: ref } = require("convex/server");
  const client = new ConvexHttpClient(url);
  client.setAdminAuth(config.adminKey, { subject, issuer: "https://convex.test", tokenIdentifier: `https://convex.test|${subject}` });
  const admin = new ConvexHttpClient(url);
  admin.setAdminAuth(config.adminKey);

  // Ctrl-C or SIGTERM stops the run at the next check (see onSignal).
  // The same Ctrl-C also reaches a CLI child mid-read; that read then fails
  // as a stop, not as a failed read.
  let stopSignal = null;
  class Stopped extends Error {}
  const checkStop = () => {
    if (stopSignal) throw new Stopped(`stopped by ${stopSignal}`);
  };

  /** `npx convex run` on the local deployment. */
  const cli = (args, maxBuffer) => {
    const env = { ...process.env };
    delete env.CONVEX_DEPLOYMENT;
    delete env.CONVEX_DEPLOY_KEY;
    try {
      return JSON.parse(execFileSync("npx", ["convex", "run", "--deployment", "local", ...args], { cwd: checkout, env, encoding: "utf8", maxBuffer }));
    } catch (error) {
      const signal = error?.signal ?? (error?.status === 130 ? "SIGINT" : error?.status === 143 ? "SIGTERM" : null);
      if (signal === "SIGINT" || signal === "SIGTERM") {
        stopSignal ??= signal;
        throw new Stopped(`stopped by ${stopSignal}`);
      }
      throw error;
    }
  };
  /** A read on the local deployment, through the CLI's inline query. */
  const inline = (query) => cli(["--inline-query", query], 64 * 1024 * 1024);
  /** An internal function on the local deployment, through the CLI. */
  const runInternal = (name, args) => cli([name, JSON.stringify(args)], 16 * 1024 * 1024);

  // The names are read from this deployment, and every file is checked
  // against them and against the manifest's fingerprints, before anything
  // is written.
  const read = inline(
    "const names = new Set(); for (const c of await ctx.db.query('clients').collect()) { names.add(c.name); for (const f of c.formerNames ?? []) names.add(f); }" +
      " for (const p of await ctx.db.query('projects').collect()) { names.add(p.clientName); names.add(p.title); if (p.sredTitle) names.add(p.sredTitle); for (const i of p.interviewees ?? []) names.add(i); }" +
      " for (const d of await ctx.db.query('intakeDrafts').collect()) { if (d.clientName) names.add(d.clientName); for (const i of d.interviewees ?? []) names.add(i); }" +
      " const speakers = await ctx.db.query('transcriptSpeakers').take(20001); for (const s of speakers) { if (s.label) names.add(s.label); }" +
      " const intake = await ctx.db.query('intakeSourceSpeakers').take(20001); for (const s of intake) { if (s.label) names.add(s.label); }" +
      " for (const u of await ctx.db.query('users').collect()) { if (u.name) names.add(u.name); }" +
      " return { cut: speakers.length > 20000 || intake.length > 20000, names: [...names].filter(n => n && n.trim().length >= 3) };"
  );
  if (read.cut) {
    console.error("stress/run: this deployment has more speakers than the name check reads; check the names by hand first");
    return 2;
  }
  const names = read.names;
  for (const file of manifest.files) {
    const body = text(file.name);
    if (sha256(body) !== file.sha256) {
      console.error(`stress/run: ${file.name} does not match the manifest; generate the data again`);
      return 2;
    }
    const hits = namesFound(body, names);
    if (hits.length) {
      console.error(`stress/run: ${file.name} holds ${hits.length} name(s) from this deployment; do not upload`);
      return 2;
    }
  }
  if (
    namesFound([manifest.company, ...manifest.people].join("\n"), names).length ||
    inventedWordsFound([manifest.company, ...manifest.people], names).length
  ) {
    console.error("stress/run: the invented company or people match a name, or a word of one, on this deployment");
    return 2;
  }

  const results = { startedAt: new Date().toISOString(), url, cap, stopsAt: capWithMargin(cap), company: manifest.company, namesChecked: names.length, steps: [] };
  const save = () => writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
  let projectId = null;
  let generationId = null;
  let spentSoFar = 0;

  // The deployment's function log, kept with the results.
  const logPath = `${outPath}.log`;
  const logStream = createWriteStream(logPath);
  const env = { ...process.env };
  delete env.CONVEX_DEPLOYMENT;
  delete env.CONVEX_DEPLOY_KEY;
  // Its own process group, so the Ctrl-C that stops the run does not cut
  // the log before the cancel and the final spend are in it.
  const logs = spawn("npx", ["convex", "logs", "--deployment", "local"], { cwd: checkout, env, detached: true });
  const stopLogs = () => {
    try {
      process.kill(-logs.pid, "SIGTERM");
    } catch {
      logs.kill();
    }
  };
  logs.on("error", (error) => logStream.write(`could not read the function log: ${error.message}\n`));
  logs.stdout.pipe(logStream);
  logs.stderr.pipe(logStream);
  results.logFile = logPath;

  /** The project's usage rows, without any model text. */
  const usageRows = () =>
    inline(
      `const rows = await ctx.db.query('aiUsage').withIndex('by_projectId', q => q.eq('projectId', '${projectId}')).collect();` +
        " return rows.map(r => ({ createdAt: r.createdAt, callSite: r.callSite, model: r.model, costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens," +
        " cacheCreationInputTokens: r.cacheCreationInputTokens ?? 0, cacheReadInputTokens: r.cacheReadInputTokens ?? 0, requestChars: r.requestChars ?? null," +
        " evidenceChars: r.evidenceChars ?? null, stopReason: r.stopReason ?? null }));"
    );
  /** The project's spend; `since` limits the breakdown to rows made from then on. */
  const spend = (since = 0) => {
    if (!projectId) return { costUsd: 0, calls: 0, byCallSite: [] };
    const rows = usageRows();
    return {
      costUsd: rows.reduce((total, row) => total + row.costUsd, 0),
      calls: rows.length,
      byCallSite: spendByCallSite(rows.filter((row) => row.createdAt >= since)),
    };
  };
  // Ctrl-C or SIGTERM stops at the next check, so `finally` still cancels
  // the draft and saves; a second one exits at once without either. Signals
  // are counted here only: a CLI read the first one killed sets the stop
  // flag, and this handler then runs for that same signal.
  let signalsReceived = 0;
  const onSignal = (signal) => {
    signalsReceived += 1;
    if (signalsReceived > 1) {
      console.error(`stress/run: ${signal} again; exiting without cancelling the draft or saving`);
      stopLogs();
      process.exit(130);
    }
    stopSignal ??= signal;
    console.error(`stress/run: ${signal}; stopping at the next check, then cancelling the draft and saving (again to exit at once)`);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  class CapReached extends Error {}
  const checkCap = (current) => {
    if (current.costUsd >= results.stopsAt) throw new CapReached(`spend $${current.costUsd.toFixed(2)} reached the stop point $${results.stopsAt.toFixed(2)} (cap $${cap})`);
  };

  async function step(name, body, { required = false } = {}) {
    checkStop();
    const started = Date.now();
    const entry = { step: name, ok: true };
    let capReached = null;
    try {
      entry.result = await body();
    } catch (error) {
      if (error instanceof CapReached || error instanceof Stopped) capReached = error;
      entry.ok = false;
      entry.error = String(error?.data?.message ?? error?.message ?? error);
    }
    // A signal during a CLI read fails that read; record the stop instead.
    if (stopSignal && !capReached) capReached = new Stopped(`stopped by ${stopSignal}`);
    entry.ms = Date.now() - started;
    const current = spend(started);
    entry.stepCostUsd = current.costUsd - spentSoFar;
    entry.spentSoFar = current.costUsd;
    entry.byCallSite = current.byCallSite;
    spentSoFar = current.costUsd;
    results.steps.push(entry);
    save();
    console.log(`${entry.ok ? "ok  " : "FAIL"} ${name} (${(entry.ms / 1000).toFixed(1)} s, $${entry.stepCostUsd.toFixed(2)}, $${current.costUsd.toFixed(2)} so far)${entry.ok ? "" : `: ${entry.error}`}`);
    if (capReached) throw capReached;
    if (!entry.ok && required) throw new Error(`a required step failed: ${name}`);
    checkCap(current);
    return entry;
  }

  async function waitFor(label, check, timeoutMs, everyMs) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      checkStop();
      const value = await check();
      if (value) return value;
      checkCap(spend());
      if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, everyMs));
    }
  }

  let finishedCleanly = false;
  try {
    // A company left from an earlier run fails the name check above; erase it first.
    await step("create the company", async () =>
      await client.mutation(ref("clients:createClient"), { name: manifest.company }), { required: true });
    // No transcript yet: nothing paid starts before the project is marked.
    await step("create the project", async () => {
      const created = await client.mutation(ref("projects:createProject"), {
        title: stressProjectTitle(manifest.company),
        clientName: manifest.company,
        transcripts: [],
      });
      projectId = created.projectId;
      return { projectId };
    }, { required: true });
    await step("mark it as an evaluation project", async () =>
      await admin.mutation(ref("seedPlanEval:markEvaluationProject"), { projectId }), { required: true });
    await step("add the interview", async () => {
      const interview = manifest.files.find((file) => file.kind === "transcript");
      const transcriptId = await client.mutation(ref("transcripts:addTranscript"), { projectId, content: text(interview.name), label: "Interview" });
      return { transcriptId, chars: interview.chars };
    }, { required: true });
    for (const file of manifest.files.filter((candidate) => candidate.kind !== "transcript")) {
      await step(`upload ${file.name} (${file.chars.toLocaleString()} characters)`, async () => {
        const outcome = await client
          .mutation(ref("documents:uploadDocument"), {
            projectId,
            fileName: file.name,
            fileType: "md",
            content: text(file.name),
            extractionOutcome: "ok",
            intake: "pasted",
          })
          .then((documentId) => ({ documentId }))
          .catch((error) => ({ refused: String(error?.data?.message ?? error?.message ?? error) }));
        if (file.kind === "file-over-max") {
          if (!outcome.refused) throw new Error("a file over the maximum was accepted");
          if (!/too long/i.test(outcome.refused) || !/1,000,000/.test(outcome.refused)) {
            throw new Error(`a file over the maximum was refused without naming the limit: ${outcome.refused}`);
          }
        } else if (outcome.refused) {
          throw new Error(outcome.refused);
        }
        return outcome;
      });
    }
    await step("search pieces and file labels for every file", async () =>
      await waitFor(
        "search pieces and labels",
        async () => {
          const state = inline(
            `const docs = await ctx.db.query('projectDocuments').withIndex('by_projectId', q => q.eq('projectId', '${projectId}')).collect();` +
              " return { files: docs.length, piecesDue: docs.filter(d => d.searchPiecesDue).length, labelsDue: docs.filter(d => d.labelsDue).length," +
              " withoutPieces: docs.filter(d => !d.searchPiecesDue && !d.searchPiecesTextHash).map(d => d.fileName)," +
              " labelErrors: docs.filter(d => d.labelsLastError).map(d => ({ file: d.fileName, error: d.labelsLastError })) };"
          );
          console.log(`     ${state.files} files, ${state.piecesDue} waiting for search pieces, ${state.labelsDue} for labels`);
          return state.piecesDue === 0 && state.labelsDue === 0 ? state : null;
        },
        60 * 60 * 1000,
        30_000
      ));
    // Ready as a writer sees it: every step's row, no Batch still being
    // made, and the drafting inputs ready (seedPlanEval:progress). The first
    // step's Batch starts when the stage opens and nothing retries it, so
    // one that failed, or never started, ends the wait with the cause.
    // Required: a draft that fails here is cancelled, never left running.
    await step("start a Step by step draft and wait for its Seeds", async () => {
      checkStop();
      generationId = await client.mutation(ref("generations:requestGeneration"), { projectId, candidateMode: "iterative", confirmRegeneration: true });
      let stageOpenSince = null;
      return await waitFor(
        "the Seeds",
        async () => {
          const progress = runInternal("seedPlanEval:progress", { generationId });
          if (progress.status === "failed") throw new Error(`the draft failed: ${progress.seedStageError ?? "no detail"}`);
          if (!["reserved", "running", "awaiting_input"].includes(progress.status)) throw new Error(`the draft is ${progress.status}`);
          if (progress.draftingInputs === "failed") throw new Error("the drafting inputs failed");
          const busy = inline(
            `const busy = []; for (const status of ['queued', 'running']) { busy.push(...await ctx.db.query('seedBatches').withIndex('by_generationId_and_status', q => q.eq('generationId', '${generationId}').eq('status', status)).take(50)); }` +
              " const shown = await ctx.db.query('seedBatches').withIndex('by_generationId_and_status', q => q.eq('generationId', '" + generationId + "').eq('status', 'shown')).take(1);" +
              " const first = await ctx.db.query('seedBatches').withIndex('by_generationId_and_roleId', q => q.eq('generationId', '" + generationId + "').eq('roleId', 'company_context')).take(20);" +
              " const failed = first.find(b => b.status === 'failed');" +
              " return { busy: busy.length, shown: shown.length, firstBatches: first.length, firstOpen: first.some(b => ['queued', 'running', 'shown'].includes(b.status))," +
              " firstFailed: failed ? [failed.error ?? 'no detail', failed.errorDetail].filter(Boolean).join(', ') : null };"
          );
          if (progress.status === "awaiting_input") {
            stageOpenSince ??= Date.now();
            if (busy.firstFailed && !busy.firstOpen) throw new Error(`the first step's Batch failed: ${busy.firstFailed}`);
            if (busy.firstBatches === 0 && Date.now() - stageOpenSince > 5 * 60 * 1000) throw new Error("the first step's Batch never started");
          }
          const ready =
            progress.status === "awaiting_input" &&
            progress.seedSubsections === 13 &&
            busy.busy === 0 &&
            busy.shown > 0 &&
            progress.draftingInputs === "ready";
          return ready ? { generationId, ...progress } : null;
        },
        40 * 60 * 1000,
        15_000
      );
    }, { required: true });
    results.finishedAt = new Date().toISOString();
    finishedCleanly = true;
    console.log(`stress/run: done; results in ${outPath}`);
    return 0;
  } catch (error) {
    results.stoppedBecause = String(error?.message ?? error);
    console.error(`stress/run: stopped: ${results.stoppedBecause}`);
    return 1;
  } finally {
    // Each part on its own, so one failing never skips the others.
    // The handlers stay until the last save, so a first Ctrl-C here still
    // saves; a second exits at once.
    if (generationId && !finishedCleanly) {
      // Tried even when the status cannot be read: the cancel itself
      // refuses a draft that has finished.
      let state = null;
      try {
        state = inline(`const g = await ctx.db.get('${generationId}'); return g?.status ?? null;`);
      } catch (error) {
        results.statusReadFailed = String(error?.message ?? error);
      }
      if (!["failed", "completed"].includes(state)) {
        try {
          await client.mutation(ref("generations:cancelIterativeGeneration"), { generationId });
          results.cancelledDraft = generationId;
        } catch (error) {
          results.cancelFailed = String(error?.data?.message ?? error?.message ?? error);
        }
      }
    }
    try {
      save();
    } catch (error) {
      console.error(`stress/run: could not save the results: ${error?.message ?? error}`);
    }
    // Labels and the Brief prepared ahead may still spend: read until the
    // spend holds for two minutes, at most fifteen. After a stop signal it
    // reads once and does not wait.
    try {
      let last = -1;
      let steadySince = Date.now();
      let settled = !projectId;
      const until = Date.now() + 15 * 60 * 1000;
      while (projectId && Date.now() < until) {
        let now;
        try {
          now = spend().costUsd;
        } catch (error) {
          if (error instanceof Stopped) break;
          throw error;
        }
        if (now !== last) {
          last = now;
          steadySince = Date.now();
        } else if (Date.now() - steadySince >= 2 * 60 * 1000) {
          settled = true;
          break;
        }
        for (let waited = 0; waited < 20 && !stopSignal; waited += 1) await new Promise((resolve) => setTimeout(resolve, 1000));
        if (stopSignal) break;
      }
      results.finalSpendUsd = Math.max(last, 0);
      // False when the fifteen minutes ran out while the spend still rose.
      results.finalSpendSettled = settled;
    } catch (error) {
      results.finalSpendError = String(error?.message ?? error);
    }
    // The whole run by feature, and when labels and search pieces were
    // made: labels start during the uploads, so no one step holds them.
    try {
      if (projectId) {
        const rows = usageRows();
        results.byCallSite = spendByCallSite(rows);
        const labels = rows.filter((row) => row.callSite === "file_labels").map((row) => row.createdAt);
        results.labelsMade = labels.length ? { requests: labels.length, first: new Date(Math.min(...labels)).toISOString(), last: new Date(Math.max(...labels)).toISOString() } : null;
        results.searchPiecesMade = inline(
          `const first = await ctx.db.query('documentSearchPieces').withIndex('by_projectId', q => q.eq('projectId', '${projectId}')).order('asc').first();` +
            ` const last = await ctx.db.query('documentSearchPieces').withIndex('by_projectId', q => q.eq('projectId', '${projectId}')).order('desc').first();` +
            " return first ? { first: new Date(first._creationTime).toISOString(), last: new Date(last._creationTime).toISOString() } : null;"
        );
      }
    } catch (error) {
      results.wholeRunError = String(error?.message ?? error);
    }
    try {
      save();
    } catch (error) {
      console.error(`stress/run: could not save the results: ${error?.message ?? error}`);
    }
    stopLogs();
    logStream.end();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

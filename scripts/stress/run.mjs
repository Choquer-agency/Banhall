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
//   stops and a running draft is cancelled. A draft still running when the
//   script ends for any other reason is cancelled too. File labels already
//   queued keep running in the background.
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
import { namesFound } from "./generate.mjs";

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
 * their characters and were charged input (as the Admin report counts them).
 */
export function spendByCallSite(rows) {
  const groups = {};
  for (const row of rows) {
    const key = `${row.callSite} ${row.model}`;
    const group = (groups[key] ??= { callSite: row.callSite, model: row.model, calls: 0, costUsd: 0, outputTokens: 0, stops: {}, requestChars: 0, inputSideTokens: 0 });
    group.calls += 1;
    group.costUsd += row.costUsd;
    group.outputTokens += row.outputTokens;
    const stop = row.stopReason ?? "none";
    group.stops[stop] = (group.stops[stop] ?? 0) + 1;
    const inputSide = row.inputTokens + (row.cacheCreationInputTokens ?? 0) + (row.cacheReadInputTokens ?? 0);
    if (row.requestChars !== undefined && row.requestChars !== null && inputSide > 0) {
      group.requestChars += row.requestChars;
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

  /** A read on the local deployment, through the CLI's inline query. */
  const inline = (query) => {
    const env = { ...process.env };
    delete env.CONVEX_DEPLOYMENT;
    delete env.CONVEX_DEPLOY_KEY;
    const out = execFileSync("npx", ["convex", "run", "--deployment", "local", "--inline-query", query], {
      cwd: checkout,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(out);
  };

  // The names are read from this deployment, and every file is checked
  // against them and against the manifest's fingerprints, before anything
  // is written.
  const names = inline(
    "const names = new Set(); for (const c of await ctx.db.query('clients').collect()) { names.add(c.name); for (const a of c.aliases ?? []) names.add(typeof a === 'string' ? a : a.name ?? ''); }" +
      " for (const p of await ctx.db.query('projects').collect()) { names.add(p.clientName); names.add(p.title); for (const i of p.interviewees ?? []) names.add(i); }" +
      " for (const s of await ctx.db.query('transcriptSpeakers').take(5000)) { if (s.label) names.add(s.label); }" +
      " for (const u of await ctx.db.query('users').collect()) { if (u.name) names.add(u.name); }" +
      " return [...names].filter(n => n && n.trim().length >= 3);"
  );
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
  if (namesFound([manifest.company, ...manifest.people].join("\n"), names).length) {
    console.error("stress/run: the invented company or people match a name on this deployment");
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
  const logs = spawn("npx", ["convex", "logs", "--deployment", "local"], { cwd: checkout, env });
  logs.on("error", (error) => logStream.write(`could not read the function log: ${error.message}\n`));
  logs.stdout.pipe(logStream);
  logs.stderr.pipe(logStream);
  results.logFile = logPath;

  const spend = () => {
    if (!projectId) return { costUsd: 0, calls: 0, byCallSite: [] };
    const rows = inline(
      `const rows = await ctx.db.query('aiUsage').withIndex('by_projectId', q => q.eq('projectId', '${projectId}')).collect();` +
        " return rows.map(r => ({ callSite: r.callSite, model: r.model, costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens," +
        " cacheCreationInputTokens: r.cacheCreationInputTokens ?? 0, cacheReadInputTokens: r.cacheReadInputTokens ?? 0, requestChars: r.requestChars ?? null, stopReason: r.stopReason ?? null }));"
    );
    return { costUsd: rows.reduce((total, row) => total + row.costUsd, 0), calls: rows.length, byCallSite: spendByCallSite(rows) };
  };
  class CapReached extends Error {}
  const checkCap = (current) => {
    if (current.costUsd >= results.stopsAt) throw new CapReached(`spend $${current.costUsd.toFixed(2)} reached the stop point $${results.stopsAt.toFixed(2)} (cap $${cap})`);
  };

  async function step(name, body, { required = false } = {}) {
    const started = Date.now();
    const entry = { step: name, ok: true };
    try {
      entry.result = await body();
    } catch (error) {
      if (error instanceof CapReached) throw error;
      entry.ok = false;
      entry.error = String(error?.data?.message ?? error?.message ?? error);
    }
    entry.ms = Date.now() - started;
    const current = spend();
    entry.stepCostUsd = current.costUsd - spentSoFar;
    entry.spentSoFar = current.costUsd;
    entry.byCallSite = current.byCallSite;
    spentSoFar = current.costUsd;
    results.steps.push(entry);
    save();
    console.log(`${entry.ok ? "ok  " : "FAIL"} ${name} (${(entry.ms / 1000).toFixed(1)} s, $${entry.stepCostUsd.toFixed(2)}, $${current.costUsd.toFixed(2)} so far)${entry.ok ? "" : `: ${entry.error}`}`);
    if (!entry.ok && required) throw new Error(`a required step failed: ${name}`);
    checkCap(current);
    return entry;
  }

  async function waitFor(label, check, timeoutMs, everyMs) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const value = await check();
      if (value) return value;
      checkCap(spend());
      if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, everyMs));
    }
  }

  try {
    await step("create the company", async () => {
      try {
        return await client.mutation(ref("clients:createClient"), { name: manifest.company });
      } catch (error) {
        const message = String(error?.data?.message ?? error?.message ?? error);
        if (/already/i.test(message)) return { reused: true };
        throw error;
      }
    }, { required: true });
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
              " return { files: docs.length, piecesDue: docs.filter(d => d.searchPiecesDue).length, labelsDue: docs.filter(d => d.labelsDue).length };"
          );
          console.log(`     ${state.files} files, ${state.piecesDue} waiting for search pieces, ${state.labelsDue} for labels`);
          return state.piecesDue === 0 && state.labelsDue === 0 ? state : null;
        },
        60 * 60 * 1000,
        30_000
      ));
    await step("start a Step by step draft and wait for its Seeds", async () => {
      generationId = await client.mutation(ref("generations:requestGeneration"), { projectId, candidateMode: "iterative", confirmRegeneration: true });
      return await waitFor(
        "the Seeds",
        async () => {
          const state = inline(`const g = await ctx.db.get('${generationId}'); return { status: g.status, step: g.currentStep, error: g.error ?? null };`);
          if (state.status === "failed") throw new Error(`the draft failed: ${state.error ?? state.step}`);
          return state.status === "awaiting_input" ? { generationId, ...state } : null;
        },
        40 * 60 * 1000,
        15_000
      );
    });
    results.finishedAt = new Date().toISOString();
    console.log(`stress/run: done; results in ${outPath}`);
    return 0;
  } catch (error) {
    results.stoppedBecause = String(error?.message ?? error);
    console.error(`stress/run: stopped: ${results.stoppedBecause}`);
    return 1;
  } finally {
    if (generationId) {
      const state = inline(`const g = await ctx.db.get('${generationId}'); return g?.status ?? null;`);
      if (state && !["failed", "completed", "awaiting_input"].includes(state)) {
        await client.mutation(ref("generations:cancelIterativeGeneration"), { generationId }).catch(() => undefined);
        results.cancelledDraft = generationId;
      }
    }
    save();
    logs.kill();
    logStream.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

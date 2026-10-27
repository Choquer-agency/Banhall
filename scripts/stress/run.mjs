#!/usr/bin/env node
// @ts-nocheck: plain Node script.
//
// F5 stress test, first part (docs/todos/phase-f-scale.md): on a LOCAL
// deployment only, with real models and a spend cap, it makes a fictional
// company and an evaluation project, uploads the data scripts/stress/
// generate.mjs wrote (the interview, 50 large files, one file at the
// 1,000,000-character maximum and one over it, which must be refused by
// name), waits for search pieces and file labels, starts a Step by step
// draft and waits for its Seeds. Every step records its time, its result,
// the project's spend so far and, for model calls, characters per token.
// It stops (and cancels a running draft) once the spend passes the cap.
//
//   node scripts/stress/run.mjs --data /tmp/stress --config <checkout>/.convex/local/default/config.json \
//     --subject <auth subject of an internal user> --cap 40 --confirm-spend --out /tmp/stress-results.json
//
// The later steps (picks, a long Brief, failing checks, chat at scale, a
// duplicate, two drafts at once, 100 files) are run by hand with the app
// and recorded in the same results file.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference as ref } from "convex/server";

function argument(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

const argv = process.argv.slice(2);
const dataDir = argument(argv, "--data");
const configPath = argument(argv, "--config");
const subject = argument(argv, "--subject");
const cap = Number(argument(argv, "--cap", "NaN"));
const outPath = argument(argv, "--out", "stress-results.json");
if (!dataDir || !configPath || !subject || !Number.isFinite(cap) || cap <= 0 || !argv.includes("--confirm-spend")) {
  console.error("stress/run: needs --data, --config, --subject, --cap USD and --confirm-spend (it makes paid model calls)");
  process.exit(2);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
const url = `http://127.0.0.1:${config.ports.cloud}`;
const checkout = path.resolve(path.dirname(configPath), "../../..");
const manifest = JSON.parse(readFileSync(path.join(dataDir, "manifest.json"), "utf8"));
if (manifest.hits?.length || !manifest.namesChecked) {
  console.error("stress/run: the data was not scanned against the deployment's names, or a name was found; run generate.mjs with --names first");
  process.exit(2);
}
const text = (name) => readFileSync(path.join(dataDir, name), "utf8");

const client = new ConvexHttpClient(url);
client.setAdminAuth(config.adminKey, { subject, issuer: "https://convex.test", tokenIdentifier: `https://convex.test|${subject}` });
const admin = new ConvexHttpClient(url);
admin.setAdminAuth(config.adminKey);

/** A read on the deployment, through the CLI's inline query (local only). */
function inline(query) {
  const out = execFileSync("npx", ["convex", "run", "--inline-query", query], {
    cwd: checkout,
    env: { ...process.env, CONVEX_DEPLOYMENT: undefined, CONVEX_DEPLOY_KEY: undefined },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const results = { startedAt: new Date().toISOString(), url, cap, company: manifest.company, steps: [] };
const save = () => writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
let projectId = null;
let generationId = null;

function spend() {
  if (!projectId) return { costUsd: 0, calls: 0 };
  return inline(
    `const rows = await ctx.db.query('aiUsage').withIndex('by_projectId', q => q.eq('projectId', '${projectId}')).collect();` +
      ` const by = {}; for (const r of rows) { const k = r.callSite; by[k] ??= { calls: 0, costUsd: 0, chars: 0, tokens: 0, stops: {} };` +
      ` by[k].calls += 1; by[k].costUsd += r.costUsd; by[k].chars += r.requestChars ?? 0;` +
      ` by[k].tokens += r.inputTokens + (r.cacheCreationInputTokens ?? 0) + (r.cacheReadInputTokens ?? 0);` +
      ` const s = r.stopReason ?? 'none'; by[k].stops[s] = (by[k].stops[s] ?? 0) + 1; }` +
      ` return { calls: rows.length, costUsd: rows.reduce((t, r) => t + r.costUsd, 0), byCallSite: by };`
  );
}

async function step(name, body) {
  const started = Date.now();
  const entry = { step: name, ok: true };
  try {
    entry.result = await body();
  } catch (error) {
    entry.ok = false;
    entry.error = String(error?.data?.message ?? error?.message ?? error);
  }
  entry.ms = Date.now() - started;
  entry.spend = spend();
  results.steps.push(entry);
  save();
  console.log(`${entry.ok ? "ok  " : "FAIL"} ${name} (${(entry.ms / 1000).toFixed(1)} s, $${entry.spend.costUsd.toFixed(2)} so far)${entry.ok ? "" : `: ${entry.error}`}`);
  if (entry.spend.costUsd > cap) {
    if (generationId) await client.mutation(ref("generations:cancelIterativeGeneration"), { generationId }).catch(() => undefined);
    console.error(`stress/run: spend $${entry.spend.costUsd.toFixed(2)} passed the cap of $${cap}; stopped`);
    results.stoppedAtCap = true;
    save();
    process.exit(1);
  }
  return entry;
}

async function waitFor(label, check, timeoutMs, everyMs = 10_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

await step("create the company", async () => {
  try {
    return await client.mutation(ref("clients:createClient"), { name: manifest.company });
  } catch (error) {
    return { reused: true, note: String(error?.data?.message ?? error?.message ?? error) };
  }
});
await step("create the project with the interview", async () => {
  const interview = manifest.files.find((file) => file.kind === "transcript");
  const created = await client.mutation(ref("projects:createProject"), {
    title: `Stress test - ${manifest.company}`,
    clientName: manifest.company,
    transcripts: [{ content: text(interview.name), label: "Interview" }],
  });
  projectId = created.projectId;
  return { projectId, interviewChars: interview.chars };
});
await step("mark it as an evaluation project", async () =>
  await admin.mutation(ref("seedPlanEval:markEvaluationProject"), { projectId })
);
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
    if (file.kind === "file-over-max" && !outcome.refused) throw new Error("a file over the maximum was accepted");
    if (file.kind !== "file-over-max" && outcome.refused) throw new Error(outcome.refused);
    return outcome;
  });
}
await step("search pieces and file labels for every file", async () =>
  await waitFor(
    "search pieces and labels",
    async () => {
      const state = inline(
        `const docs = await ctx.db.query('projectDocuments').withIndex('by_projectId', q => q.eq('projectId', '${projectId}')).collect();` +
          ` return { files: docs.length, piecesDue: docs.filter(d => d.searchPiecesDue).length, labelsDue: docs.filter(d => d.labelsDue).length };`
      );
      console.log(`     ${state.files} files, ${state.piecesDue} waiting for search pieces, ${state.labelsDue} for labels`);
      return state.piecesDue === 0 && state.labelsDue === 0 ? state : null;
    },
    60 * 60 * 1000,
    30_000
  )
);
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
save();
console.log(`stress/run: done; results in ${outPath}`);

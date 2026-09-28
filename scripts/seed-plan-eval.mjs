#!/usr/bin/env node
// @ts-nocheck: plain Node script; the app's type check reaches its logic
// through tests/seedPlanEval.test.ts, which imports scripts/seed-plan-eval/eval.ts.
//
// Release-blocking semantic suite for Step by step (CAP-13) and the CAP-14
// seed-stage numbers. For each fictional fixture under
// scripts/seed-plan-eval/fixtures/ it creates a project named
// "Release eval - <fixture>", starts Step by step, performs the scripted
// writer actions (selections, edits, Feedback, skips, regenerations,
// approvals) through the public mutations as the named reviewer, signs off,
// waits for the report, and writes a judging pack for the reviewing manager
// under _bmad-output/test-artifacts/seed-plan-eval/<date>/.
//
// Billable: every fixture makes real model calls on the chosen deployment.
//
//   node scripts/seed-plan-eval.mjs --dry-run
//   node scripts/seed-plan-eval.mjs --deployment local --as reviewer@example.com --confirm-spend
//   node scripts/seed-plan-eval.mjs --deployment local --as reviewer@example.com --confirm-spend --fixture withdrawn-feedback
//   node scripts/seed-plan-eval.mjs --deployment local --as reviewer@example.com --cleanup
//
// Options:
//   --dry-run            validate the fixtures and print each scripted session; no Convex call, no model call
//   --deployment NAME    the deployment to run on (passed to `npx convex run --deployment`); required
//   --as EMAIL           the internal user (writer, manager or admin) the suite acts as; required
//   --confirm-spend      required for a run: it makes paid model calls
//   --allow-cloud-dev    allow a cloud development deployment (local ones only by default)
//   --fixture ID         run one fixture (repeatable); default all
//   --single-baseline    after each fixture, run Single mode on the same project for the CAP-14 comparison
//   --out DIR            pack root (default _bmad-output/test-artifacts/seed-plan-eval)
//   --cleanup            delete every "Release eval - " project the reviewer owns, then stop
//   --render FILE        rebuild a judging pack from an earlier results.json with the current checks; no Convex or model call
//
// A scripted action refused by the per-user limits (RATE_LIMITED) is waited
// out: the script prints what it waits for, sleeps the refusal's retryAfter
// plus a few seconds and retries the same action, up to 45 minutes of
// waiting per run. It never bypasses or changes the limits.
//
// Never production: energized-salamander-237 and any "prod" deployment are
// always refused, a non-local deployment needs --allow-cloud-dev, and a
// CONVEX_DEPLOY_KEY in the environment is refused so --deployment alone
// chooses the target.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// The suite's code, fixtures and default pack folder come from the checkout
// this script lives in; `npx convex run` runs in the current directory, so
// its project config and .env.local choose the local backend. Running this
// script from another checkout's directory leaves that checkout untouched.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const convexDir = process.cwd();

function convexRun(deployment, functionName, args, identity) {
  const env = { ...process.env };
  delete env.CONVEX_DEPLOY_KEY;
  const argv = ["run", "--deployment", deployment, functionName, JSON.stringify(args)];
  if (identity) argv.push("--identity", JSON.stringify(identity));
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, "node_modules/.bin/convex"), argv, { cwd: convexDir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject({ stderr: stderr || stdout });
      const text = stdout.trim();
      if (!text) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(text);
      }
    });
  });
}

const server = await createServer({
  root,
  configFile: false,
  cacheDir: path.join(root, "node_modules/.vite-seed-plan-eval"),
  server: { middlewareMode: true, watch: null },
  logLevel: "error",
});
let exitCode = 0;
try {
  const evalModule = await server.ssrLoadModule("/scripts/seed-plan-eval/eval.ts");
  let options;
  try {
    options = evalModule.parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`seed-plan-eval: ${error.message}`);
    process.exitCode = 2;
    throw null;
  }
  if (options.help) {
    console.log("See the header of scripts/seed-plan-eval.mjs for usage.");
    throw null;
  }

  const fixtures = evalModule.loadFixtures(path.join(root, "scripts/seed-plan-eval/fixtures"), options.fixtures);
  let invalid = 0;
  for (const fixture of fixtures) {
    const problems = evalModule.validateFixture(fixture);
    const words = Object.values(fixture.texts).reduce((sum, text) => sum + evalModule.wordCount(text), 0);
    console.log(`${fixture.id} (${evalModule.SEMANTIC_CASES[fixture.semanticCase]?.title ?? fixture.semanticCase}): ${words} words, ${problems.length ? `${problems.length} problem(s)` : "valid"}`);
    for (const problem of problems) console.log(`  - ${problem}`);
    if (problems.length) invalid += 1;
  }

  if (options.render) {
    const saved = JSON.parse(readFileSync(path.resolve(convexDir, options.render), "utf8"));
    const { context, results } = evalModule.rerenderResults(saved, fixtures);
    const packRoot = path.resolve(options.out ?? path.join(root, "_bmad-output/test-artifacts/seed-plan-eval"));
    const dir = evalModule.reservePackDir(packRoot, context.date);
    const written = evalModule.writePack(dir, results, context);
    console.log(`Re-rendered ${results.length} fixture(s) from ${options.render} with no Convex or model call:`);
    for (const file of written) console.log(`  ${path.relative(root, file)}`);
    throw null;
  }

  if (options.dryRun) {
    for (const fixture of fixtures) {
      console.log(`\n${fixture.id}: scripted session`);
      evalModule.buildPlan(fixture).forEach((step, i) => console.log(`  ${String(i + 1).padStart(2)}. ${evalModule.describeStep(step)}`));
    }
    const wouldRefuse = evalModule.deploymentRefusal({ ...options, dryRun: false }, process.env);
    console.log(`\nDry run: no Convex call and no model call was made. A real run with these options ${wouldRefuse ? `would be refused: ${wouldRefuse.replace(/\.$/, "")}` : `would run on ${options.deployment}`}.`);
    exitCode = invalid ? 1 : 0;
    throw null;
  }

  const refusal = evalModule.deploymentRefusal(options, process.env);
  if (refusal) {
    console.error(`seed-plan-eval: ${refusal}`);
    exitCode = 2;
    throw null;
  }
  if (invalid) {
    console.error("seed-plan-eval: fix the fixture problems above first.");
    exitCode = 1;
    throw null;
  }

  const deployment = options.deployment;
  const actor = await convexRun(deployment, "seedPlanEval:evalActor", { email: options.as });
  if (!actor) {
    console.error(`seed-plan-eval: no internal user with a role has the email ${options.as} on ${deployment}.`);
    exitCode = 2;
    throw null;
  }
  const identity = { subject: actor.authId, issuer: "release-eval", tokenIdentifier: `release-eval|${actor.authId}` };
  const call = async (name, args, asReviewer) => {
    try {
      return await convexRun(deployment, name, args, asReviewer ? identity : undefined);
    } catch (failure) {
      throw evalModule.parseConvexError(failure?.stderr ?? String(failure));
    }
  };
  const driver = {
    mutation: (name, args) => call(name, args, true),
    query: (name, args) => call(name, args, true),
    internal: (name, args) => call(name, args, false),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
  };

  const existing = await driver.internal("seedPlanEval:listEvalProjects", { ownerId: actor.userId });
  if (options.cleanup) {
    for (const project of existing) {
      await driver.mutation("projects:deleteProject", { projectId: project.projectId });
      console.log(`deleted ${project.title} (${project.projectId})`);
    }
    console.log(`${existing.length} release eval project(s) deleted.`);
    throw null;
  }
  if (existing.length) {
    console.log(`Note: ${existing.length} earlier release eval project(s) exist; --cleanup deletes them.`);
  }

  // One allowance for the whole invocation: a RATE_LIMITED refusal is waited
  // out (retryAfter plus a few seconds) and the same action retried, up to
  // 45 minutes of waiting in all. The limits are never bypassed or changed.
  const rateLimitBudget = evalModule.rateLimitBudget();
  const results = [];
  for (const fixture of fixtures) {
    console.log(`\n=== ${fixture.id} ===`);
    const { log, collected } = await evalModule.runFixture(fixture, driver, { singleBaseline: options.singleBaseline, rateLimitBudget });
    const checks = evalModule.runChecks(fixture, collected, log);
    results.push({ fixture: { ...fixture, dir: undefined, texts: undefined }, log, collected, checks });
    const failed = checks.filter((item) => item.status === "fail");
    console.log(`${fixture.id}: ${checks.filter((item) => item.status === "pass").length} checks passed, ${failed.length} failed`);
    for (const item of failed) console.log(`  FAIL ${item.label}: ${item.evidence}`);
  }

  const date = new Date().toLocaleDateString("en-CA");
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const context = { date, deployment, commit, reviewer: options.as };
  const packRoot = path.resolve(options.out ?? path.join(root, "_bmad-output/test-artifacts/seed-plan-eval"));
  const dir = evalModule.reservePackDir(packRoot, date);
  const written = evalModule.writePack(dir, results, context);
  console.log(`\nJudging pack: ${path.relative(root, dir)}`);
  for (const file of written) console.log(`  ${path.relative(root, file)}`);

  const samples = evalModule.mergeSamples(results.filter((r) => r.collected).map((r) => evalModule.latencySamples(r.collected, r.log)));
  const show = (label, values) => {
    const d = evalModule.distribution(values);
    const s = (ms) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
    console.log(`${label}: median ${s(d.medianMs)}, p95 ${s(d.p95Ms)} (n=${d.count})`);
  };
  show("Dispatch to validated result", samples.dispatchToResultMs);
  show("Foreground dispatch to first render", samples.foregroundToFirstRenderMs);
  show("Sign-off to report created", samples.signOffToReportMs);
  if (samples.singleModeRequestToReportMs.length) show("Single mode request to report", samples.singleModeRequestToReportMs);
  let total = 0;
  for (const r of results) {
    if (!r.collected) continue;
    const cost = evalModule.usageCost(r.collected);
    const requests = evalModule.seedRequestCount(r.collected);
    total += cost.totalUsd;
    console.log(`${r.fixture.id}: ${requests.reserved} seed-stage requests, $${cost.totalUsd.toFixed(2)} (seed stage $${cost.seedStageUsd.toFixed(2)})`);
  }
  console.log(`Cost from aiUsage: $${total.toFixed(2)} in all.`);
  if (rateLimitBudget.waitedMs) console.log(`Waited ${evalModule.formatWait(rateLimitBudget.waitedMs)} in all for rate limits.`);
  console.log("Every fixture must be judged pass by the reviewing manager before release (docs/release-checklist.md).");
  exitCode = results.some((r) => r.log.error) ? 1 : 0;
} catch (error) {
  if (error !== null) {
    console.error(error);
    exitCode = 1;
  }
} finally {
  await server.close();
}
process.exitCode = process.exitCode || exitCode;

#!/usr/bin/env node
// @ts-nocheck: plain Node script.
//
// Banhall lab: a private local copy of the app that any coding agent (Claude
// Code, Codex, or a person in a terminal) can drive. See scripts/lab/README.md.
//
// - `up` makes a git worktree of this checkout, starts a blank local Convex
//   backend inside it (no snapshot, so no client data), copies the two AI
//   keys from a source checkout's deployment without printing them, makes
//   three fictional logins (admin, manager, writer) and serves the app.
// - The other commands act on that local copy only. Every project is named
//   as a release eval project and marked as an evaluation project before
//   anything paid starts, and paid commands refuse to start past the spend
//   cap (and a draft being waited on is cancelled when the cap is reached).
// - `down` stops everything and deletes the worktree and the lab folder.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LAB = process.env.BANHALL_LAB_DIR ?? path.join(os.tmpdir(), "banhall-lab");
const STATE = path.join(LAB, "state.json");
const TREE = path.join(LAB, "tree");
const PREFIX = "Release eval - ";
const ROLES = ["admin", "manager", "writer"];

const argv = process.argv.slice(2);
const BOOLEAN_FLAGS = new Set(["--no-wait", "--json", "--web", "--allow-prod-source", "--confirm-regeneration", "--new-thread", "--until-seeds"]);
const VALUE_FLAGS = new Set([
  "--target", "--port", "--cap", "--key-source", "--team", "--convex-project", "--draft-web-background", "--as", "--source", "--title",
  "--client", "--industry", "--interviewee", "--label", "--fiscal-year-end", "--timeout-min", "--mode", "--web-background", "--model",
  "--compare-models", "--thread",
]);
const command = argv[0];
// Only known flags and their values are options; anything else (a message
// that starts with "--", say) is a positional argument.
const positional = [];
for (let i = 1; i < argv.length; i++) {
  if (BOOLEAN_FLAGS.has(argv[i])) continue;
  if (VALUE_FLAGS.has(argv[i])) {
    i++;
    continue;
  }
  positional.push(argv[i]);
}
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(name);

const log = (...a) => console.error(`[lab] ${a.join(" ")}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (value) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));

// The Convex CLI and the app read the shell before a checkout's .env.local,
// so every command runs without the shell's deployment values.
const cleanEnv = { ...process.env };
for (const name of [
  "CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_URL", "CONVEX_SITE_URL", "PUBLIC_CONVEX_URL", "PUBLIC_CONVEX_SITE_URL",
]) delete cleanEnv[name];

const readState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null);
const writeState = (state) => {
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
};
const requireState = () => {
  const state = readState();
  if (!state?.ready) throw new Error("The lab is not up. Run: node scripts/lab/lab.mjs up");
  return state;
};

function assertLocal() {
  const env = fs.readFileSync(path.join(TREE, ".env.local"), "utf8");
  if (!/^CONVEX_DEPLOYMENT=local:/m.test(env)) throw new Error("The lab worktree is not on a local deployment; refusing to continue.");
  if (!fs.existsSync(path.join(TREE, ".convex", "local", "default", "config.json"))) {
    throw new Error("The local backend keeps its data outside the worktree; refusing to continue.");
  }
  for (const name of ["PUBLIC_CONVEX_URL", "PUBLIC_CONVEX_SITE_URL"]) {
    const value = (env.match(new RegExp(`^${name}=(\\S+)`, "m")) ?? [])[1];
    if (value && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/.test(value)) {
      throw new Error(`The lab worktree's ${name} is not local; refusing to continue.`);
    }
  }
}

/** True when nothing answers on this port on localhost. */
async function portFree(port) {
  const net = await import("node:net");
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "localhost" }, () => server.close(() => resolve(true)));
  });
}

const inTree = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: TREE, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: cleanEnv, maxBuffer: 256 * 1024 * 1024, ...opts });

const convexBin = () => path.join(TREE, "node_modules", ".bin", "convex");

/** Functions that start paid model work; `run` checks the cap before them. */
const PAID_FUNCTIONS = /^(generations:(requestGeneration|retry\w*)|chatV2:(sendMessage|sendAlternative)|seeds?\w*:\w*(regenerate|request|start)\w*)$/i;

/** A Convex function on the lab's local backend, as one of the lab logins (or as admin-level CLI when `as` is null). */
function call(fn, args = {}, as = null, state = null) {
  assertLocal();
  const cliArgs = ["run", fn, JSON.stringify(args)];
  if (as) {
    const account = (state ?? requireState()).accounts[as];
    if (!account) throw new Error(`No lab login for role "${as}". Use one of: ${ROLES.join(", ")}.`);
    cliArgs.push("--identity", JSON.stringify({ subject: account.authId, issuer: "banhall-lab", tokenIdentifier: `banhall-lab|${account.authId}` }));
  }
  try {
    const text = inTree(convexBin(), cliArgs).trim();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    const message = String(error.stderr || error.message).trim().split("\n").filter((l) => !/^\s+at /.test(l)).slice(-6).join("\n");
    throw new Error(`${fn} failed:\n${message}`);
  }
}

/** A read-only query written inline (ctx.db is available). */
function inlineQuery(code) {
  assertLocal();
  const text = inTree(convexBin(), ["run", "--inline-query", code]).trim();
  return text ? JSON.parse(text) : null;
}

function spend() {
  const rows = inlineQuery(
    "const rows = await ctx.db.query('aiUsage').collect(); return rows.map(r => ({ callSite: r.callSite, model: r.model, costUsd: r.costUsd ?? 0, projectId: r.projectId ?? null }));"
  );
  const byCallSite = {};
  for (const row of rows) {
    const key = `${row.callSite} | ${row.model}`;
    byCallSite[key] = (byCallSite[key] ?? 0) + row.costUsd;
  }
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
  return { totalUsd: Number(total.toFixed(4)), calls: rows.length, byCallSite };
}

function requireUnderCap(state) {
  const { totalUsd } = spend();
  const stopAt = state.capUsd - Math.max(0.5, state.capUsd * 0.1);
  if (totalUsd >= stopAt) {
    throw new Error(`Spend is $${totalUsd.toFixed(2)}, past the stop point $${stopAt.toFixed(2)} of the $${state.capUsd} cap. Raise it with: lab.mjs cap <usd>`);
  }
  return totalUsd;
}

// ---------------------------------------------------------------- up / down

function spawnLogged(name, cmd, args, env) {
  const file = path.join(LAB, `${name}.log`);
  const fd = fs.openSync(file, "a");
  const child = spawn(cmd, args, { cwd: TREE, detached: true, stdio: ["ignore", fd, fd], env });
  child.unref();
  return { pid: child.pid, log: file };
}

function startBackend() {
  return spawnLogged("backend", "npx", [
    "convex", "dev", "--configure", "existing", "--team", option("--team", "conquerthecrowns"),
    "--project", option("--convex-project", "banhall-e2e"), "--dev-deployment", "local", "--typecheck", "disable", "--tail-logs", "disable",
  ], { ...cleanEnv, DATABASE_UDF_USER_TIMEOUT_SECONDS: "10", DATABASE_UDF_SYSTEM_TIMEOUT_SECONDS: "60", CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: "180" });
}

const readyCount = (file) => (fs.existsSync(file) ? (fs.readFileSync(file, "utf8").match(/Convex functions ready/g) ?? []).length : 0);
const tail = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").slice(-15).join("\n") : "(no log)");

async function waitReady(file, after, timeoutMs = 300_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (readyCount(file) > after) return;
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (/✖/.test(text.split("Convex functions ready").at(-1) ?? "")) throw new Error(`Local backend failed:\n${tail(file)}`);
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for the local backend:\n${tail(file)}`);
}

function killGroup(pid) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // already gone
  }
}

async function waitGone(pid) {
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(-pid, 0);
    } catch {
      return;
    }
    await sleep(500);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // gone
  }
}

function keySourceDir() {
  const given = option("--key-source", process.env.BANHALL_LAB_KEY_SOURCE);
  const candidates = given ? [path.resolve(given)] : [REPO, path.resolve(REPO, "../Banhall")];
  for (const dir of candidates) {
    const file = path.join(dir, ".env.local");
    if (!fs.existsSync(file)) continue;
    const deployment = ((fs.readFileSync(file, "utf8").match(/^CONVEX_DEPLOYMENT=([^\s#]+)/m) ?? [])[1] ?? "").replace(/^["']|["']$/g, "");
    if (!deployment) continue;
    if (deployment.startsWith("local:")) continue;
    if (deployment.startsWith("prod:") && !flag("--allow-prod-source")) {
      throw new Error(`${dir} points at a production deployment; pass --allow-prod-source to read its keys.`);
    }
    return { dir, deployment };
  }
  throw new Error("No checkout with a cloud CONVEX_DEPLOYMENT to read the AI keys from. Pass --key-source <checkout>.");
}

async function up() {
  const existing = readState();
  if (existing) throw new Error(`A lab already exists in ${LAB}. Run "lab.mjs down" first.`);
  if (fs.existsSync(LAB) && fs.readdirSync(LAB).length > 0) {
    throw new Error(`${LAB} exists and is not a lab; pick another BANHALL_LAB_DIR.`);
  }
  const port = Number(option("--port", "5190"));
  if ([3001, 5173, 5175].includes(port)) throw new Error(`Port ${port} belongs to another server; pick another.`);
  if (!(await portFree(port))) throw new Error(`Port ${port} is in use; pick another with --port.`);
  const capUsd = Number(option("--cap", "10"));
  if (!(capUsd > 0 && capUsd <= 100)) throw new Error("--cap takes dollars from 0 to 100.");
  const target = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${option("--target", "HEAD")}^{commit}`], { cwd: REPO, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: REPO, encoding: "utf8" }).trim();
  if (dirty) log("note: this checkout has uncommitted changes; the lab runs the committed code only");
  const source = keySourceDir();

  fs.mkdirSync(LAB, { recursive: true, mode: 0o700 });
  fs.chmodSync(LAB, 0o700);
  const state = { ready: false, createdAt: new Date().toISOString(), repo: REPO, target, port, capUsd, keySource: source.deployment.split(":")[0], pids: {}, accounts: {} };
  writeState(state);
  try {
    log(`worktree at ${target.slice(0, 8)}`);
    execFileSync("git", ["worktree", "add", "--detach", TREE, target], { cwd: REPO, stdio: "ignore" });
    const sameLock = fs.existsSync(path.join(REPO, "node_modules")) &&
      fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8") === fs.readFileSync(path.join(TREE, "package-lock.json"), "utf8");
    if (sameLock && process.platform === "darwin") {
      log("cloning node_modules (copy-on-write)");
      execFileSync("cp", ["-cR", path.join(REPO, "node_modules"), path.join(TREE, "node_modules")]);
      fs.rmSync(path.join(TREE, "node_modules", ".vite"), { recursive: true, force: true });
    } else {
      log("installing dependencies (npm ci)");
      inTree("npm", ["ci", "--no-audit", "--no-fund"], { stdio: "ignore" });
    }

    log("starting a blank local backend");
    let backend = startBackend();
    state.pids.backend = backend.pid;
    writeState(state);
    await waitReady(backend.log, 0);
    assertLocal();

    // The value goes on stdin, never the command line, where ps could see it.
    const setSecret = (key, value) => {
      try {
        inTree(convexBin(), ["env", "set", key], { input: value });
      } catch {
        throw new Error(`Setting ${key} on the local backend failed.`);
      }
    };
    for (const key of ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"]) {
      let value = "";
      try {
        value = execFileSync(path.join(TREE, "node_modules", ".bin", "convex"), ["env", "get", key], { cwd: source.dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: cleanEnv }).trim();
      } catch {
        throw new Error(`Reading ${key} from ${source.deployment.split(":")[0]} deployment failed.`);
      }
      if (!value) throw new Error(`${key} is not set on the source deployment.`);
      setSecret(key, value);
    }
    for (const key of ["DRAFT_WEB_BACKGROUND"]) {
      const value = option(`--${key.toLowerCase().replaceAll("_", "-")}`);
      if (value) inTree(convexBin(), ["env", "set", key, value]);
    }
    const appOrigin = `http://localhost:${port}`;
    setSecret("BETTER_AUTH_SECRET", crypto.randomBytes(32).toString("hex"));
    inTree(convexBin(), ["env", "set", "SITE_URL", appOrigin]);
    inTree(convexBin(), ["env", "set", "BETTER_AUTH_TRUSTED_ORIGINS", appOrigin]);
    log("keys and auth values set; restarting so Node actions see them");
    const before = readyCount(backend.log);
    killGroup(backend.pid);
    await waitGone(backend.pid);
    backend = startBackend();
    state.pids.backend = backend.pid;
    writeState(state);
    await waitReady(backend.log, before);
    assertLocal();

    // A seed admin row lets the invite path run on a blank database.
    const seedFile = path.join(LAB, "seed-users.jsonl");
    fs.writeFileSync(seedFile, JSON.stringify({ email: "lab-seed@example.test", role: "admin", authId: "lab-seed", firstName: "Lab", lastName: "Seed", createdAt: Date.now() }) + "\n");
    inTree(convexBin(), ["import", "--table", "users", "--append", "--format", "jsonLines", "-y", seedFile]);
    fs.rmSync(seedFile);

    log("starting the app");
    const web = spawnLogged("web", "npx", ["vite", "dev", "--host", "localhost", "--port", String(port), "--strictPort"], cleanEnv);
    state.pids.web = web.pid;
    writeState(state);
    let served = false;
    for (let i = 0; i < 180 && !served; i++) {
      served = /ready in/.test(fs.existsSync(web.log) ? fs.readFileSync(web.log, "utf8") : "");
      if (!served) {
        try {
          process.kill(web.pid, 0);
        } catch {
          throw new Error(`The app stopped before it was ready:\n${tail(web.log)}`);
        }
        await sleep(1000);
      }
    }
    if (!served) throw new Error(`The app was not ready after 3 minutes:\n${tail(web.log)}`);
    assertLocal();

    const people = { admin: ["Avery", "Admin"], manager: ["Morgan", "Manager"], writer: ["Wren", "Writer"] };
    const seedIdentity = JSON.stringify({ subject: "lab-seed", issuer: "banhall-lab", tokenIdentifier: "banhall-lab|lab-seed" });
    for (const role of ROLES) {
      const email = `lab-${role}@example.test`;
      const [invite] = JSON.parse(inTree(convexBin(), ["run", "invites:createInvites", JSON.stringify({ emails: [email], role }), "--identity", seedIdentity]));
      if (!invite?.token) throw new Error(`Inviting ${role} failed: ${JSON.stringify(invite)}`);
      inTree(convexBin(), ["run", "invites:confirmInviteNames", JSON.stringify({ token: invite.token, firstName: people[role][0], lastName: people[role][1] })]);
      const password = `${crypto.randomBytes(15).toString("base64url")}Aa1`;
      const response = await fetch(`${appOrigin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: appOrigin },
        body: JSON.stringify({ email, password, name: people[role].join(" "), inviteToken: invite.token }),
      });
      if (!response.ok) throw new Error(`Sign-up for ${role} failed: ${response.status} ${await response.text()}`);
      const actor = JSON.parse(inTree(convexBin(), ["run", "seedPlanEval:evalActor", JSON.stringify({ email })]));
      if (!actor) throw new Error(`The ${role} login has no user row.`);
      state.accounts[role] = { email, password, authId: actor.authId, userId: actor.userId, name: people[role].join(" ") };
      writeState(state);
    }
    // Home (My work) needs its readiness setting on a blank database.
    try {
      inTree(convexBin(), ["run", "myWorkBackfill:runInternal", JSON.stringify({ dryRun: false, runKey: `lab-${Date.now()}` })]);
      await sleep(3000);
      inTree(convexBin(), ["run", "appSettings:setMyWorkRolloutInternal", JSON.stringify({ killSwitch: false, defaultView: "my_work", ready: true, adminId: state.accounts.admin.userId })]);
    } catch (error) {
      log(`note: Home readiness not set (${String(error.message).split("\n")[0]}); Projects still works`);
    }

    state.ready = true;
    state.appUrl = appOrigin;
    writeState(state);
    out({ ok: true, appUrl: appOrigin, target: target.slice(0, 8), capUsd, logins: Object.fromEntries(ROLES.map((r) => [r, state.accounts[r].email])), passwords: `in ${STATE} (mode 600)` });
  } catch (error) {
    log(`up failed: ${error.message}`);
    log("cleaning up");
    await down(true);
    process.exitCode = 1;
  }
}

async function down(quiet = false) {
  const state = readState();
  if (!state) {
    if (!quiet) out({ ok: true, removed: null, note: `no lab in ${LAB}` });
    return;
  }
  for (const pid of Object.values(state?.pids ?? {})) killGroup(pid);
  for (const pid of Object.values(state?.pids ?? {})) await waitGone(pid);
  try {
    execFileSync("git", ["worktree", "remove", "--force", TREE], { cwd: REPO, stdio: "ignore" });
  } catch {
    // never made, or removed below
  }
  fs.rmSync(LAB, { recursive: true, force: true });
  try {
    execFileSync("git", ["worktree", "prune"], { cwd: REPO, stdio: "ignore" });
  } catch {
    // nothing to prune
  }
  if (fs.existsSync(LAB)) {
    console.error(`[lab] CLEANUP INCOMPLETE: delete ${LAB} by hand.`);
    process.exitCode = 1;
  } else if (!quiet) {
    out({ ok: true, removed: LAB });
  }
}

// ------------------------------------------------------------- project work

async function createProject(state) {
  const sourceFile = option("--source");
  if (!sourceFile) throw new Error("Pass --source <text file> with the interview or written answers (fictional only).");
  const content = fs.readFileSync(sourceFile, "utf8");
  const as = option("--as", "writer");
  const rawTitle = option("--title", path.basename(sourceFile).replace(/\.[^.]+$/, ""));
  const title = rawTitle.startsWith(PREFIX) ? rawTitle : `${PREFIX}${rawTitle}`;
  const args = {
    title,
    clientName: option("--client", "Fictional Client Ltd."),
    industry: option("--industry", "Manufacturing"),
    interviewees: option("--interviewee") ? [option("--interviewee")] : [],
    transcripts: [{ content, label: option("--label", "Interview") }],
  };
  if (option("--fiscal-year-end")) args.fiscalYearEnd = Date.parse(option("--fiscal-year-end"));
  const created = call("projects:createProject", args, as, state);
  call("seedPlanEval:markEvaluationProject", { projectId: created.projectId });
  out({ projectId: created.projectId, title });
}

async function waitForDraft(state, projectId, generationId) {
  const started = Date.now();
  const timeoutMs = Number(option("--timeout-min", "40")) * 60_000;
  let last = "";
  for (;;) {
    const p = call("seedPlanEval:progress", { generationId });
    const line = `${p.status} seeds=${p.seedSubsections} inputs=${p.draftingInputs ?? "-"} report=${p.reportId ? "yes" : "no"}`;
    if (line !== last) log(`[${Math.round((Date.now() - started) / 1000)}s] ${line}`);
    last = line;
    if (["failed", "cancelled", "awaiting_selection"].includes(p.status) || p.reportGeneratedAt) return p;
    if (p.candidateMode === "iterative" && p.seedSubsections > 0 && !p.reportId && flag("--until-seeds")) return p;
    try {
      requireUnderCap(state);
    } catch (error) {
      if (p.candidateMode === "iterative") {
        call("generations:cancelIterativeGeneration", { generationId }, option("--as", "writer"), state);
        throw new Error(`${error.message} The Step by step draft was cancelled.`);
      }
      throw new Error(`${error.message} A Single or Compare draft cannot be stopped; it runs to the end.`);
    }
    if (Date.now() - started > timeoutMs) return { ...p, timedOut: true };
    await sleep(15_000);
  }
}

async function draft(state) {
  const projectId = positional[0];
  if (!projectId) throw new Error("Pass the projectId.");
  requireUnderCap(state);
  const args = { projectId, candidateMode: option("--mode", "single") };
  const web = option("--web-background");
  if (web) {
    if (!["on", "off"].includes(web)) throw new Error("--web-background takes on or off.");
    args.webBackground = web === "on";
  }
  if (option("--model")) args.singleModelId = option("--model");
  if (option("--compare-models")) args.compareModelIds = option("--compare-models").split(",");
  if (flag("--confirm-regeneration")) args.confirmRegeneration = true;
  call("generations:requestGeneration", args, option("--as", "writer"), state);
  let generationId = null;
  for (let i = 0; i < 60 && !generationId; i++) {
    generationId = call("seedPlanEval:latestGeneration", { projectId })?.generationId ?? null;
    if (!generationId) await sleep(2000);
  }
  log(`generation ${generationId}`);
  if (flag("--no-wait")) return out({ generationId });
  const progress = await waitForDraft(state, projectId, generationId);
  out({ generationId, ...progress, spentUsd: spend().totalUsd });
}

async function waitCommand(state) {
  const projectId = positional[0];
  const generationId = call("seedPlanEval:latestGeneration", { projectId })?.generationId;
  if (!generationId) throw new Error("No draft on that project.");
  out({ generationId, ...(await waitForDraft(state, projectId, generationId)), spentUsd: spend().totalUsd });
}

function latestReport(projectId, state) {
  return call("reports:getLatestReport", { projectId }, option("--as", "writer"), state);
}

/** The report's editor JSON as plain text: headings, paragraphs, list items marked "LIST:". */
export function docText(content) {
  let doc;
  try {
    doc = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return String(content);
  }
  const inline = (node) => (node.text ?? "") + (node.content ?? []).map(inline).join("") + (node.type === "hardBreak" ? "\n" : "");
  const blocks = [];
  const walk = (node, inList = false) => {
    if (node.type === "heading") blocks.push(`${"#".repeat(node.attrs?.level ?? 1)} ${inline(node)}`);
    else if (node.type === "paragraph") blocks.push(inList ? `LIST: ${inline(node)}` : inline(node));
    else if (node.type === "horizontalRule") blocks.push("---");
    else for (const child of node.content ?? []) walk(child, inList || /list/i.test(node.type ?? ""));
  };
  walk(doc);
  return blocks.join("\n\n");
}

function report(state) {
  const projectId = positional[0];
  const r = latestReport(projectId, state);
  if (!r) throw new Error("No report on that project yet.");
  if (flag("--json")) return out(r);
  out(`report ${r._id} revision ${r.revisionNumber ?? 0}\n\n${docText(r.content)}`);
}

function candidates() {
  const projectId = positional[0];
  if (!/^[a-z0-9]+$/.test(projectId ?? "")) throw new Error("Pass the projectId.");
  const rows = inlineQuery(`return (await ctx.db.query('reportCandidates').withIndex('by_projectId', q => q.eq('projectId', '${projectId}')).collect()).map(c => ({ id: c._id, model: c.model, label: c.label, content: c.content }));`);
  if (!rows.length) throw new Error("No Compare drafts waiting on that project.");
  out(rows.map((c) => `===== ${c.label} (${c.model}) ${c.id}\n\n${docText(c.content)}`).join("\n\n"));
}

async function exportCheck(state) {
  const projectId = positional[0];
  const as = option("--as", "writer");
  const r = latestReport(projectId, state);
  if (!r) throw new Error("No report on that project yet.");
  const { content: _content, ...preflight } = call("reports:preflightExport", { reportId: r._id }, as, state);
  const contentHash = crypto.createHash("sha256").update(r.content, "utf8").digest("hex");
  try {
    call("reports:authorizeExport", { reportId: r._id, expectedRevisionNumber: r.revisionNumber ?? 0, expectedContentHash: contentHash }, as, state);
    out({ exportAllowed: true, preflight });
  } catch (error) {
    const reason = (String(error.message).match(/"message":"((?:[^"\\]|\\.)*)"/) ?? [])[1] ?? error.message;
    out({ exportAllowed: false, reason: reason.replace(/\\"/g, '"'), preflight });
  }
}

async function chat(state) {
  const projectId = positional[0];
  const message = positional[1];
  if (!projectId || !message) throw new Error('Pass the projectId and the message: chat <projectId> "<message>"');
  requireUnderCap(state);
  const as = option("--as", "writer");
  const r = latestReport(projectId, state);
  if (!r) throw new Error("No report on that project yet.");
  const args = { reportId: r._id, content: message };
  if (option("--thread")) args.threadId = option("--thread");
  if (flag("--new-thread")) args.newThread = true;
  if (flag("--web")) args.allowWeb = true;
  const sent = call("chatV2:sendMessage", args, as, state);
  const threadId = sent.threadId;
  log(`thread ${threadId}`);
  const started = Date.now();
  let reply = null;
  let settled = 0;
  for (;;) {
    await sleep(5000);
    const page = call("chatV2:listMessages", { threadId, paginationOpts: { numItems: 30, cursor: null } }, as, state);
    const messages = page?.page ?? [];
    const lastOrder = Math.max(-1, ...messages.map((m) => m.order ?? 0));
    const turn = messages.filter((m) => (m.order ?? 0) === lastOrder);
    const replies = turn.filter((m) => (m.stepOrder ?? 0) > 0).sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));
    const texts = replies.map((m) => (m.text ?? "").trim()).filter(Boolean);
    const question = replies.flatMap((m) => m.parts ?? []).find((part) => part.type === "tool-askWriter" && part.input?.question);
    const done = turn.length && !turn.some((m) => m.status === "pending") && replies.length;
    settled = done ? settled + 1 : 0;
    if (done && (texts.length || question || settled >= 3)) {
      reply = [...texts, ...(question ? [`ASKS THE WRITER: ${question.input.question} Options: ${question.input.options.join(" | ")}`] : [])].join("\n\n") || "(no text; see the cards)";
      break;
    }
    if (Date.now() - started > 8 * 60_000) {
      reply = "(timed out waiting for the reply)";
      break;
    }
  }
  let proposals = [];
  try {
    proposals = (call("chatV2:listProposals", { threadId }, as, state) ?? []).map((p) => ({
      id: p._id, state: p.state, kind: p.kind, section: p.section, rulesBroken: p.rulesBroken ?? null,
      targetText: p.targetText, newText: p.newText, options: (p.alternatives ?? []).length,
      // Every text the card could put in the report: Option 1, its passages and Options 2 and 3.
      texts: [p.newText, ...(p.replacements ?? []).map((r) => r.replaceWith), ...(p.alternatives ?? []).flatMap((a) => a.replacements.map((r) => r.replaceWith))].filter((t) => typeof t === "string"),
    }));
  } catch (error) {
    proposals = [{ error: error.message }];
  }
  out({ threadId, reply, proposals, spentUsd: spend().totalUsd });
}

// ------------------------------------------------------------------- main

const HELP = `Banhall lab: a private local copy of the app for agents and people.

  up [--target REF] [--port 5190] [--cap 10] [--key-source DIR] [--draft-web-background on|off]
  status                         logins, URL, spend, cap
  down                           stop and delete everything
  cap <usd>                      change the spend cap
  spend                          AI spend on the lab so far, by call site and model
  run <fn> [jsonArgs] [--as admin|manager|writer]   any Convex function (no --as: internal, CLI level)
  query "<code>"                 a read-only inline query, e.g. "return await ctx.db.query('projects').take(5)"
  project --source FILE [--title T] [--client C] [--interviewee N] [--industry I] [--as writer]
  draft <projectId> [--mode single|compare|iterative] [--web-background on|off] [--model ID] [--compare-models a,b]
        [--confirm-regeneration] [--no-wait] [--until-seeds] [--as writer]
  wait <projectId>               wait for the latest draft
  report <projectId> [--json]    the latest report text
  candidates <projectId>         the Compare drafts waiting for a pick
  chat <projectId> "<message>" [--thread ID] [--new-thread] [--web] [--as writer]
  export-check <projectId> [--as writer]   whether export is allowed, and why not (when allowed, it
                                 records an authorized export on the lab, as the app's Export does)

Fictional data only. Lab folder: ${LAB}`;

try {
  switch (command) {
    case "up": await up(); break;
    case "down": await down(); break;
    case "status": {
      const state = readState();
      if (!state) { out({ up: false }); break; }
      const alive = Object.fromEntries(Object.entries(state.pids).map(([k, pid]) => { try { process.kill(pid, 0); return [k, true]; } catch { return [k, false]; } }));
      out({ up: state.ready, appUrl: state.appUrl, target: state.target?.slice(0, 8), capUsd: state.capUsd, processes: alive,
        logins: Object.fromEntries(Object.entries(state.accounts).map(([r, a]) => [r, { email: a.email, password: a.password }])),
        spentUsd: state.ready ? spend().totalUsd : null, logs: LAB });
      break;
    }
    case "cap": { const state = requireState(); state.capUsd = Number(positional[0]); if (!(state.capUsd > 0 && state.capUsd <= 100)) throw new Error("cap takes dollars from 0 to 100"); writeState(state); out({ capUsd: state.capUsd }); break; }
    case "spend": requireState(); out(spend()); break;
    case "run": { const state = requireState(); if (PAID_FUNCTIONS.test(positional[0] ?? "")) requireUnderCap(state); out(call(positional[0], positional[1] ? JSON.parse(positional[1]) : {}, option("--as", null), state)); break; }
    case "query": requireState(); out(inlineQuery(positional[0])); break;
    case "project": await createProject(requireState()); break;
    case "draft": await draft(requireState()); break;
    case "wait": await waitCommand(requireState()); break;
    case "report": report(requireState()); break;
    case "chat": await chat(requireState()); break;
    case "candidates": requireState(); candidates(); break;
    case "export-check": await exportCheck(requireState()); break;
    default: console.log(HELP);
  }
} catch (error) {
  console.error(`[lab] ${error.message}`);
  process.exitCode = 1;
}

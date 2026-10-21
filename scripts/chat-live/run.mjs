// Opt-in, billable live browser test of the report chat on localhost. See
// scripts/chat-live/README.md. Read-only against the source deployment: it
// exports a snapshot and reads two API keys, and writes nothing there.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScenarios } from "./scenarios.mjs";
import { fictionalPdf, fictionalPng } from "./fixtures.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(name);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectId = option("--project");
if (!projectId) throw new Error("Pass --project <projectId> (a project in the snapshot with a report).");
const port = Number(option("--port", "5180"));
if (port === 3001) throw new Error("Port 3001 belongs to the shared dev server; pick another.");
const team = option("--team", "conquerthecrowns");
const convexProject = option("--convex-project", "banhall-e2e");
const only = option("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const keep = flag("--keep-artifacts");

const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const target = git("rev-parse", "--short", option("--target", "HEAD"));
const base = option("--base")
  ? git("rev-parse", "--short", option("--base"))
  : git("merge-base", target, "origin/main").slice(0, 8);

const sourceDeployment = (fs.readFileSync(path.join(repo, ".env.local"), "utf8").match(/^CONVEX_DEPLOYMENT=([^\s#]+)/m) ?? [])[1] ?? "";
if (!sourceDeployment) throw new Error("This checkout has no CONVEX_DEPLOYMENT in .env.local to read the snapshot from.");
if (sourceDeployment.startsWith("prod:") && !flag("--allow-prod-source")) {
  throw new Error("The source is a production deployment; pass --allow-prod-source to read from it.");
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "banhall-chat-live-"));
fs.chmodSync(work, 0o700);
const tree = path.join(work, "tree");
const shots = path.join(work, "shots");
fs.mkdirSync(shots);
const log = (...a) => console.log(`[chat-live] ${a.join(" ")}`);
const children = [];

/** A command in the temporary worktree, which talks to the local backend only. */
function local(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { cwd: tree, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts });
}

function assertLocalDeployment() {
  const env = fs.readFileSync(path.join(tree, ".env.local"), "utf8");
  if (!/^CONVEX_DEPLOYMENT=local:/m.test(env)) throw new Error("The worktree is not on a local deployment; refusing to continue.");
}

function startBackend(logName) {
  const out = fs.openSync(path.join(work, logName), "w");
  const child = spawn(
    "npx",
    ["convex", "dev", "--configure", "existing", "--team", team, "--project", convexProject, "--dev-deployment", "local", "--typecheck", "disable"],
    {
      cwd: tree,
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        DATABASE_UDF_USER_TIMEOUT_SECONDS: "10",
        DATABASE_UDF_SYSTEM_TIMEOUT_SECONDS: "60",
        CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: "180",
      },
    }
  );
  children.push(child);
  return { child, log: path.join(work, logName) };
}

async function waitForReady(logPath, after = 0, timeoutMs = 300_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    if ((text.match(/Convex functions ready/g) ?? []).length > after) return;
    if (/✖/.test(text.split("Convex functions ready").at(-1) ?? "")) throw new Error(`Local backend failed; see ${logPath}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for the local backend (${logPath}).`);
}

const readyCount = (logPath) => (fs.readFileSync(logPath, "utf8").match(/Convex functions ready/g) ?? []).length;

function stop(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

async function stopAndWait(child) {
  stop(child);
  for (let i = 0; i < 30; i++) {
    try {
      process.kill(-child.pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const run = (fn, fnArgs, authId) =>
  JSON.parse(
    local("npx", ["convex", "run", fn, JSON.stringify(fnArgs), ...(authId ? ["--identity", JSON.stringify({ subject: authId })] : [])]) || "null"
  );

const data = (table, component) => {
  const out = local("npx", ["convex", "data", table, "--limit", "2000", "--format", "jsonLines", ...(component ? ["--component", component] : [])], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l));
};

let failed = false;
let cleaned = false;

/** Stops everything and deletes the worktree and the private folder. */
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const child of children) stop(child);
  await new Promise((r) => setTimeout(r, 3000));
  try {
    git("worktree", "remove", "--force", tree);
  } catch {
    // never created, or removed below
  }
  if (fs.existsSync(tree)) fs.rmSync(tree, { recursive: true, force: true });
  try {
    git("worktree", "prune");
  } catch {
    // nothing to prune
  }
  if (keep) {
    for (const entry of fs.readdirSync(work)) {
      if (!["shots", "report.json"].includes(entry)) fs.rmSync(path.join(work, entry), { recursive: true, force: true });
    }
    log(`kept screenshots and the report in ${work}; they hold client data, delete them when done`);
  } else {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (fs.existsSync(tree) || (!keep && fs.existsSync(work))) {
    console.error(`[chat-live] CLEANUP INCOMPLETE: delete ${fs.existsSync(tree) ? tree : work} by hand; it holds client data.`);
    failed = true;
  } else if (!keep) {
    log("deleted the worktree, the snapshot, screenshots and credentials");
  }
}

// An interrupted run cleans up too: the backend and the snapshot hold client data.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    console.error(`[chat-live] ${signal}: stopping and cleaning up`);
    cleanup().finally(() => process.exit(130));
  });
}

try {
  log(`target ${target}, base ${base}, source ${sourceDeployment.split(":")[0]}, work dir ${work}`);

  // 1. Snapshot (read-only on the source).
  const snapshot = option("--snapshot") ?? path.join(work, "snapshot.zip");
  if (!option("--snapshot")) {
    log("exporting a snapshot from the source deployment (read-only)");
    execFileSync("npx", ["convex", "export", "--path", snapshot], { cwd: repo, stdio: "ignore" });
  }

  // 2. Worktree on the base commit.
  git("worktree", "add", "--detach", tree, base);
  log("installing dependencies in the worktree");
  local("npm", ["ci", "--no-audit", "--no-fund"], { stdio: "ignore" });

  // 3. Local backend on the base, import, then the target.
  let backend = startBackend("backend-1.log");
  await waitForReady(backend.log);
  assertLocalDeployment();
  log("importing the snapshot into the local backend");
  try {
    local("npx", ["convex", "import", "--replace-all", "-y", snapshot]);
  } catch (error) {
    throw new Error(
      `The snapshot did not import onto base ${base}. Pass --base with a commit whose tables the snapshot has ` +
        `(for example the commit the source deployment runs). ${String(error).split("\n").slice(-3).join(" ")}`
    );
  }
  const pushedBefore = readyCount(backend.log);
  // `convex dev` regenerates convex/_generated on the base; the target brings
  // its own, so the switch discards those local changes.
  local("git", ["checkout", "-q", "--force", "--detach", target]);
  await waitForReady(backend.log, pushedBefore);
  log("target code pushed");

  // 4. Keys (copied, never printed), local auth values, fresh auth keys.
  // A failed command's error message repeats its arguments, so a secret is
  // set through setSecret, which replaces any error with a plain one.
  const setSecret = (key, value) => {
    try {
      local("npx", ["convex", "env", "set", key, value]);
    } catch {
      throw new Error(`Setting ${key} on the local backend failed.`);
    }
  };
  for (const key of ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"]) {
    let value = "";
    try {
      value = execFileSync("npx", ["convex", "env", "get", key], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      throw new Error(`Reading ${key} from the source deployment failed.`);
    }
    if (!value) throw new Error(`${key} is not set on the source deployment.`);
    setSecret(key, value);
  }
  setSecret("BETTER_AUTH_SECRET", crypto.randomBytes(32).toString("hex"));
  local("npx", ["convex", "env", "set", "SITE_URL", `http://localhost:${port}`]);
  local("npx", ["convex", "env", "set", "BETTER_AUTH_TRUSTED_ORIGINS", `http://localhost:${port}`]);
  const emptyFile = path.join(work, "empty.jsonl");
  fs.writeFileSync(emptyFile, "");
  local("npx", ["convex", "import", "--component", "betterAuth", "--table", "jwks", "--replace", "--format", "jsonLines", "-y", emptyFile], { stdio: "ignore" });
  log("keys and local auth values set");

  // 5. Restart, so Node actions start with every value set above.
  await stopAndWait(backend.child);
  backend = startBackend("backend-2.log");
  await waitForReady(backend.log);
  assertLocalDeployment();
  log("local backend restarted with its environment");

  // 6. A throwaway admin account through the invite and sign-up path.
  const users = data("users");
  const admin = users.find((u) => u.role === "admin" && u.authId);
  if (!admin) throw new Error("The snapshot has no admin user to send the invite.");
  const email = `chat-live-${Date.now()}@example.test`;
  const [invite] = run("invites:createInvites", { emails: [email], role: "admin" }, admin.authId);
  run("invites:confirmInviteNames", { token: invite.token, firstName: "Live", lastName: "Tester" });
  const password = `${crypto.randomBytes(18).toString("base64url")}Aa1`;

  // 7. The app on localhost.
  const webLog = fs.openSync(path.join(work, "web.log"), "w");
  const web = spawn("npx", ["vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: tree,
    detached: true,
    stdio: ["ignore", webLog, webLog],
  });
  children.push(web);
  for (let i = 0; i < 120; i++) {
    if (/ready in/.test(fs.readFileSync(path.join(work, "web.log"), "utf8"))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const signUp = await fetch(`http://localhost:${port}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: `http://localhost:${port}` },
    body: JSON.stringify({ email, password, name: "Live Tester", inviteToken: invite.token }),
  });
  if (!signUp.ok) throw new Error(`Sign-up failed: ${signUp.status}`);
  const me = data("users").find((u) => u.email === email);
  log("test account ready");

  // 8. The Node action sees the keys: one real web search before any scenario.
  const probe = run("ai/chatWebSearchNode:searchWebForChat", {
    query: "SR&ED experimental development definition",
    projectId,
    userId: me._id,
    timeoutMs: 60_000,
  });
  if (probe?.status !== "ok") throw new Error("Web search did not work through the Node action after the restart.");
  log("web search works through the Node action");

  // 9. Fictional files for viewing and pinning, uploaded the app's way.
  const fixtures = [
    { name: "chat-live-chart.png", type: "image", mime: "image/png", bytes: fictionalPng(), text: "" },
    { name: "chat-live-log.pdf", type: "pdf", mime: "application/pdf", bytes: fictionalPdf(), text: "Fictional trial log. Page 1. Page 2." },
  ];
  for (const file of fixtures) {
    const url = run("documents:generateUploadUrl", {}, me.authId);
    const posted = await fetch(url, { method: "POST", headers: { "Content-Type": file.mime }, body: file.bytes });
    const { storageId } = await posted.json();
    run("documents:claimUpload", { storageId }, me.authId);
    run("documents:uploadDocument", {
      projectId, fileName: file.name, fileType: file.type, content: file.text, source: "context_input",
      storageId, mimeType: file.mime, category: "other", extractionOutcome: "ok", intake: "file",
    }, me.authId);
  }

  // 10. The scenarios.
  const project = data("projects").find((p) => p._id === projectId);
  if (!project) throw new Error("--project is not in the snapshot.");
  const report = data("reports").filter((r) => r.projectId === projectId).sort((a, b) => b._creationTime - a._creationTime)[0];
  const other = users.find((u) => u.authId && u._id !== me._id && ["writer", "manager"].includes(u.role));
  const results = await runScenarios({
    base: `http://localhost:${port}`,
    email,
    password,
    projectId,
    reportId: report._id,
    shots,
    only,
    run,
    me,
    other,
    backendLog: backend.log,
  });
  fs.writeFileSync(path.join(work, "report.json"), JSON.stringify(results, null, 2));
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
  failed = results.some((r) => !r.ok);
} catch (error) {
  failed = true;
  console.error(`[chat-live] ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await cleanup();
  process.exit(failed ? 1 : 0);
}

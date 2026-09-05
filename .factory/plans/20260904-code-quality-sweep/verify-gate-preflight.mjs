// Audit runner: execute the real gate from cwd. No gate or dependency code is copied.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

const cwd = fs.realpathSync(process.cwd());
const sourcePath = path.join(cwd, "scripts/loop-verify.sh");
const auditRoot = path.join(cwd, ".audit/dx-1-one-verify-entry");
const timeoutMs = 15_000;
const killGraceMs = 500;
const outputLimit = 512_000;
const sourceHash = () => createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
let stopProbe;
let interrupted;
const onInterrupt = (signal) => { interrupted = signal; stopProbe?.(signal); };
const onSigint = () => onInterrupt("SIGINT");
const onSigterm = () => onInterrupt("SIGTERM");

// Keep PATH directories separate and ordered: flattening can collide on command
// names differing only by case. Symlinks preserve targets without shell wrappers.
function executableDirectories() {
  const directories = [];
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    const directory = path.resolve(cwd, entry || ".");
    let names;
    try { names = fs.readdirSync(directory); }
    catch (error) {
      if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) continue;
      throw error;
    }
    const executables = [];
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        executables.push([name, candidate]);
      } catch (error) {
        if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(error.code)) throw error;
      }
    }
    directories.push({ directory, executables });
  }
  return directories;
}

async function runProbe(name, bash, env) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = { name, startedAt, command: [bash, "--noprofile", "--norc", sourcePath], stdout: "", stderr: "" };
  const child = spawn(bash, result.command.slice(1), { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let timeout;
  let killTimer;
  let finishTimer;
  let finish;
  const killGroup = (signal) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") result.cleanupError = error.message; }
  };
  const stop = (reason) => {
    if (result.stoppedBecause) return;
    result.stoppedBecause = reason;
    killGroup("SIGTERM");
    killTimer = setTimeout(() => killGroup("SIGKILL"), killGraceMs);
    // Bound completion even if an unexpected descendant keeps a pipe open.
    finishTimer = setTimeout(() => {
      killGroup("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      result.closeDeadlineExceeded = true;
      finish();
    }, killGraceMs + 1_000);
  };
  stopProbe = stop;
  const capture = (stream) => (data) => {
    result[stream] += data.toString();
    if (result.stdout.length + result.stderr.length > outputLimit) {
      result[stream] = result[stream].slice(0, outputLimit / 2);
      stop("output-limit");
    }
  };
  child.stdout.on("data", capture("stdout"));
  child.stderr.on("data", capture("stderr"));
  try {
    await new Promise((resolve) => {
      finish = resolve;
      child.on("error", (error) => { result.spawnError = error.message; resolve(); });
      child.on("close", (code, signal) => { result.exitCode = code; result.signal = signal; resolve(); });
      timeout = setTimeout(() => stop("timeout"), timeoutMs);
      if (interrupted) stop(interrupted);
    });
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    clearTimeout(finishTimer);
    // Kill the owned process group even when its leader already exited.
    // This covers descendants that outlive bash; no process-name kill is used.
    killGroup("SIGKILL");
    stopProbe = undefined;
    result.durationMs = Number((performance.now() - started).toFixed(3));
  }
  return result;
}

function checkProbe(result, missing) {
  const output = `${result.stdout}\n${result.stderr}`;
  const numbered = [...output.matchAll(/^\s*\[(\d+)\/(\d+)\]\s*(.*)$/gm)];
  const tool = missing === "pwsh" ? /\bpwsh\b/i : /\bChromium\b/i;
  const hint = missing === "pwsh"
    ? /\binstall\b[^\r\n]*(?:PowerShell|pwsh)|https:\/\/(?:learn\.microsoft\.com|aka\.ms)\/\S*powershell/i
    : /npx\s+playwright\s+install(?:\s+--with-deps)?\s+chromium/i;
  result.checks = {
    exitedOne: result.exitCode === 1 && !result.signal,
    boundedCleanExit: !result.spawnError && !result.stoppedBecause && !result.cleanupError && !result.closeDeadlineExceeded,
    preflightStepOne: numbered.length > 0 && numbered[0][1] === "1" && /\bpreflight\b/i.test(numbered[0][3]),
    noLaterStep: numbered.length === 1,
    namesMissingTool: output.split(/\r?\n/).some((line) => tool.test(line) && /missing|absent|unavailable|does not exist|not (?:found|installed|available)|cannot find|required/i.test(line)),
    installHint: hint.test(output),
    noTypecheckOutput: !/svelte-check|svelte-kit\s+sync|(?:^|\s)(?:npx\s+)?tsc(?:\s|$)|^\s*>.*(?:run check|vitest|vite build)/im.test(output),
  };
  result.passed = Object.values(result.checks).every(Boolean);
}

// Fault injection only: real node/npm/pwsh stay on PATH. No compiler is launched.
function failureShimSource(invocationLog, expectedCwd) {
  return `#!/usr/bin/env node
import fs from "node:fs";
const log = ${JSON.stringify(invocationLog)};
const args = process.argv.slice(2);
const first = !fs.existsSync(log);
const expected = process.cwd() === ${JSON.stringify(expectedCwd)} && JSON.stringify(args) === JSON.stringify(["tsc", "-p", "convex/tsconfig.json", "--noEmit"]);
const exitCode = first && expected ? 37 : 97;
fs.appendFileSync(log, JSON.stringify({ args, cwd: process.cwd(), first, expected, exitCode }) + "\\n");
process.exit(exitCode);
`;
}

function checkFailurePropagation(result, invocations, expectedCwd) {
  const output = `${result.stdout}\n${result.stderr}`;
  const numbered = [...output.matchAll(/^\s*\[(\d+)\/(\d+)\]\s*(.*)$/gm)];
  const label = numbered[1]?.[3].trim() ?? "";
  const first = invocations[0];
  result.injectedCommand = { args: ["tsc", "-p", "convex/tsconfig.json", "--noEmit"], exitCode: 37, unexpectedExitCode: 97 };
  result.invocations = invocations;
  result.checks = {
    propagatedExit37: result.exitCode === 37 && !result.signal,
    boundedCleanExit: !result.spawnError && !result.stoppedBecause && !result.cleanupError && !result.closeDeadlineExceeded,
    preflightStepOne: numbered[0]?.[1] === "1" && /\bpreflight\b/i.test(numbered[0]?.[3] ?? ""),
    convexStepTwo: numbered[1]?.[1] === "2" && /\b(?:convex|tsc)\b/i.test(label),
    noSubsequentStep: numbered.length === 2,
    namesFailingStep: label.length > 0 && output.split(/\r?\n/).some((line) => !/^\s*\[\d+\/\d+\]/.test(line) && /fail|error|exit(?:ed)?|nonzero/i.test(line) && line.toLowerCase().includes(label.toLowerCase())),
    oneExpectedInvocation: invocations.length === 1 && first.first === true && first.expected === true && first.exitCode === 37 && first.cwd === expectedCwd && JSON.stringify(first.args) === JSON.stringify(result.injectedCommand.args),
    noSubsequentToolOutput: !/svelte-check|svelte-kit\s+sync|^\s*>.*(?:run check|vitest|vite build)/im.test(output),
  };
  result.passed = Object.values(result.checks).every(Boolean);
}

fs.mkdirSync(auditRoot, { recursive: true });
const evidenceDir = fs.mkdtempSync(path.join(auditRoot, "preflight-run-"));
const fixtureDir = path.join(evidenceDir, "fixtures");
const report = { kind: "real_gate_preflight_probes", cwd, node: process.version, source: "scripts/loop-verify.sh", timeoutMs, killGraceMs, probes: [] };
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);
try {
  if (process.platform === "win32") throw new Error("This POSIX gate probe requires process groups and executable symlinks.");
  report.commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", timeout: 5_000 }).trim();
  report.sourceSha256 = sourceHash();
  if (!fs.existsSync(path.join(cwd, "node_modules/.bin/tsc")) || !fs.existsSync(path.join(cwd, "node_modules/playwright/package.json"))) {
    throw new Error("Run the default gate first: this probe requires installed local dependencies and never installs them.");
  }
  const directories = executableDirectories();
  const executables = new Map();
  for (const tool of ["bash", "node", "npm", "npx", "pwsh"]) {
    // Lookup the requested name through the host filesystem, preserving its case rules.
    const entry = directories.find(({ directory }) => {
      try {
        const candidate = path.join(directory, tool);
        fs.accessSync(candidate, fs.constants.X_OK);
        return fs.statSync(candidate).isFile();
      } catch { return false; }
    });
    if (!entry) throw new Error(`Host prerequisite missing: ${tool}; each probe must isolate exactly one missing tool.`);
    executables.set(tool, path.join(entry.directory, tool));
  }
  fs.mkdirSync(fixtureDir);
  const withoutPwsh = path.join(fixtureDir, "path-without-pwsh");
  fs.mkdirSync(withoutPwsh);
  const fixturePath = [];
  for (const [index, entry] of directories.entries()) {
    const destination = path.join(withoutPwsh, String(index));
    fs.mkdirSync(destination);
    for (const [name, target] of entry.executables) {
      if (name.toLowerCase() !== "pwsh") fs.symlinkSync(target, path.join(destination, name));
    }
    if (fs.existsSync(path.join(destination, "pwsh"))) throw new Error("pwsh unexpectedly exists in the missing-tool fixture.");
    fixturePath.push(destination);
  }
  const env = { ...process.env, PUBLIC_CONVEX_URL: "https://placeholder.convex.cloud", PUBLIC_CONVEX_SITE_URL: "https://placeholder.convex.site" };
  // Noninteractive bash otherwise honors BASH_ENV and exported shell functions.
  for (const key of Object.keys(env)) {
    if (key === "BASH_ENV" || key === "ENV" || key.startsWith("BASH_FUNC_")) delete env[key];
  }
  const failurePath = path.join(fixtureDir, "path-with-failing-npx");
  fs.mkdirSync(failurePath);
  const invocationLog = path.join(fixtureDir, "npx-invocations.jsonl");
  const shimPath = path.join(failurePath, "fail-first-npx.mjs");
  fs.writeFileSync(shimPath, failureShimSource(invocationLog, cwd), { mode: 0o700 });
  fs.symlinkSync(shimPath, path.join(failurePath, "npx"));
  const probes = [
    { name: "missing-pwsh", missing: "pwsh", env: { ...env, PATH: fixturePath.join(path.delimiter), VERIFY_COMPONENT: "0" } },
    { name: "missing-chromium", missing: "chromium", env: { ...env, VERIFY_COMPONENT: "1", PLAYWRIGHT_BROWSERS_PATH: path.join(fixtureDir, "nonexistent-browser-cache") } },
    { name: "convex-step-exit-37", env: { ...env, PATH: failurePath + path.delimiter + env.PATH, VERIFY_COMPONENT: "0" } },
  ];
  for (const probe of probes) {
    if (interrupted) break;
    const result = await runProbe(probe.name, executables.get("bash"), probe.env);
    report.probes.push(result);
    if (probe.missing) checkProbe(result, probe.missing);
    else {
      const invocations = fs.existsSync(invocationLog) ? fs.readFileSync(invocationLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
      checkFailurePropagation(result, invocations, cwd);
    }
    fs.writeFileSync(path.join(evidenceDir, `${probe.name}.log`), `${JSON.stringify({ ...result, stdout: undefined, stderr: undefined })}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
    console.log(JSON.stringify({ name: result.name, passed: result.passed, exitCode: result.exitCode, durationMs: result.durationMs, checks: result.checks }));
  }
  report.sourceSha256After = sourceHash();
  if (report.sourceSha256After !== report.sourceSha256) throw new Error("The gate source changed during the probes; evidence is inconclusive.");
} catch (error) {
  report.error = error.message;
} finally {
  stopProbe?.("cleanup");
  try { fs.rmSync(fixtureDir, { recursive: true, force: true }); }
  catch (error) { report.cleanupError = error.message; }
  report.fixturesRemoved = !fs.existsSync(fixtureDir);
  report.interrupted = interrupted;
  report.passed = !report.error && !report.cleanupError && !interrupted && report.fixturesRemoved && report.probes.length === 3 && report.probes.every((probe) => probe.passed);
  fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  console.log(JSON.stringify({ passed: report.passed, evidence: path.join(evidenceDir, "report.json"), error: report.error }));
  process.exitCode = interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : report.passed ? 0 : 1;
}

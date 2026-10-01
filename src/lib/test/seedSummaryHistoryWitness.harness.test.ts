/**
 * Harness-level witnesses for `scripts/seed-summary-history-witness.mjs`
 * (stories 5-6, R4-12 / R4-13 / R4-15 / R5-10 / R5-11 / R5-13 / R5-14 /
 * R6-10 / R6-11 / R6-12): output reservation, option validation, startup
 * ownership, readiness that belongs to the invocation's own server,
 * owned-group cleanup, log-stream failure routing and cleanup outcomes
 * (late ownership failures, surviving groups, stalled browser shutdown). These run the real script as a child process with the dev
 * server replaced by controlled stand-ins; no SvelteKit server and no evidence
 * folder are touched (every run reserves its output inside a temporary
 * directory). This suite runs under `npm test`, which never touches a
 * browser: where a run must reach its journey phase, `--stand-in-journey-ms`
 * holds that phase open against the owned server without launching one.
 */
import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../../scripts/seed-summary-history-witness.mjs", import.meta.url));
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const scratch = () => mkdtempSync(join(tmpdir(), "seed-witness-harness-"));

type Run = { status: number | null; stdout: string; stderr: string; elapsedMs: number };

function run(args: string[], evidenceRoot: string, timeoutMs = 25_000, extraEnv: Record<string, string> = {}): Run {
  const started = Date.now();
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, SEED_WITNESS_EVIDENCE_ROOT: evidenceRoot, ...extraEnv },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, elapsedMs: Date.now() - started };
}

/** Runs the script without blocking this process's event loop, so a service
 * living in this test process (a foreign server on the port) keeps answering. */
function runAsync(args: string[], evidenceRoot: string): Promise<Run> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, SEED_WITNESS_EVIDENCE_ROOT: evidenceRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (status) => resolve({ status, stdout, stderr, elapsedMs: Date.now() - started }));
  });
}

const lastJsonLine = (stdout: string) => JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as { out: string; reservation: string };

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function processGone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function untilGone(pid: number, budgetMs = 5000) {
  const deadline = Date.now() + budgetMs;
  while (!processGone(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  return processGone(pid);
}

type Report = {
  journeys: string;
  server: {
    pid: number | null;
    ready: boolean;
    exit: { code: number | null; signal: string | null } | null;
    group: string | null;
    unexpectedExit: { code: number | null; signal: string | null; afterReady: boolean } | null;
    logFailure: string | null;
    ownershipFailures?: string[];
  } | null;
  browserClose?: string;
  failed: number;
  passed: number;
  results: Array<{ host: string; name: string; ok: boolean; detail: unknown }>;
};

const readReport = (out: string): Report => JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
const command = (parts: string[]) => JSON.stringify(parts);
const nodeScript = (source: string) => [process.execPath, "-e", source];

/** A stand-in that answers the witness readiness endpoint with the run token
 * it was spawned with, optionally exiting shortly after answering. */
const tokenServer = (port: number, exitAfterMs: number | null) =>
  nodeScript(
    `const http = require("node:http");
     http.createServer((req, res) => {
       res.setHeader("content-type", "application/json");
       res.end(JSON.stringify({ token: process.env.SEED_WITNESS_RUN_TOKEN ?? null, pid: process.pid }));
       ${exitAfterMs === null ? "" : `setTimeout(() => process.exit(3), ${exitAfterMs});`}
     }).listen(${port}, "127.0.0.1");
     setInterval(() => {}, 1000);`
  );

/** A launcher that spawns a descendant (its pid written to
 * SEED_WITNESS_TEST_PID_FILE) and then either exits at once or lingers; the
 * descendant either honours or ignores SIGTERM. */
const launcher = (options: { exitAtOnce: boolean; descendantIgnoresSigterm: boolean }) =>
  nodeScript(
    `const { spawn } = require("node:child_process");
     const { writeFileSync } = require("node:fs");
     const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(
       options.descendantIgnoresSigterm
         ? "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"
         : "setInterval(() => {}, 1000);"
     )}], { stdio: "ignore" });
     descendant.unref();
     writeFileSync(process.env.SEED_WITNESS_TEST_PID_FILE, String(descendant.pid));
     ${options.exitAtOnce ? "process.exit(0);" : "setInterval(() => {}, 1000);"}`
  );

describe("seed-summary-history-witness harness", () => {
  it("reserves a fresh exclusive output location and never overwrites prior artifacts, including on colliding and simultaneous starts", async () => {
    const root = scratch();

    // A fresh explicit path is reserved exclusively.
    const out = join(root, "witness-out");
    const first = run(["--reserve-only", "--out", out], root);
    expect(first.status).toBe(0);
    expect(lastJsonLine(first.stdout)).toEqual({ out, reservation: "explicit" });
    expect(existsSync(join(out, "reservation.json"))).toBe(true);

    // A repeated invocation of the same path finds it taken: it reserves a
    // fresh run directory inside and leaves the prior artifacts byte-identical.
    const sentinel = join(out, "report.json");
    writeFileSync(sentinel, JSON.stringify({ prior: "evidence" }) + "\n");
    const sentinelHash = sha256(sentinel);
    const reservationHash = sha256(join(out, "reservation.json"));
    const second = run(["--reserve-only", "--out", out], root);
    expect(second.status).toBe(0);
    const secondOut = lastJsonLine(second.stdout);
    expect(secondOut.reservation).toBe("run-directory");
    expect(secondOut.out.startsWith(`${out}${sep}router-witness-`)).toBe(true);
    expect(secondOut.out).not.toBe(out);
    expect(sha256(sentinel)).toBe(sentinelHash);
    expect(sha256(join(out, "reservation.json"))).toBe(reservationHash);

    // Two simultaneous starts on one fresh path: exactly one owns the path,
    // the other gets a distinct run directory, and neither overwrites the other.
    const collision = join(root, "collision-out");
    const [left, right] = await Promise.all([
      runAsync(["--reserve-only", "--out", collision], root),
      runAsync(["--reserve-only", "--out", collision], root),
    ]);
    expect(left.status).toBe(0);
    expect(right.status).toBe(0);
    const leftOut = lastJsonLine(left.stdout);
    const rightOut = lastJsonLine(right.stdout);
    expect(leftOut.out).not.toBe(rightOut.out);
    expect([leftOut.reservation, rightOut.reservation].sort()).toEqual(["explicit", "run-directory"]);
    for (const reserved of [leftOut.out, rightOut.out]) expect(existsSync(join(reserved, "reservation.json"))).toBe(true);

    // Default runs never collide either: each reserves its own run directory.
    const defaultA = run(["--reserve-only"], root);
    const defaultB = run(["--reserve-only"], root);
    expect(defaultA.status).toBe(0);
    expect(defaultB.status).toBe(0);
    expect(lastJsonLine(defaultA.stdout).out).not.toBe(lastJsonLine(defaultB.stdout).out);
    expect(lastJsonLine(defaultA.stdout).out.startsWith(`${root}${sep}router-witness-`)).toBe(true);

    // A path that exists and is not a directory is refused explicitly, untouched.
    const file = join(root, "not-a-directory");
    writeFileSync(file, "keep me\n");
    const fileHash = sha256(file);
    const refused = run(["--reserve-only", "--out", file], root);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("refusing --out");
    expect(sha256(file)).toBe(fileHash);
  }, 30_000);

  it("refuses invalid timeout and port options with a diagnostic before reserving or spawning anything", () => {
    const root = scratch();
    const cases: Array<{ args: string[]; diagnostic: string }> = [
      { args: ["--startup-timeout-ms", "soon"], diagnostic: "--startup-timeout-ms must be a positive integer" },
      { args: ["--startup-timeout-ms", "Infinity"], diagnostic: "--startup-timeout-ms must be a positive integer" },
      { args: ["--startup-timeout-ms", "NaN"], diagnostic: "--startup-timeout-ms must be a positive integer" },
      { args: ["--startup-timeout-ms", "0"], diagnostic: "--startup-timeout-ms must be a positive integer" },
      { args: ["--startup-timeout-ms", "-2500"], diagnostic: "--startup-timeout-ms must be a positive integer" },
      { args: ["--startup-timeout-ms", "1e3"], diagnostic: "--startup-timeout-ms must be a positive integer" },
      { args: ["--startup-timeout-ms", "250.5"], diagnostic: "--startup-timeout-ms must be a positive integer" },
      { args: ["--startup-timeout-ms"], diagnostic: "--startup-timeout-ms must be a positive integer" },
      { args: ["--port", "abc"], diagnostic: "--port must be a positive integer" },
      { args: ["--port", "0"], diagnostic: "--port must be a positive integer" },
      { args: ["--port", "-3107"], diagnostic: "--port must be a positive integer" },
      { args: ["--port", "70000"], diagnostic: "--port must be at most 65535" },
      { args: ["--port", "3107.5"], diagnostic: "--port must be a positive integer" },
      { args: ["--server-command", "not json"], diagnostic: "--server-command must be a JSON array of strings" },
      { args: ["--server-command", "[]"], diagnostic: "--server-command must be a non-empty JSON array" },
      { args: ["--stand-in-journey-ms", "Infinity"], diagnostic: "--stand-in-journey-ms must be a positive integer" },
      { args: ["--stand-in-journey-ms", "0"], diagnostic: "--stand-in-journey-ms must be a positive integer" },
      { args: ["--stand-in-journey-ms"], diagnostic: "--stand-in-journey-ms must be a positive integer" },
      { args: ["--browser-close-timeout-ms", "0"], diagnostic: "--browser-close-timeout-ms must be a positive integer" },
      { args: ["--browser-close-timeout-ms", "Infinity"], diagnostic: "--browser-close-timeout-ms must be a positive integer" },
      { args: ["--stand-in-browser-close-ms", "soon", "--stand-in-journey-ms", "100"], diagnostic: "--stand-in-browser-close-ms must be a positive integer" },
      { args: ["--stand-in-browser-close-ms", "never"], diagnostic: "--stand-in-browser-close-ms requires --stand-in-journey-ms" },
    ];
    for (const [index, { args, diagnostic }] of cases.entries()) {
      const out = join(root, `invalid-${index}`);
      const result = run([...args, "--out", out, "--server-command", command(nodeScript("setInterval(() => {}, 1000)"))].filter(
        // The server-command cases supply their own invalid value.
        (_part, position, all) => !(args[0] === "--server-command" && position >= all.length - 2)
      ), root, 10_000);
      expect(result.status, `${args.join(" ")} should be refused`).toBe(2);
      expect(result.stderr, `${args.join(" ")} diagnostic`).toContain(diagnostic);
      expect(result.elapsedMs).toBeLessThan(5000);
      // Refused before any reservation: no output directory, log or report.
      expect(existsSync(out)).toBe(false);
    }
    // The valid bounded-startup shape still runs (and is covered below).
    const valid = run(["--reserve-only", "--startup-timeout-ms", "2500", "--port", "3107"], root);
    expect(valid.status).toBe(0);
  }, 60_000);

  it("records a spawn failure as a harness failure and owns no process", () => {
    const root = scratch();
    const out = join(root, "spawn-failure");
    const result = run(
      ["--out", out, "--server-command", command(["/nonexistent/banhall-dev-server"]), "--startup-timeout-ms", "5000"],
      root
    );
    expect(result.status).toBe(1);
    const report = readReport(out);
    expect(report.failed).toBe(1);
    expect(report.results).toEqual([
      expect.objectContaining({ host: "harness", name: "run completed", ok: false, detail: expect.stringContaining("could not be spawned") }),
    ]);
    expect(report.server?.pid ?? null).toBeNull();
    expect(existsSync(join(out, "dev-server.log"))).toBe(true);
  }, 30_000);

  it("stops a live child that never becomes ready within the startup budget", async () => {
    const root = scratch();
    const out = join(root, "never-ready");
    const budgetMs = 2500;
    const result = run(
      ["--out", out, "--server-command", command(nodeScript("setInterval(() => {}, 1000)")), "--startup-timeout-ms", String(budgetMs)],
      root
    );
    expect(result.status).toBe(1);
    expect(result.elapsedMs).toBeLessThan(budgetMs + 6000);
    const report = readReport(out);
    expect(report.results).toEqual([
      expect.objectContaining({ host: "harness", name: "run completed", ok: false, detail: expect.stringContaining("did not become ready") }),
    ]);
    expect(report.server?.pid).toBeGreaterThan(0);
    expect(report.server?.exit?.signal).toBe("SIGTERM");
    expect(report.server?.group).toBe("terminated");
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 30_000);

  it("aborts a readiness request the endpoint never answers within the startup budget and cleans up", async () => {
    const root = scratch();
    const out = join(root, "stalled-readiness");
    const port = await freePort();
    const budgetMs = 4000;
    // Accepts every connection and never responds: an unbounded request would
    // hang here for as long as the socket stayed open.
    const stall = `require("node:net").createServer(() => {}).listen(${port}, "127.0.0.1"); setInterval(() => {}, 1000);`;
    const result = run(
      ["--out", out, "--port", String(port), "--server-command", command(nodeScript(stall)), "--startup-timeout-ms", String(budgetMs)],
      root
    );
    expect(result.status).toBe(1);
    expect(result.elapsedMs).toBeLessThan(budgetMs + 6000);
    const report = readReport(out);
    expect(report.results).toEqual([
      expect.objectContaining({ host: "harness", name: "run completed", ok: false, detail: expect.stringContaining("did not become ready") }),
    ]);
    expect(report.server?.pid).toBeGreaterThan(0);
    expect(report.server?.exit?.signal).toBe("SIGTERM");
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 30_000);

  it("terminates an owned descendant that outlives its launcher", async () => {
    // R5-10: the launcher exits at once (an early exit), leaving a descendant
    // in the owned process group; cleanup must assess and terminate the group
    // rather than the direct child's exit.
    const root = scratch();
    const out = join(root, "orphaned-descendant");
    const pidFile = join(root, "descendant.pid");
    const result = run(
      ["--out", out, "--server-command", command(launcher({ exitAtOnce: true, descendantIgnoresSigterm: false })), "--startup-timeout-ms", "5000"],
      root,
      25_000,
      { SEED_WITNESS_TEST_PID_FILE: pidFile }
    );
    expect(result.status).toBe(1);
    const descendantPid = Number(readFileSync(pidFile, "utf8"));
    expect(descendantPid).toBeGreaterThan(0);
    const report = readReport(out);
    expect(report.results).toEqual([
      expect.objectContaining({ host: "harness", name: "run completed", ok: false, detail: expect.stringContaining("exited early") }),
    ]);
    expect(report.server?.exit?.code).toBe(0);
    expect(report.server?.group).toBe("terminated");
    expect(await untilGone(descendantPid)).toBe(true);
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 30_000);

  it("escalates to SIGKILL for a descendant that ignores SIGTERM while its parent exits", async () => {
    // R5-10: the parent honours SIGTERM and exits; its descendant ignores it.
    // Escalation follows the owned group's lifetime, not the parent's exit.
    const root = scratch();
    const out = join(root, "stubborn-descendant");
    const pidFile = join(root, "descendant.pid");
    const budgetMs = 2500;
    const result = run(
      ["--out", out, "--server-command", command(launcher({ exitAtOnce: false, descendantIgnoresSigterm: true })), "--startup-timeout-ms", String(budgetMs)],
      root,
      25_000,
      { SEED_WITNESS_TEST_PID_FILE: pidFile }
    );
    expect(result.status).toBe(1);
    // Startup budget, the SIGTERM grace period, then the kill: bounded.
    expect(result.elapsedMs).toBeLessThan(budgetMs + 3000 + 6000);
    const descendantPid = Number(readFileSync(pidFile, "utf8"));
    expect(descendantPid).toBeGreaterThan(0);
    const report = readReport(out);
    expect(report.results).toEqual([
      expect.objectContaining({ host: "harness", name: "run completed", ok: false, detail: expect.stringContaining("did not become ready") }),
    ]);
    expect(report.server?.exit?.signal).toBe("SIGTERM");
    expect(report.server?.group).toBe("killed");
    expect(await untilGone(descendantPid)).toBe(true);
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 30_000);

  it("routes a log-stream failure while the owned server is alive through recorded failure and group cleanup", async () => {
    // R5-14: the log stream fails after readiness; the run must record the
    // failure, complete within a bound and terminate the owned process group.
    const root = scratch();
    const out = join(root, "log-failure");
    const port = await freePort();
    const result = run(
      [
        "--out", out, "--port", String(port), "--server-command", command(tokenServer(port, null)),
        "--startup-timeout-ms", "10000", "--inject-log-failure", "--stand-in-journey-ms", "20000",
      ],
      root
    );
    expect(result.status).toBe(1);
    expect(result.elapsedMs).toBeLessThan(15_000);
    const report = readReport(out);
    expect(report.results).toEqual([
      expect.objectContaining({ host: "harness", name: "run completed", ok: false, detail: expect.stringContaining("log stream failed: injected log failure") }),
    ]);
    expect(report.server?.ready).toBe(true);
    expect(report.server?.logFailure).toBe("injected log failure");
    expect(report.server?.exit?.signal).toBe("SIGTERM");
    expect(report.server?.group).toBe("terminated");
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 30_000);

  it("never takes readiness from a foreign service on the configured port and leaves that service untouched", async () => {
    // R5-11: a responding foreign service already holds the port. The owned
    // stand-in either exits on the bind conflict (as `vite --strictPort` does)
    // or never binds; neither may pass as readiness, and the foreign service
    // must survive the run's cleanup. The script runs asynchronously so this
    // process keeps serving the foreign answers throughout.
    const root = scratch();
    const port = await freePort();
    const foreignRequests: string[] = [];
    const foreign = createServer((request, response) => {
      foreignRequests.push(request.url ?? "");
      response.setHeader("content-type", "application/json");
      // Answers like a ready witness server, but with another run's token.
      response.end(JSON.stringify({ token: "foreign-service", ready: true }));
    });
    await new Promise<void>((resolve) => foreign.listen(port, "127.0.0.1", resolve));
    try {
      // The stand-in announces when it attempted its bind, so the port
      // conflict demonstrably happened while the foreign service held the port.
      const bindOrExit = `const server = require("node:http").createServer(() => {});
        server.on("error", (error) => { console.error(error.code); setTimeout(() => process.exit(1), 1500); });
        server.listen(${port}, "127.0.0.1");
        setInterval(() => {}, 1000);`;
      const conflict = await runAsync(
        [
          "--out", join(root, "foreign-conflict"), "--port", String(port), "--server-command", command(nodeScript(bindOrExit)),
          "--startup-timeout-ms", "10000", "--stand-in-journey-ms", "20000",
        ],
        root
      );
      expect(conflict.status).toBe(1);
      const conflictReport = readReport(join(root, "foreign-conflict"));
      expect(conflictReport.results).toEqual([
        expect.objectContaining({ host: "harness", name: "run completed", ok: false, detail: expect.stringContaining("exited early") }),
      ]);
      expect(conflictReport.server?.ready).toBe(false);
      expect(conflictReport.passed).toBe(0);
      expect(readFileSync(join(root, "foreign-conflict", "dev-server.log"), "utf8")).toContain("EADDRINUSE");
      // The foreign service answered probes while the owned stand-in lived,
      // and none of those answers was taken as readiness.
      const answeredDuringConflict = foreignRequests.filter((url) => url.startsWith("/__seed-witness/ready")).length;
      expect(answeredDuringConflict).toBeGreaterThan(0);

      const budgetMs = 2500;
      const neverBinds = await runAsync(
        [
          "--out", join(root, "foreign-never-binds"), "--port", String(port), "--server-command", command(nodeScript("setInterval(() => {}, 1000)")),
          "--startup-timeout-ms", String(budgetMs), "--stand-in-journey-ms", "20000",
        ],
        root
      );
      expect(neverBinds.status).toBe(1);
      expect(neverBinds.elapsedMs).toBeLessThan(budgetMs + 6000);
      const neverBindsReport = readReport(join(root, "foreign-never-binds"));
      expect(neverBindsReport.results).toEqual([
        expect.objectContaining({ host: "harness", name: "run completed", ok: false, detail: expect.stringContaining("did not become ready") }),
      ]);
      expect(neverBindsReport.server?.ready).toBe(false);
      expect(neverBindsReport.passed).toBe(0);
      expect(await untilGone(neverBindsReport.server!.pid!)).toBe(true);
      // Several foreign answers arrived within the budget; none counted.
      expect(foreignRequests.filter((url) => url.startsWith("/__seed-witness/ready")).length)
        .toBeGreaterThan(answeredDuringConflict + 1);

      // The foreign service survives both runs' cleanup.
      expect(foreign.listening).toBe(true);
      const stillThere = await fetch(`http://127.0.0.1:${port}/still-there`);
      expect(await stillThere.json()).toEqual({ token: "foreign-service", ready: true });
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  }, 60_000);

  it("fails the run and cleans up when the owned server exits after readiness", async () => {
    // R5-11: readiness came from this invocation's server, which then exits
    // while the journey phase is running (held open by the browser-free
    // stand-in, raced against the owned server exactly like every journey);
    // the run fails on the owned exit, long before the hold would end, and
    // cleanup follows.
    const root = scratch();
    const out = join(root, "exits-after-ready");
    const port = await freePort();
    const holdMs = 20_000;
    const result = run(
      [
        "--out", out, "--port", String(port), "--server-command", command(tokenServer(port, 150)),
        "--startup-timeout-ms", "10000", "--stand-in-journey-ms", String(holdMs),
      ],
      root,
      40_000
    );
    expect(result.status).toBe(1);
    expect(result.elapsedMs).toBeLessThan(holdMs);
    const report = readReport(out);
    expect(report.journeys).toContain("stand-in");
    expect(report.server?.ready).toBe(true);
    expect(report.server?.unexpectedExit).toEqual(expect.objectContaining({ code: 3, afterReady: true }));
    expect(report.results).toEqual([
      expect.objectContaining({ host: "harness", name: "run completed", ok: false, detail: expect.stringContaining("exited unexpectedly during the run (3)") }),
    ]);
    expect(report.passed).toBe(0);
    expect(report.server?.group).toBe("exited");
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 60_000);

  it("never reports a stand-in run as a witness, even when its hold completes against a healthy owned server", async () => {
    // A stand-in exercises no journey: completing its hold is recorded as a
    // failed witness, the run exits non-zero and the owned group is stopped.
    const root = scratch();
    const out = join(root, "stand-in-completes");
    const port = await freePort();
    const result = run(
      [
        "--out", out, "--port", String(port), "--server-command", command(tokenServer(port, null)),
        "--startup-timeout-ms", "10000", "--stand-in-journey-ms", "200",
      ],
      root
    );
    expect(result.status).toBe(1);
    const report = readReport(out);
    expect(report.journeys).toContain("never a witness");
    expect(report.server?.ready).toBe(true);
    expect(report.server?.unexpectedExit).toBeNull();
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.results).toEqual([
      expect.objectContaining({ host: "harness", ok: false, name: expect.stringContaining("never a witness") }),
    ]);
    expect(report.server?.group).toBe("terminated");
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 30_000);

  // The stand-in hold itself is always one failed assertion (a stand-in run
  // is never a witness), so each cleanup outcome below must add its own.
  const standInFailure = expect.objectContaining({ host: "harness", ok: false, name: expect.stringContaining("never a witness") });
  const healthyUntilCleanup = (detail: string) =>
    expect.objectContaining({ host: "harness", name: "owned server stayed healthy until cleanup", ok: false, detail: expect.stringContaining(detail) });

  it("fails the run when the owned server exits while the browser is closing after the final journey", async () => {
    // R6-10: the journeys finish against a healthy server; the owned server
    // then exits during browser shutdown, when nothing races the owned
    // failure any more. Cleanup must still record it before the exit code.
    const root = scratch();
    const out = join(root, "exit-during-close");
    const port = await freePort();
    const result = run(
      [
        "--out", out, "--port", String(port), "--server-command", command(tokenServer(port, 1500)),
        "--startup-timeout-ms", "10000", "--stand-in-journey-ms", "200", "--stand-in-browser-close-ms", "4000",
      ],
      root
    );
    expect(result.status).toBe(1);
    const report = readReport(out);
    expect(report.server?.ready).toBe(true);
    expect(report.server?.unexpectedExit).toEqual(expect.objectContaining({ code: 3, afterReady: true }));
    expect(report.browserClose).toBe("closed");
    // Recorded exactly once, after the journeys, and not as the run's end.
    expect(report.results).toEqual([standInFailure, healthyUntilCleanup("exited unexpectedly during the run (3)")]);
    expect(report.failed).toBe(2);
    expect(report.passed).toBe(0);
    expect(report.server?.group).toBe("exited");
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 30_000);

  it("fails the run when the log stream fails while the browser is closing after the final journey", async () => {
    // R6-10: a log failure during browser shutdown is reconciled after
    // cleanup, once, and the owned group is still terminated.
    const root = scratch();
    const out = join(root, "log-failure-during-close");
    const port = await freePort();
    const result = run(
      [
        "--out", out, "--port", String(port), "--server-command", command(tokenServer(port, null)),
        "--startup-timeout-ms", "10000", "--stand-in-journey-ms", "200", "--stand-in-browser-close-ms", "1500",
        "--inject-log-failure-at-close",
      ],
      root
    );
    expect(result.status).toBe(1);
    const report = readReport(out);
    expect(report.server?.logFailure).toBe("injected log failure during browser close");
    expect(report.server?.unexpectedExit).toBeNull();
    expect(report.results).toEqual([standInFailure, healthyUntilCleanup("log stream failed: injected log failure during browser close")]);
    expect(report.failed).toBe(2);
    expect(report.server?.exit?.signal).toBe("SIGTERM");
    expect(report.server?.group).toBe("terminated");
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 30_000);

  it("fails the run when the owned process group survives bounded escalation", async () => {
    // R6-11: process control fails (signals are not delivered), so the owned
    // group is still alive after SIGTERM and SIGKILL. That is a failed
    // assertion and a nonzero exit, not an informational report field.
    const root = scratch();
    const out = join(root, "group-survives");
    const port = await freePort();
    const result = run(
      [
        "--out", out, "--port", String(port), "--server-command", command(tokenServer(port, null)),
        "--startup-timeout-ms", "10000", "--stand-in-journey-ms", "200", "--inject-signal-failure",
      ],
      root
    );
    const report = readReport(out);
    const pid = report.server!.pid!;
    try {
      expect(result.status).toBe(1);
      // Bounded: the startup, the hold, then two 3 s escalation waits.
      expect(result.elapsedMs).toBeLessThan(20_000);
      expect(report.server?.group).toBe("survived");
      // The survivor is observable after the run ended.
      expect(processGone(pid)).toBe(false);
      expect(report.results).toEqual([
        standInFailure,
        expect.objectContaining({
          host: "harness",
          name: "owned server process group terminated during cleanup",
          ok: false,
          detail: { pid, group: "survived" },
        }),
      ]);
      expect(report.failed).toBe(2);
    } finally {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    expect(await untilGone(pid)).toBe(true);
  }, 40_000);

  it("stops the owned server and reports failure when browser shutdown never finishes", async () => {
    // R6-12: the browser close never settles. It is bounded, the owned server
    // is still terminated on its own path, the report is written and the run
    // exits within the cleanup bound.
    const root = scratch();
    const out = join(root, "close-never-finishes");
    const port = await freePort();
    const closeBoundMs = 1500;
    const result = run(
      [
        "--out", out, "--port", String(port), "--server-command", command(tokenServer(port, null)),
        "--startup-timeout-ms", "10000", "--stand-in-journey-ms", "200", "--stand-in-browser-close-ms", "never",
        "--browser-close-timeout-ms", String(closeBoundMs),
      ],
      root
    );
    expect(result.status).toBe(1);
    // Startup, the hold, the close bound and the SIGTERM grace period.
    expect(result.elapsedMs).toBeLessThan(closeBoundMs + 3000 + 8000);
    const report = readReport(out);
    expect(report.browserClose).toBe("timed out");
    expect(report.results).toEqual([
      standInFailure,
      expect.objectContaining({
        host: "harness",
        name: `browser closed within the ${closeBoundMs} ms cleanup bound`,
        ok: false,
        detail: { outcome: "timed out" },
      }),
    ]);
    expect(report.failed).toBe(2);
    expect(report.server?.exit?.signal).toBe("SIGTERM");
    expect(report.server?.group).toBe("terminated");
    expect(await untilGone(report.server!.pid!)).toBe(true);
  }, 30_000);
});

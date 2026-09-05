#!/usr/bin/env node
// Fails when a tracked *.test.ts file is discovered by neither vitest config,
// so a new suite cannot land outside the two runners unnoticed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const CONFIGS = ["vitest.config.ts", "vitest.component.config.ts"];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const root = git("rev-parse", "--show-toplevel");
const repoPath = (absolute) => relative(root, absolute).split(sep).join("/");

const tracked = git("-C", root, "ls-files", "--", "*.test.ts").split("\n").filter(Boolean);

const scratch = mkdtempSync(join(tmpdir(), "check-test-discovery-"));
const discovered = new Set();
try {
  for (const config of CONFIGS) {
    // Vitest writes the listing to this file; its stdout opens with a
    // [vite-plugin-svelte] warning, so stdout is not parseable JSON.
    const listing = join(scratch, `${config}.json`);
    execFileSync("npx", ["vitest", "list", "--filesOnly", `--json=${listing}`, "--config", config], {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
    });
    for (const entry of JSON.parse(readFileSync(listing, "utf8"))) {
      discovered.add(repoPath(entry.file));
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// Historical QA inputs are retained source evidence, not executable suites.
// Keep exact paths: every other tracked test, including under .audit, must run.
const archives = new Set([
  ".audit/integration-code-review-9da55be/qa-structural-boundary-input/convex/ai/qaChecks.test.ts",
  ".audit/integration-code-review-9da55be/qa-structural-boundary-input/convex/lib/tiptapReport.test.ts",
  ".audit/integration-code-review-9da55be/qa-structural-boundary-input/convex/qaBlocking.test.ts",
]);
const retained = tracked.filter((file) => archives.has(file) && !discovered.has(file));
for (const archive of retained) console.log(`archive: ${archive}`);
const orphans = tracked.filter((file) => !discovered.has(file) && !archives.has(file));
for (const orphan of orphans) console.log(`orphan: ${orphan}`);
if (orphans.length > 0) process.exit(1);
console.log(`discovered ${tracked.length - retained.length} executable test files; accounted for ${retained.length} historical archives`);

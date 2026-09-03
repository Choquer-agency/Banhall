// Re-runs this ticket's done_when predicates the way the engine does them:
// spawnSync("sh", ["-c", cmd]) from the worktree with CI=1.
// Run it as `node .audit/transcripts-1-model-and-list/done-when.mjs` from the worktree root.
// Do not run them from an interactive zsh: Claude Code defines `rg` as a shell
// function there, which hides a missing ripgrep binary that `sh` would fail on.
import { spawnSync } from "node:child_process";

const cmds = [
  "test -f convex/lib/transcripts.ts",
  "test -f convex/transcripts.test.ts",
  `rg -q 'transcriptDigests: defineTable' convex/schema.ts`,
  `rg -q 'by_transcriptId_and_sourceContentHash_and_condenseVersion' convex/schema.ts`,
  `rg -q 'export const listTranscripts' convex/transcripts.ts`,
  `rg -q 'export const getTranscriptContent' convex/transcripts.ts`,
  `rg -q 'transcript_digest' convex/schema.ts`,
  `rg -q 'Multiple transcripts per project' docs/product-domain.md`,
  "npx vitest run convex/transcripts.test.ts",
];

let ok = true;
for (const cmd of cmds) {
  const r = spawnSync("sh", ["-c", cmd], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
  const code = r.status ?? (r.error ? 124 : 1);
  if (code !== 0) { ok = false; process.stdout.write((r.stderr || "") + "\n"); }
  console.log(String(code).padStart(3) + "  " + cmd);
}
console.log(ok ? "ALL_DONE_WHEN_OK" : "DONE_WHEN_FAILED");
process.exit(ok ? 0 : 1);

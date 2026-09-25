#!/usr/bin/env node
// @ts-nocheck: plain Node script; the app's type check reaches its logic
// through tests/transcriptFactsEval.test.ts.
//
// Offline evaluation of the transcript method (owner decision 27): runs fact
// extraction and the condense digest on real transcripts and reports the
// verified-quote rate and fact recall vs the digest, so the owner can decide
// when small projects switch to facts (appSettings "transcripts.factsMode"
// from "long" to "all"). Billable: it calls the Anthropic API.
//
//   node scripts/transcript-facts-eval.mjs                       # test-data/*, estimate only
//   node scripts/transcript-facts-eval.mjs a.docx b.vtt c.txt --interviewer "Dana Whitfield" --yes
//   node scripts/transcript-facts-eval.mjs a.txt --model claude-sonnet-5 --adapter structured --yes
//   node scripts/transcript-facts-eval.mjs a.txt --digest-dir digests/ --out report.json --yes
//
// Options: --model (default: the condense role's default model), --adapter
// citations|structured, --interviewer NAME, --interviewees "A,B", --digest-dir
// DIR (<name>.json holding a stored digest array; skips condensing),
// --recall-threshold 0.5, --max-usd 1 (refuses above it), --yes (run the
// billable calls; without it only the estimate prints), --out FILE.
import { createServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const flagNames = new Set(["--model", "--adapter", "--interviewer", "--interviewees", "--digest-dir", "--recall-threshold", "--max-usd", "--out"]);
const files = args.filter((arg, index) => !arg.startsWith("--") && !flagNames.has(args[index - 1]));
const root = process.cwd();

const server = await createServer({
  configFile: false,
  cacheDir: path.join(root, "node_modules/.vite-facts-eval"),
  server: { middlewareMode: true, watch: null },
  logLevel: "error",
});
try {
  const evalModule = await server.ssrLoadModule("/scripts/transcript-facts-eval/eval.ts");
  const { MODEL } = await server.ssrLoadModule("/shared/generationModels.ts");
  const mammoth = await import("mammoth");

  const inputs = files.length > 0
    ? files
    : (await readdir(path.join(root, "test-data"))).map((name) => path.join("test-data", name));
  const interviewer = option("--interviewer");
  const interviewees = option("--interviewees")?.split(",").map((name) => name.trim()).filter(Boolean) ?? [];
  const digestDir = option("--digest-dir");
  const transcripts = [];
  for (const file of inputs) {
    const fileName = path.basename(file);
    const name = fileName.replace(/\.[^.]+$/, "");
    const text = fileName.toLowerCase().endsWith(".docx")
      ? (await mammoth.extractRawText({ path: file })).value
      : await readFile(file, "utf8");
    let digest;
    if (digestDir) {
      try {
        digest = JSON.parse(await readFile(path.join(digestDir, `${name}.json`), "utf8"));
      } catch {}
    }
    transcripts.push({ name, fileName, text, interviewer, interviewees, ...(digest ? { digest } : {}) });
  }

  const model = option("--model") ?? MODEL;
  const estimate = evalModule.estimateEvalCost(transcripts, model);
  const maxUsd = Number(option("--max-usd") ?? "1");
  console.log(
    `${transcripts.length} transcript(s), about ${estimate.inputTokens.toLocaleString()} input and ${estimate.outputTokens.toLocaleString()} output tokens on ${model}: estimated $${estimate.usd.toFixed(2)} (limit $${maxUsd}).`
  );
  if (!args.includes("--yes")) {
    console.log("Estimate only. Add --yes to run the billable calls.");
    process.exit(0);
  }
  if (estimate.usd > maxUsd) throw new Error(`Estimated cost is above --max-usd ${maxUsd}.`);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY for this billable evaluation.");

  const report = await evalModule.runFactsEval(transcripts, {
    client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 240_000 }),
    model,
    adapter: option("--adapter") === "structured" ? "structured" : "citations",
    recallThreshold: Number(option("--recall-threshold") ?? "0.5"),
  });
  console.log(evalModule.formatReport(report));
  const out = option("--out");
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await server.close();
}

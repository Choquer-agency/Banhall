#!/usr/bin/env node
// @ts-nocheck: plain Node script; the app's type check reaches it only
// through its unit test.
// Read-only summary of an aiUsage export, for comparing spend before and
// after a change. It reads a file and prints a table; it never talks to
// Convex or a provider.
//
//   npx convex data aiUsage --prod --limit 100000 --format jsonLines > usage.jsonl
//   node scripts/ai-usage-report.mjs usage.jsonl
//   node scripts/ai-usage-report.mjs usage.jsonl --by model --since 2026-09-01
//   node scripts/ai-usage-report.mjs before.jsonl --reprice
//
// Input: JSON lines (one aiUsage row per line) or a JSON array of rows.
// Options:
//   --by callSite|model|day   grouping key (default callSite)
//   --since YYYY-MM-DD        keep rows created on or after this UTC day
//   --until YYYY-MM-DD        keep rows created before this UTC day
//   --reprice                 recompute every estimated cost with the current
//                             price table (shared/modelPricing.ts); native
//                             costs are kept as stored
//   --json                    print the summary as JSON instead of a table
//
// Cache hit ratio = cache read tokens / (uncached input + cache writes +
// cache reads): the share of prompt tokens served from the cache.

import { readFileSync } from "node:fs";
import { estimateCostFromTable, pricingFor } from "../shared/modelPricing.ts";

function usage(message) {
  if (message) console.error(message);
  console.error(
    "usage: node scripts/ai-usage-report.mjs <export.jsonl> [--by callSite|model|day] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--reprice] [--json]"
  );
  process.exit(2);
}

export function parseArgs(argv) {
  const options = { by: "callSite", reprice: false, json: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--reprice") options.reprice = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--by" || arg === "--since" || arg === "--until") {
      const value = argv[i + 1];
      if (!value) usage(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith("--")) usage(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) usage("give exactly one export file");
  if (!["callSite", "model", "day"].includes(options.by)) usage(`--by ${options.by} is not supported`);
  options.file = positional[0];
  return options;
}

export function parseRows(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`line ${index + 1} is not JSON`);
      }
    });
}

const count = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Whether the stored cost is the provider's own figure. Rows written before
 * `costSource` existed carry none: OpenRouter ids (vendor/model) were priced
 * natively, everything else from the table.
 */
export function isNativeCost(row) {
  if (row.costSource) return row.costSource === "native";
  return typeof row.model === "string" && row.model.includes("/");
}

export function rowCost(row, reprice) {
  if (!reprice || isNativeCost(row)) return count(row.costUsd);
  return estimateCostFromTable(row.model, {
    inputTokens: count(row.inputTokens),
    outputTokens: count(row.outputTokens),
    cacheCreationInputTokens: count(row.cacheCreationInputTokens),
    cacheCreation1hInputTokens: count(row.cacheCreation1hInputTokens),
    cacheReadInputTokens: count(row.cacheReadInputTokens),
  });
}

function dayOf(row) {
  const at = count(row.createdAt) || count(row._creationTime);
  return new Date(at).toISOString().slice(0, 10);
}

export function summarize(rows, options) {
  const since = options.since ? Date.parse(`${options.since}T00:00:00Z`) : null;
  const until = options.until ? Date.parse(`${options.until}T00:00:00Z`) : null;
  const groups = new Map();
  const unknownModels = new Set();
  const totals = emptyGroup("total");
  for (const row of rows) {
    const at = count(row.createdAt) || count(row._creationTime);
    if (since !== null && at < since) continue;
    if (until !== null && at >= until) continue;
    if (typeof row.model === "string" && !pricingFor(row.model) && !isNativeCost(row)) {
      unknownModels.add(row.model);
    }
    const key =
      options.by === "model" ? row.model : options.by === "day" ? dayOf(row) : row.callSite;
    let group = groups.get(key);
    if (!group) {
      group = emptyGroup(key ?? "(none)");
      groups.set(key, group);
    }
    for (const target of [group, totals]) add(target, row, options.reprice);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    options.by === "day" ? (a.key < b.key ? -1 : 1) : b.costUsd - a.costUsd
  );
  return { groups: ordered.map(finish(totals.costUsd)), totals: finish(totals.costUsd)(totals), unknownModels: [...unknownModels].sort() };
}

function emptyGroup(key) {
  return {
    key,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0,
    nativeCostUsd: 0,
  };
}

function add(group, row, reprice) {
  const cost = rowCost(row, reprice);
  group.calls += 1;
  group.inputTokens += count(row.inputTokens);
  group.outputTokens += count(row.outputTokens);
  group.cacheReadInputTokens += count(row.cacheReadInputTokens);
  group.cacheCreationInputTokens += count(row.cacheCreationInputTokens);
  group.costUsd += cost;
  if (isNativeCost(row)) group.nativeCostUsd += cost;
}

const finish = (totalCost) => (group) => {
  const prompt =
    group.inputTokens + group.cacheCreationInputTokens + group.cacheReadInputTokens;
  return {
    ...group,
    cacheHitRatio: prompt > 0 ? group.cacheReadInputTokens / prompt : 0,
    promptTokensPerCall: group.calls > 0 ? prompt / group.calls : 0,
    costShare: totalCost > 0 ? group.costUsd / totalCost : 0,
  };
};

function formatTable(summary, options) {
  const header = [options.by, "calls", "prompt tok/call", "output tok", "cache read", "cache write", "hit ratio", "cost USD", "share", "native USD"];
  const line = (g) => [
    String(g.key),
    String(g.calls),
    Math.round(g.promptTokensPerCall).toLocaleString("en-US"),
    g.outputTokens.toLocaleString("en-US"),
    g.cacheReadInputTokens.toLocaleString("en-US"),
    g.cacheCreationInputTokens.toLocaleString("en-US"),
    `${(g.cacheHitRatio * 100).toFixed(1)}%`,
    g.costUsd.toFixed(2),
    `${(g.costShare * 100).toFixed(1)}%`,
    g.nativeCostUsd.toFixed(2),
  ];
  const body = [...summary.groups.map(line), line({ ...summary.totals, key: "TOTAL" })];
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const render = (cells) =>
    cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");
  const out = [render(header), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(render)];
  if (options.reprice) out.push("", "Estimated costs recomputed with shared/modelPricing.ts; native costs as stored.");
  if (summary.unknownModels.length) {
    out.push("", `Not in the price table (priced at the fallback rate): ${summary.unknownModels.join(", ")}`);
  }
  return out.join("\n");
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  const summary = summarize(parseRows(readFileSync(options.file, "utf8")), options);
  console.log(options.json ? JSON.stringify(summary, null, 2) : formatTable(summary, options));
}

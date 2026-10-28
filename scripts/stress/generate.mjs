#!/usr/bin/env node
// @ts-nocheck: plain Node script; tests/stressData.test.ts covers its logic.
//
// F5 stress test data (docs/todos/phase-f-scale.md): seeded, template-based
// project files and an interview transcript in fictional words, so no model
// writes the text and no real company or person can appear. The output is
// scanned for every name given in --names (the live copy's client, company,
// project and speaker names) and the script fails on any match.
//
//   node scripts/stress/generate.mjs --out /tmp/stress --names names.json
//   node scripts/stress/generate.mjs --out /tmp/stress --files 100 --seed 11
//
// Options:
//   --out DIR          where the files and manifest.json go (required)
//   --names FILE       JSON array of names that must not appear
//   --seed N           the seed (default 7); the same seed gives the same bytes
//   --files N          ordinary files (default 50)
//   --file-chars N     characters per ordinary file (default 400,000)
//   --hours N          the interview's length in hours (default 3)
//
// Besides the ordinary files it writes one file at the 1,000,000-character
// maximum and one a character over it (the app must refuse that one by name).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_FILE_CHARS = 1_000_000;
/** About 150 spoken words a minute at about 6 characters a word. */
const TRANSCRIPT_CHARS_PER_HOUR = 54_000;

/** mulberry32: a small seeded generator, the same numbers for the same seed. */
export function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (random, list) => list[Math.floor(random() * list.length)];

// Ordinary lab words for headings.
const WORDS = (
  "seal valve pump pressure temperature flow sample batch trial run test result cycle load sensor reading " +
  "prototype material coating weld joint bracket housing gasket membrane filter coil motor shaft bearing"
).split(" ");
const UNITS = ["bar", "kPa", "C", "mm", "hours", "cycles", "percent", "rpm", "kg", "minutes"];
// F5 live run, 2026-10-27: words in random order read as nonsense, and the
// models refused it (the Brief on every try, file labels on about half), so
// the text is now plain sentences from templates, still with no model text.
const PARTS = ["seal", "valve", "pump", "sensor", "housing", "gasket", "membrane", "filter", "coil", "motor", "shaft", "bearing", "bracket", "weld", "coating"];
const QUANTITIES = ["pressure", "temperature", "flow", "drift", "wear", "noise"];
const OUTCOMES = ["held", "leaked", "cracked", "drifted", "stabilized", "failed early"];
const ACTIONS = ["adjusted", "replaced", "tuned", "measured", "cleaned", "rebuilt"];
const PLACES = ["bench", "test rig", "line", "station"];
const SHIFTS = ["morning", "evening", "night"];
const SENTENCES = [
  (r, who, n) => `${who} ran trial ${n()} on the ${pick(r, PARTS)} at ${n()} ${pick(r, UNITS)}, and it ${pick(r, OUTCOMES)}.`,
  (r, who, n) => `The ${pick(r, PARTS)} ${pick(r, OUTCOMES)} after ${n()} ${pick(r, UNITS)} on the ${pick(r, PLACES)}.`,
  (r, who, n) => `We ${pick(r, ACTIONS)} the ${pick(r, PARTS)} and logged ${n()} ${pick(r, UNITS)} on the ${pick(r, SHIFTS)} shift.`,
  (r, who, n) => `Nobody knew whether the ${pick(r, PARTS)} would keep its ${pick(r, QUANTITIES)} steady above ${n()} ${pick(r, UNITS)}.`,
  (r, who, n) => `${who} compared the new ${pick(r, PARTS)} with the old one and saw ${(n() % 60) + 5} percent less ${pick(r, QUANTITIES)}.`,
  (r, who, n) => `The ${pick(r, QUANTITIES)} reading on the ${pick(r, PLACES)} rose to ${n()} ${pick(r, UNITS)} before the ${pick(r, PARTS)} ${pick(r, OUTCOMES)}.`,
];
const QUESTIONS = [
  (r) => `What happened when you ${pick(r, ACTIONS)} the ${pick(r, PARTS)}?`,
  (r) => `Why did the ${pick(r, PARTS)} keep losing ${pick(r, QUANTITIES)}?`,
  (r) => `What did you try next on the ${pick(r, PLACES)}?`,
  (r) => `How did you know the ${pick(r, PARTS)} would hold?`,
];
// Syllables for invented names. The scan below is what guarantees no real name.
const SYLLABLES = ["zor", "vel", "quin", "tash", "mor", "dex", "ul", "bran", "kev", "sil", "oth", "pra", "nim", "ves", "cal", "dro", "fen", "yar"];

export function inventedName(random, syllables = 2 + Math.floor(random() * 2)) {
  let name = "";
  for (let index = 0; index < syllables; index += 1) name += pick(random, SYLLABLES);
  return name[0].toUpperCase() + name.slice(1);
}

function sentence(random, names) {
  const who = names.length ? pick(random, names) : "The team";
  const n = () => Math.floor(random() * 900) + 1;
  return pick(random, SENTENCES)(random, who, n);
}

function question(random) {
  return pick(random, QUESTIONS)(random);
}

/** Exactly `chars` characters of notes: headings and paragraphs, cut at the end. */
export function fileText(random, chars, title, names) {
  const parts = [`# ${title}`, ""];
  let length = parts.join("\n").length;
  while (length < chars) {
    const paragraph =
      random() < 0.08
        ? `\n## ${inventedName(random)} ${pick(random, WORDS)} notes\n`
        : Array.from({ length: 3 + Math.floor(random() * 4) }, () => sentence(random, names)).join(" ");
    parts.push(paragraph, "");
    length += paragraph.length + 2;
  }
  return parts.join("\n").slice(0, chars);
}

/** An interview of about `chars` characters: "Name: words" turns, cut at a line end. */
export function transcriptText(random, chars, speakers, names) {
  const lines = [];
  let length = 0;
  let turn = 0;
  while (length < chars) {
    const speaker = speakers[turn % speakers.length];
    // The first speaker is the interviewer, who asks.
    const said =
      turn % speakers.length === 0
        ? question(random)
        : Array.from({ length: 1 + Math.floor(random() * 6) }, () => sentence(random, names)).join(" ");
    const line = `${speaker}: ${said}`;
    lines.push(line);
    length += line.length + 1;
    turn += 1;
  }
  let text = lines.join("\n");
  if (text.length > chars) text = text.slice(0, text.lastIndexOf("\n", chars));
  return text;
}

/** Every name from `names` that appears in `text` as a whole word, ignoring case. */
export function namesFound(text, names) {
  const lower = text.toLowerCase();
  const found = [];
  for (const name of names) {
    const needle = String(name).trim().toLowerCase();
    if (needle.length < 3) continue;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(lower)) found.push(name);
  }
  return found;
}

/** Words the generator adds to every invented name, not invented themselves. */
const FIXED_NAME_WORDS = new Set(["works"]);

/**
 * Invented names that share a word of 4 or more letters with a real name
 * (a surname alone, one word of a company's name): the whole-name scan of
 * the text would miss them.
 */
export function inventedWordsFound(invented, names) {
  const real = new Set();
  for (const name of names) {
    for (const word of String(name).toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (word.length >= 4) real.add(word);
  }
  const found = new Set();
  for (const name of invented) {
    for (const word of String(name).toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (real.has(word) && !FIXED_NAME_WORDS.has(word)) found.add(word);
  }
  return [...found];
}

/** The whole data set for a seed, in memory: the company, people, files and the interview. */
export function stressData({ seed = 7, files = 50, fileChars = 400_000, hours = 3 } = {}) {
  const random = seeded(seed);
  const company = `${inventedName(random, 3)} Works`;
  const people = Array.from({ length: 4 }, () => `${inventedName(random)} ${inventedName(random)}`);
  const terms = Array.from({ length: 12 }, () => inventedName(random));
  const names = [...terms, company];
  const out = [];
  for (let index = 1; index <= files; index += 1) {
    const title = `${company} test notes ${index}`;
    out.push({ name: `notes-${String(index).padStart(3, "0")}.md`, kind: "file", text: fileText(random, fileChars, title, names) });
  }
  out.push({ name: "notes-max.md", kind: "file-max", text: fileText(random, MAX_FILE_CHARS, `${company} full log`, names) });
  out.push({ name: "notes-over-max.md", kind: "file-over-max", text: fileText(random, MAX_FILE_CHARS + 1, `${company} log too long`, names) });
  const interviewer = "Interviewer";
  out.push({
    name: "interview.txt",
    kind: "transcript",
    text: transcriptText(random, Math.round(hours * TRANSCRIPT_CHARS_PER_HOUR), [interviewer, ...people.slice(0, 2)], names),
  });
  return { seed, company, people, terms, files: out };
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function argument(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

export function main(argv) {
  const out = argument(argv, "--out");
  if (!out) {
    console.error("stress/generate: --out DIR is required");
    return 2;
  }
  const data = stressData({
    seed: Number(argument(argv, "--seed", "7")),
    files: Number(argument(argv, "--files", "50")),
    fileChars: Number(argument(argv, "--file-chars", "400000")),
    hours: Number(argument(argv, "--hours", "3")),
  });
  const namesFile = argument(argv, "--names");
  const forbidden = namesFile ? JSON.parse(readFileSync(namesFile, "utf8")) : [];
  const hits = [];
  for (const name of namesFound([data.company, ...data.people].join("\n"), forbidden)) hits.push({ file: "names", name });
  for (const word of inventedWordsFound([data.company, ...data.people, ...data.terms], forbidden)) hits.push({ file: "invented names", name: word });
  for (const file of data.files) for (const name of namesFound(file.text, forbidden)) hits.push({ file: file.name, name });
  mkdirSync(out, { recursive: true });
  for (const file of data.files) writeFileSync(path.join(out, file.name), file.text);
  const manifest = {
    seed: data.seed,
    company: data.company,
    people: data.people,
    namesChecked: forbidden.length,
    hits,
    files: data.files.map((file) => ({ name: file.name, kind: file.kind, chars: file.text.length, sha256: sha256(file.text) })),
  };
  writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const total = data.files.reduce((sum, file) => sum + file.text.length, 0);
  console.log(`stress/generate: ${data.files.length} files, ${total.toLocaleString()} characters, company "${data.company}", in ${out}`);
  if (!namesFile) console.log("stress/generate: no --names given, so nothing was scanned; scan before uploading.");
  if (hits.length) {
    console.error(`stress/generate: ${hits.length} real name(s) found; do not upload:`);
    for (const hit of hits) console.error(`  ${hit.file}: ${hit.name}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

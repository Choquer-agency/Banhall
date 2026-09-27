import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as v8 from "./transcriptParse";
import * as v7 from "./__fixtures__/transcriptParseV7";
import { inferSpeakerRoles } from "../convex/lib/transcriptSpeakers";

/**
 * Parser v8 must not reshape a transcript v7 read (lead decision, review of
 * 2026-09-26): every existing parser fixture, and every transcript-like
 * string in the test suites written before v8, gives the same turns,
 * offsets, speaker names, roles, per-line reads, format and canonical
 * render under v8 as under the frozen v7 copy. Only an email label or a
 * weak label that passes the exchange test may change turns; none of the
 * existing inputs holds one.
 *
 * Parser v9 (2026-09-26) reads a metadata heading above the exchange
 * ("Project: ...") as text. The inputs that hold one are allowed below, and
 * only for that line: each reads under v9 exactly as v7 reads the same text
 * with the heading's colon taken out, so no other turn, speaker or name moves.
 */

const ROOT = new URL("..", import.meta.url).pathname;

/** Tests written for v8 and v9 themselves hold weak labels and headings on purpose. */
const V8_TESTS = new Set([
  "shared/transcriptParse.v8.test.ts",
  "shared/transcriptParse.v9.test.ts",
  "shared/transcriptParse.preservation.test.ts",
  "convex/lib/placeholders.v8.test.ts",
  "convex/privacyWave2.sdk.test.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "_generated" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Double-quoted strings, templates without substitutions, and `[...].join(sep)` of them. */
function stringLiterals(source: string): string[] {
  const out: string[] = [];
  const evaluate = (literal: string): string | undefined => {
    try {
      const value: unknown = new Function(`return ${literal};`)();
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const single = /"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`/g;
  for (const match of source.matchAll(single)) {
    const value = evaluate(match[0]);
    if (value !== undefined) out.push(value);
  }
  const joined = /\[((?:\s*(?:"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)\s*,)*\s*(?:"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)\s*,?\s*)\]\.join\(("(?:[^"\\\n]|\\.)*")\)/g;
  for (const match of source.matchAll(joined)) {
    const value = evaluate(`[${match[1]}].join(${match[2]})`);
    if (value !== undefined) out.push(value);
  }
  return out;
}

function corpus(): Array<{ from: string; text: string }> {
  const items: Array<{ from: string; text: string }> = [];
  const fixtureDirs = ["shared/__fixtures__/transcripts", "convex/ai/__fixtures__", "test-data"];
  for (const dir of fixtureDirs) {
    for (const path of walk(join(ROOT, dir))) {
      if (!/\.(txt|vtt|srt)$/.test(path)) continue;
      items.push({ from: relative(ROOT, path), text: readFileSync(path, "utf8") });
    }
  }
  const sources = [...walk(join(ROOT, "shared")), ...walk(join(ROOT, "convex"))].filter(
    (path) =>
      (/\.test\.ts$/.test(path) || /modelEvalSet\.ts$/.test(path)) && !V8_TESTS.has(relative(ROOT, path))
  );
  for (const path of sources) {
    for (const text of stringLiterals(readFileSync(path, "utf8"))) {
      if (text.length >= 3 && (text.includes(":") || text.includes("\n"))) {
        items.push({ from: relative(ROOT, path), text });
      }
    }
  }
  return items;
}

/**
 * Inputs allowed to read differently since v7, by where they come from, with
 * the metadata heading lines v9 reads as text. The Northwind header is the
 * live test's (2026-09-26), whose "Project" was hidden as a person.
 */
const NORTHWIND_PROJECT = "Project: Low-temperature structural bonding of composite sensor brackets";
const ALLOWED_CHANGES = new Map<string, string[]>([
  ["shared/__fixtures__/transcripts/metadata-header.txt", [NORTHWIND_PROJECT, "Client: Northwind Test Labs"]],
  ["convex/adoptedSeedQuotes.test.ts", [NORTHWIND_PROJECT]],
]);

/** The allowed heading lines an input holds (none when it is not allowed). */
function allowedHeadings(item: { from: string; text: string }): string[] {
  const lines = item.text.split("\n");
  return (ALLOWED_CHANGES.get(item.from) ?? []).filter((heading) => lines.includes(heading));
}

/** The text with each heading's colon taken out, at the same length ("Project - ..."). */
function withoutHeadingColons(text: string, headings: readonly string[]): string {
  return text
    .split("\n")
    .map((line) => (headings.includes(line) ? line.replace(": ", " -") : line))
    .join("\n");
}

/** What a heading may not move: turn places and speakers, names and roles. */
function places(parser: typeof v7 | typeof v8, text: string) {
  const read = (cues: boolean) =>
    parser.parseTranscriptTurns(text, { cues }).map(({ charStart, charEnd, speakerLabel, rawLabel }) => ({
      charStart, charEnd, speakerLabel, rawLabel,
    }));
  const names = parser.transcriptSpeakerNames(text);
  return {
    turns: read(false),
    cueTurns: read(true),
    roles: inferSpeakerRoles(parser.parseTranscriptTurns(text) as v8.TranscriptTurn[], NO_CONTEXT),
    labels: names.labels,
    otherNames: names.otherNames,
    organizations: names.organizations,
  };
}

const FILE_NAMES = [undefined, "call.txt", "call.docx", "call.vtt", "call.srt"] as const;
const FORMATS = ["vtt", "srt", "teams_docx", "txt", "paste"] as const;
const NO_CONTEXT = { staffNames: [], clientNames: [] };

function structure(parser: typeof v7 | typeof v8, text: string) {
  const turns = parser.parseTranscriptTurns(text);
  const cueTurns = parser.parseTranscriptTurns(text, { cues: true });
  const names = parser.transcriptSpeakerNames(text);
  return {
    turns,
    cueTurns,
    roles: inferSpeakerRoles(turns as v8.TranscriptTurn[], NO_CONTEXT),
    labels: names.labels,
    otherNames: names.otherNames,
    organizations: names.organizations,
    lines: text.split("\n").map((line) => [parser.speakerOfTranscriptLine(line), parser.splitSpeakerLine(line)]),
    formats: FILE_NAMES.map((fileName) => parser.detectTranscriptFormat({ fileName, text })),
    renders: FORMATS.map((format) => parser.normalizeTranscriptText(format, text)),
  };
}

describe("parser v8 and v9 keep every v7 transcript as it was", () => {
  const items = corpus();

  it("reads a corpus of fixtures and test strings", () => {
    expect(items.filter((item) => item.from.startsWith("shared/__fixtures__")).length).toBeGreaterThanOrEqual(11);
    expect(items.length).toBeGreaterThan(2000);
  });

  it("gives identical turns, offsets, names, roles, line reads, formats and renders", () => {
    const changed: string[] = [];
    for (const item of items) {
      const before = structure(v7, item.text);
      const after = structure(v8, item.text);
      if (JSON.stringify(before) !== JSON.stringify(after) && allowedHeadings(item).length === 0) {
        const fields = (Object.keys(before) as Array<keyof typeof before>).filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
        );
        changed.push(`${item.from} [${fields.join(",")}]: ${JSON.stringify(item.text.slice(0, 160))}`);
      }
    }
    expect(changed).toEqual([]);
  });

  it("reads an allowed metadata heading as text and moves nothing else", () => {
    const allowed = items.filter(
      (item) =>
        allowedHeadings(item).length > 0 &&
        JSON.stringify(structure(v7, item.text)) !== JSON.stringify(structure(v8, item.text))
    );
    expect(new Set(allowed.map((item) => item.from))).toEqual(new Set(ALLOWED_CHANGES.keys()));
    for (const item of allowed) {
      const headings = allowedHeadings(item);
      expect(places(v8, item.text), item.from).toEqual(places(v7, withoutHeadingColons(item.text, headings)));
      // Under v7 the heading was a speaker; under v9 it names no one.
      const words = headings.map((heading) => heading.slice(0, heading.indexOf(":")));
      const names = v8.transcriptSpeakerNames(item.text);
      for (const word of words) {
        expect(v7.transcriptSpeakerNames(item.text).labels, item.from).toContain(word);
        expect([...names.labels, ...names.otherNames, ...(names.looseLabels ?? [])], item.from).not.toContain(word);
      }
    }
  });

  it("uploads every fixture file to the same stored text and turns", () => {
    for (const item of items.filter((entry) => /\.(txt|vtt|srt)$/.test(entry.from))) {
      const fileName = item.from.split("/").pop()!.replace(/-docx\.txt$/, ".docx");
      const before = v7.prepareTranscriptUpload({ fileName, text: item.text });
      const after = v8.prepareTranscriptUpload({ fileName, text: item.text });
      expect(after, item.from).toEqual(before);
      // An allowed heading's turns are checked above.
      if (allowedHeadings(item).length > 0) continue;
      const cues = v8.isCueRender(after.format, after.content);
      expect(v8.parseTranscriptTurns(after.content, { cues }), item.from).toEqual(
        v7.parseTranscriptTurns(before.content, { cues })
      );
    }
  });
});

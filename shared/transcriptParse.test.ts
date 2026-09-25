import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cleanTurnText,
  detectTranscriptFormat,
  formatTimestamp,
  isCueRender,
  MAX_TURN_CHARS,
  normalizeTranscriptText,
  parseTranscriptTurns,
  prepareTranscriptUpload,
  speakerOfTranscriptLine,
  splitSpeakerLine,
  timestampToMs,
  type TranscriptTurn,
} from "./transcriptParse";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/transcripts/${name}`, import.meta.url), "utf8");
}

/** Turns of prepared text as the server builds them: cue rules for cue renders. */
function builtTurns(prepared: { format: Parameters<typeof isCueRender>[0]; content: string }): TranscriptTurn[] {
  return parseTranscriptTurns(prepared.content, { cues: isCueRender(prepared.format, prepared.content) });
}

function speakers(turns: TranscriptTurn[]): Array<string | undefined> {
  return turns.map((turn) => turn.speakerLabel);
}

/** Every turn's span is inside the content, ordered, and non-empty. */
function expectSpansValid(content: string, turns: TranscriptTurn[]) {
  let previousEnd = 0;
  turns.forEach((turn, index) => {
    expect(turn.index).toBe(index);
    expect(turn.charStart).toBeGreaterThanOrEqual(previousEnd);
    expect(turn.charEnd).toBeGreaterThan(turn.charStart);
    expect(turn.charEnd).toBeLessThanOrEqual(content.length);
    const slice = content.slice(turn.charStart, turn.charEnd);
    expect(slice).toBe(slice.trim());
    previousEnd = turn.charEnd;
  });
}

describe("format detection and canonical render", () => {
  it("detects Teams .docx text with name and time headers and keeps it verbatim", () => {
    const text = fixture("teams-docx.txt");
    const prepared = prepareTranscriptUpload({ fileName: "Helios.docx", text });
    expect(prepared.format).toBe("teams_docx");
    expect(prepared.content).toBe(text.trim());
    const turns = parseTranscriptTurns(prepared.content);
    expect(speakers(turns)).toEqual([
      undefined,
      undefined,
      "Dana Whitfield",
      "Priya Shah",
      "Dana Whitfield",
      "Priya Shah",
    ]);
    expect(turns[3].startMs).toBe(9_000);
    expect(turns[3].endMs).toBe(62_000);
    // The second paragraph of a labelled turn continues it.
    expect(prepared.content.slice(turns[3].charStart, turns[3].charEnd)).toContain(
      "We did not know if a useful forecast"
    );
    expect(turns[3].cleanText).not.toMatch(/\bum\b/);
    expectSpansValid(prepared.content, turns);
  });

  it("renders a cue-timed Teams .docx to the canonical form, in both paragraph layouts", () => {
    // The fixtures are the exact text src/lib/transcriptUpload.ts extracts
    // (src/lib/transcriptUpload.test.ts checks it): a Teams export's soft
    // line breaks kept inside one paragraph per cue, and the timing, name and
    // speech as separate paragraphs, each ending in a blank line.
    for (const name of ["teams-cues-docx.txt", "teams-cues-paragraphs-docx.txt"]) {
      const prepared = prepareTranscriptUpload({ fileName: "t.docx", text: fixture(name) });
      expect(prepared.format, name).toBe("teams_docx");
      expect(prepared.content, name).toBe(
        "Dana Whitfield [00:00:00]: Thanks for joining.\n\nPriya Shah [00:00:03]: We could not predict flow at the feeder. So we built a test rig."
      );
      expect(speakers(parseTranscriptTurns(prepared.content)), name).toEqual(["Dana Whitfield", "Priya Shah"]);
    }
  });

  it("still ends a VTT or SRT cue at a blank line", () => {
    const prepared = prepareTranscriptUpload({
      fileName: "call.srt",
      text: "1\n00:00:01,000 --> 00:00:02,000\nDana: Hi.\n\nA stray line outside any cue.\n\n2\n00:00:03,000 --> 00:00:04,000\nPriya: Hello.",
    });
    expect(prepared.content).toBe("Dana [00:00:01]: Hi.\n\nPriya [00:00:03]: Hello.");
  });

  it("renders WebVTT voices and colon labels, decoding entities and joining a speaker's cues", () => {
    const prepared = prepareTranscriptUpload({ fileName: "call.vtt", text: fixture("sample.vtt") });
    expect(prepared.format).toBe("vtt");
    expect(prepared.content).toBe(
      [
        "Dana Whitfield [00:00:00]: Thanks for joining.",
        "Priya Shah [00:00:03]: We could not predict flow & voltage at the feeder. So we built a test rig.",
        "Dana Whitfield [00:00:12]: How long did it take?",
      ].join("\n\n")
    );
    const turns = parseTranscriptTurns(prepared.content);
    expect(speakers(turns)).toEqual(["Dana Whitfield", "Priya Shah", "Dana Whitfield"]);
    expect(turns.map((turn) => turn.startMs)).toEqual([0, 3_000, 12_000]);
    expect(prepared.content.slice(turns[0].charStart, turns[0].charEnd)).toBe("Thanks for joining.");
    expectSpansValid(prepared.content, turns);
  });

  it("renders a Zoom recording's .vtt: numbered cues with the name before a colon", () => {
    // Shaped after Zoom's cloud recording transcript, not a real export.
    const prepared = prepareTranscriptUpload({ fileName: "GMT20260917-Recording.transcript.vtt", text: fixture("zoom.vtt") });
    expect(prepared.format).toBe("vtt");
    expect(prepared.content).toBe(
      [
        "Dana Whitfield [00:00:01]: Thanks for joining everyone.",
        "Priya Shah [00:00:05]: We could not predict flow at the feeder. So we built a test rig.",
        "[00:00:12] Someone joined without a name.",
      ].join("\n\n")
    );
    const turns = builtTurns(prepared);
    expect(turns.map((turn) => [turn.speakerLabel, turn.startMs])).toEqual([
      ["Dana Whitfield", 1_000],
      ["Priya Shah", 5_000],
      [undefined, 12_000],
    ]);
    expectSpansValid(prepared.content, turns);
  });

  it("renders SRT cues with multi-line text", () => {
    const prepared = prepareTranscriptUpload({ fileName: "call.srt", text: fixture("sample.srt") });
    expect(prepared.format).toBe("srt");
    expect(prepared.content).toBe(
      "Dana Whitfield [00:00:00]: Thanks for joining.\n\nPriya Shah [00:00:03]: We could not predict flow at the feeder. So we built a test rig."
    );
    expect(speakers(parseTranscriptTurns(prepared.content))).toEqual(["Dana Whitfield", "Priya Shah"]);
  });

  it("detects Zoom headers", () => {
    const text = fixture("zoom.txt");
    const prepared = prepareTranscriptUpload({ fileName: "zoom.txt", text });
    expect(prepared.format).toBe("zoom");
    const turns = parseTranscriptTurns(prepared.content);
    expect(speakers(turns)).toEqual(["Dana Whitfield", "Priya Shah", "Dana Whitfield"]);
    expect(turns[1].startMs).toBe(timestampToMs("10:02:37"));
    expect(turns[1].cleanText).toBe("We could not predict flow at the feeder. It changed with cloud cover.");
    expectSpansValid(prepared.content, turns);
  });

  it("detects Google Meet timestamps above named lines", () => {
    const prepared = prepareTranscriptUpload({ fileName: "meet.txt", text: fixture("meet.txt") });
    expect(prepared.format).toBe("meet");
    const turns = parseTranscriptTurns(prepared.content);
    expect(speakers(turns)).toEqual([undefined, "Dana Whitfield", "Priya Shah", "Dana Whitfield", "Priya Shah"]);
    expect(turns[1].startMs).toBe(0);
    expect(turns[3].startMs).toBe(300_000);
    expectSpansValid(prepared.content, turns);
  });

  it("detects Otter exports", () => {
    const prepared = prepareTranscriptUpload({ fileName: "otter.txt", text: fixture("otter.txt") });
    expect(prepared.format).toBe("otter");
    const turns = parseTranscriptTurns(prepared.content);
    expect(speakers(turns)).toEqual(["Speaker 1", "Priya Shah"]);
    // The footer continues the last turn: it names no one.
    expect(turns[1].cleanText).toContain("We could not predict flow");
  });

  it("reads pasted colon labels, preferring the name in parentheses", () => {
    const text = fixture("paste.txt");
    const prepared = prepareTranscriptUpload({ text, intake: "paste" });
    expect(prepared.format).toBe("paste");
    const turns = parseTranscriptTurns(prepared.content);
    expect(speakers(turns)).toEqual(["Dana", "Marcus Lindqvist", "Dana", "Marcus"]);
    expect(turns[0].rawLabel).toBe("Interviewer (Dana)");
    expect(turns[3].cleanText).toBe(
      "We genuinely did not know if a useful forecast was possible. It changed with cloud cover."
    );
    expectSpansValid(prepared.content, turns);
  });

  it("falls back to one turn per paragraph when no one is named", () => {
    const prepared = prepareTranscriptUpload({ fileName: "notes.txt", text: fixture("plain.txt") });
    expect(prepared.format).toBe("txt");
    const turns = parseTranscriptTurns(prepared.content);
    expect(turns).toHaveLength(3);
    expect(speakers(turns)).toEqual([undefined, undefined, undefined]);
    expectSpansValid(prepared.content, turns);
  });

  it("labels an unrecognized .docx and keeps .txt plain", () => {
    expect(detectTranscriptFormat({ fileName: "memo.docx", text: "Just a memo.\n\nNo speakers." })).toBe("unknown");
    expect(detectTranscriptFormat({ fileName: "memo.txt", text: "Just a memo." })).toBe("txt");
  });

  it("normalizes line endings without touching words", () => {
    expect(normalizeTranscriptText("txt", "﻿A: one  \r\nB: two\r\n")).toBe("A: one\nB: two");
  });
});

describe("speaker lines", () => {
  const cases = [
    "Dr. Priya Shah: Yes.",
    "Ludwig van Beethoven: Yes.",
    "Interviewer (Larry): Thanks.",
    "Subject (CTO): Sure.",
    "Priya Shah (00:01:02): Yes.",
    "Q: Why?",
    "Attendees: Priya, Tom",
    "the result was: stable",
    "10:30 the meeting began",
    "Priya Shah   0:03",
    "<v Priya Shah>We could not.",
    "00:01:02",
    "[00:01:02] We could not.",
    "[00:01:02] Priya Shah: We could not.",
    "",
  ];

  it("agrees with speakerOfTranscriptLine on every line it names", () => {
    for (const line of cases) {
      const split = splitSpeakerLine(line);
      const speaker = split && "speaker" in split ? split.speaker : undefined;
      expect(speaker, line).toBe(speakerOfTranscriptLine(line));
    }
  });

  it("finds where the speech starts", () => {
    const line = "  Priya Shah [00:01:02]: We tried it.";
    const split = splitSpeakerLine(line);
    expect(split?.kind).toBe("inline");
    if (split?.kind !== "inline") return;
    expect(line.slice(split.speechOffset)).toBe("We tried it.");
    expect(split.timeMs).toBe(62_000);
  });
});

describe("cues and turns with no speaker", () => {
  it("keeps each unnamed SRT or VTT cue as its own turn with its time", () => {
    const srt = prepareTranscriptUpload({
      fileName: "call.srt",
      text: "1\n00:00:01,000 --> 00:00:03,000\nWe could not predict flow.\n\n2\n00:00:04,500 --> 00:00:06,000\nSo we built a rig.",
    });
    expect(srt.content).toBe("[00:00:01] We could not predict flow.\n\n[00:00:04] So we built a rig.");
    const turns = builtTurns(srt);
    expect(turns.map((turn) => [turn.speakerLabel, turn.startMs, turn.endMs])).toEqual([
      [undefined, 1_000, 4_000],
      [undefined, 4_000, undefined],
    ]);
    expect(srt.content.slice(turns[0].charStart, turns[0].charEnd)).toBe("We could not predict flow.");
    expectSpansValid(srt.content, turns);
  });

  it("never folds an unnamed cue into the named speaker above it", () => {
    const vtt = prepareTranscriptUpload({
      fileName: "call.vtt",
      text: [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:02.000",
        "<v Dana Whitfield>What did you try?",
        "",
        "00:00:03.000 --> 00:00:04.000",
        "Background voice nobody named.",
        "",
        "00:00:05.000 --> 00:00:06.000",
        "<v Priya Shah>A test rig.",
      ].join("\n"),
    });
    const turns = builtTurns(vtt);
    expect(turns.map((turn) => [turn.speakerLabel, turn.startMs])).toEqual([
      ["Dana Whitfield", 1_000],
      [undefined, 3_000],
      ["Priya Shah", 5_000],
    ]);
    expect(vtt.content.slice(turns[1].charStart, turns[1].charEnd)).toBe("Background voice nobody named.");
  });

  it("keeps an unnamed cue whose speech holds a colon out of the speaker above it", () => {
    for (const [fileName, text] of [
      [
        "call.vtt",
        "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Priya Shah>We built a rig.\n\n00:00:03.000 --> 00:00:05.000\nWe tested two options: the first failed.",
      ],
      [
        "call.srt",
        "1\n00:00:01,000 --> 00:00:02,000\nPriya Shah: We built a rig.\n\n2\n00:00:03,000 --> 00:00:05,000\nNote: the logger dropped out.",
      ],
    ] as const) {
      const prepared = prepareTranscriptUpload({ fileName, text });
      const turns = builtTurns(prepared);
      expect(turns.map((turn) => [turn.speakerLabel, turn.startMs]), fileName).toEqual([
        ["Priya Shah", 1_000],
        [undefined, 3_000],
      ]);
      expect(turns[0].cleanText, fileName).toBe("We built a rig.");
      expect(prepared.content.slice(turns[1].charStart, turns[1].charEnd), fileName).toMatch(
        /^(We tested two options: the first failed\.|Note: the logger dropped out\.)$/
      );
      expectSpansValid(prepared.content, turns);
    }
  });

  it("reads a colon line with a bracketed time and no speaker as timed, never as a speaker", () => {
    expect(splitSpeakerLine("[00:00:03] We tested two options: the first failed")).toEqual({
      kind: "timed",
      timeMs: 3_000,
      speechOffset: "[00:00:03] ".length,
    });
    expect(speakerOfTranscriptLine("[00:00:03] We tested two options: the first failed")).toBeUndefined();
    // A named line keeps its speaker.
    expect(splitSpeakerLine("[00:00:03] Priya Shah: We tested it")).toMatchObject({
      kind: "inline",
      speaker: "Priya Shah",
    });
    // Without a bracketed time a non-speaker colon line is still plain text.
    expect(splitSpeakerLine("We tested two options: the first failed")).toBeUndefined();
  });
});

describe("bracketed times outside cue renders", () => {
  it("keeps a timestamped paragraph in the named turn above it, as pasted and .txt transcripts expect", () => {
    const content = "Priya Shah: We built the first rig in March.\n\n[00:12:30] And then the rig failed on a cloudy day.\n\nDana Whitfield: Why?";
    for (const format of ["paste", "txt", "otter", "unknown", undefined] as const) {
      const turns = parseTranscriptTurns(content, { cues: isCueRender(format, content) });
      expect(turns.map((turn) => turn.speakerLabel), String(format)).toEqual(["Priya Shah", "Dana Whitfield"]);
      expect(content.slice(turns[0].charStart, turns[0].charEnd), String(format)).toBe(
        "We built the first rig in March.\n\n[00:12:30] And then the rig failed on a cloudy day."
      );
      expect(turns[0].cleanText).toBe(
        "We built the first rig in March. And then the rig failed on a cloudy day."
      );
    }
  });

  it("gives a timestamped paragraph that opens a turn its time", () => {
    const content = "[00:00:05] We met the client.\n\n[00:01:10] They built a rig.";
    const turns = parseTranscriptTurns(content, { cues: isCueRender("txt", content) });
    expect(turns.map((turn) => [turn.speakerLabel, turn.startMs, turn.endMs])).toEqual([
      [undefined, 5_000, 70_000],
      [undefined, 70_000, undefined],
    ]);
    // The same edges as a transcript that never carried times: the line is kept whole.
    expect(content.slice(turns[1].charStart, turns[1].charEnd)).toBe("[00:01:10] They built a rig.");
  });

  it("treats only VTT, SRT and cue-timed Teams exports as cue renders", () => {
    const cueTeams = prepareTranscriptUpload({ fileName: "t.docx", text: fixture("teams-cues-docx.txt") });
    const headerTeams = prepareTranscriptUpload({ fileName: "t.docx", text: fixture("teams-docx.txt") });
    expect(cueTeams.format).toBe("teams_docx");
    expect(headerTeams.format).toBe("teams_docx");
    expect(isCueRender("teams_docx", cueTeams.content)).toBe(true);
    expect(isCueRender("teams_docx", headerTeams.content)).toBe(false);
    expect(isCueRender("vtt", "anything")).toBe(true);
    expect(isCueRender("srt", "anything")).toBe(true);
    for (const format of ["txt", "paste", "zoom", "meet", "otter", "unknown", undefined] as const) {
      expect(isCueRender(format, cueTeams.content), String(format)).toBe(false);
    }
  });
});

describe("long turns", () => {
  it("splits speech longer than MAX_TURN_CHARS into turns of the same speaker, cut at whitespace", () => {
    const words = Array.from({ length: 12_000 }, (_, i) => `word${i}`).join(" ");
    const content = `Dana Whitfield [00:00:05]: ${words}\n\nPriya Shah: Short answer.`;
    const turns = parseTranscriptTurns(content);
    expect(turns.length).toBeGreaterThan(3);
    const dana = turns.filter((turn) => turn.speakerLabel === "Dana Whitfield");
    expect(dana.length).toBe(turns.length - 1);
    expect(dana[0].startMs).toBe(5_000);
    expect(dana.slice(1).every((turn) => turn.startMs === undefined)).toBe(true);
    for (const turn of turns) {
      expect(turn.charEnd - turn.charStart).toBeLessThanOrEqual(MAX_TURN_CHARS);
      expect(turn.cleanText.length).toBeLessThanOrEqual(MAX_TURN_CHARS);
      // Cut at whitespace: no word is split.
      expect(content.slice(turn.charStart, turn.charEnd)).toMatch(/^word\d+|^Short/);
    }
    // Every word is still in exactly one turn.
    expect(dana.map((turn) => content.slice(turn.charStart, turn.charEnd)).join(" ")).toBe(words);
    expectSpansValid(content, turns);
  });

  it("cuts a run with no whitespace without splitting a surrogate pair", () => {
    const content = "\u{1F600}".repeat(MAX_TURN_CHARS);
    const turns = parseTranscriptTurns(content);
    expect(turns.length).toBe(2);
    for (const turn of turns) {
      const slice = content.slice(turn.charStart, turn.charEnd);
      expect(slice.length).toBeLessThanOrEqual(MAX_TURN_CHARS);
      // No lone surrogate at either end.
      expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(slice)).toBe(false);
    }
    expect(turns.map((turn) => content.slice(turn.charStart, turn.charEnd)).join("")).toBe(content);
  });
});

describe("clean view", () => {
  it("drops fillers, stutters and inline timestamps", () => {
    expect(cleanTurnText("Um, we we tried, uh, the rig 00:01:02 and it held.")).toBe(
      "we tried, the rig and it held."
    );
  });

  it("formats and reads timestamps", () => {
    expect(formatTimestamp(3_723_000)).toBe("01:02:03");
    expect(timestampToMs("00:00:03,520")).toBe(3_520);
    expect(timestampToMs("0:03")).toBe(3_000);
  });
});

describe("spans", () => {
  it("every turn span of every fixture slices speech out of the stored content", () => {
    for (const name of [
      "teams-docx.txt",
      "teams-cues-docx.txt",
      "teams-cues-paragraphs-docx.txt",
      "sample.vtt",
      "zoom.vtt",
      "sample.srt",
      "zoom.txt",
      "meet.txt",
      "otter.txt",
      "paste.txt",
      "plain.txt",
    ]) {
      const extension = name.endsWith(".vtt") ? "vtt" : name.endsWith(".srt") ? "srt" : name.includes("docx") ? "docx" : "txt";
      const { content } = prepareTranscriptUpload({ fileName: `f.${extension}`, text: fixture(name) });
      const turns = parseTranscriptTurns(content);
      expect(turns.length, name).toBeGreaterThan(0);
      expectSpansValid(content, turns);
    }
  });
});

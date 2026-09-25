import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cleanTurnText,
  detectTranscriptFormat,
  formatTimestamp,
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

  it("renders a cue-timed Teams .docx to the canonical form", () => {
    const prepared = prepareTranscriptUpload({ fileName: "t.docx", text: fixture("teams-cues-docx.txt") });
    expect(prepared.format).toBe("teams_docx");
    expect(prepared.content).toBe(
      "Dana Whitfield [00:00:00]: Thanks for joining.\n\nPriya Shah [00:00:03]: We could not predict flow at the feeder. So we built a test rig."
    );
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
    "",
  ];

  it("agrees with speakerOfTranscriptLine on every line it names", () => {
    for (const line of cases) {
      const split = splitSpeakerLine(line);
      const speaker = split && split.kind !== "timestamp" ? split.speaker : undefined;
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
      "sample.vtt",
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

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
  transcriptSpeakerNames,
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
    "Priya Shah (she/her): Yes.",
    "Priya Shah (Acme): Yes.",
    "Shah, Priya   0:03",
    "Shah, Priya: We could not.",
    "<v Shah, Priya>We could not.",
    "Well, Dana: we tried.",
    "Result: throughput improved 30%.",
    "Key Findings: two",
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

describe("speaker labels (parser v4)", () => {
  it("keeps the name before pronouns or a company in brackets, so different people stay apart", () => {
    const content = [
      "Priya Shah (she/her): We built the first rig in March.",
      "Tom Becker (he/him): I ran the bench tests.",
      "Anika Rao (they/them): I logged every run.",
      "Priya Shah (she/her): And the forecast lagged.",
    ].join("\n\n");
    const turns = parseTranscriptTurns(content);
    expect(speakers(turns)).toEqual(["Priya Shah", "Tom Becker", "Anika Rao", "Priya Shah"]);
    // The label as written is kept for the role rules.
    expect(turns[0].rawLabel).toBe("Priya Shah (she/her)");

    const company = "Priya Shah (Acme): We built a rig.\n\nTom Becker (Acme): I ran the tests.\n\nDana Whitfield (Banhall): Thanks, both.";
    expect(speakers(parseTranscriptTurns(company))).toEqual(["Priya Shah", "Tom Becker", "Dana Whitfield"]);
    expect(speakerOfTranscriptLine("Marcus Lindqvist (Guest): We tried.")).toBe("Marcus Lindqvist");
    expect(speakerOfTranscriptLine("Dana (Interviewer): Why?")).toBe("Dana");
  });

  it("still takes the name in brackets after a role word", () => {
    expect(speakerOfTranscriptLine("Interviewer (Dana): What changed?")).toBe("Dana");
    expect(speakerOfTranscriptLine("Subject (Marcus Lindqvist, CTO): The feeder model.")).toBe("Marcus Lindqvist");
    expect(speakerOfTranscriptLine("Speaker 2 (Priya): Yes.")).toBe("Priya");
  });

  it("reads Last, First names in Teams headers, VTT voices and labels", () => {
    const teams = "Shah, Priya   0:03\nWe could not predict flow at the feeder.\n\nWhitfield, Dana   0:12\nHow long did it take?\n\nShah, Priya   0:20\nAbout six weeks.";
    const turns = parseTranscriptTurns(teams);
    expect(speakers(turns)).toEqual(["Priya Shah", "Dana Whitfield", "Priya Shah"]);
    expect(turns.map((turn) => turn.startMs)).toEqual([3_000, 12_000, 20_000]);
    expect(turns[0].rawLabel).toBe("Shah, Priya");
    // The question stays with the interviewer, not inside the answer above it.
    expect(teams.slice(turns[1].charStart, turns[1].charEnd)).toBe("How long did it take?");
    expectSpansValid(teams, turns);

    const vtt = prepareTranscriptUpload({
      fileName: "call.vtt",
      text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Shah, Priya>We could not predict flow.\n\n00:00:03.000 --> 00:00:04.000\n<v Whitfield, Dana>How long did it take?",
    });
    // The render keeps the names as written; the turns read them.
    expect(vtt.content).toBe("Shah, Priya [00:00:01]: We could not predict flow.\n\nWhitfield, Dana [00:00:03]: How long did it take?");
    expect(speakers(builtTurns(vtt))).toEqual(["Priya Shah", "Dana Whitfield"]);

    const pasted = "Shah, Priya: We could not predict flow.\n\nWhitfield, Dana: How long did it take?";
    expect(speakers(parseTranscriptTurns(pasted))).toEqual(["Priya Shah", "Dana Whitfield"]);
  });

  it("never reads a sentence opener before a comma as a surname", () => {
    expect(speakerOfTranscriptLine("Well, Dana: we tried a rule-based controller.")).toBeUndefined();
    expect(speakerOfTranscriptLine("So, Priya: what came next?")).toBeUndefined();
    const content = "Dana Whitfield: What did you try?\n\nPriya Shah: A rule-based controller.\nWell, Dana: it oscillated.\n\nDana Whitfield: And then?";
    const turns = parseTranscriptTurns(content);
    expect(speakers(turns)).toEqual(["Dana Whitfield", "Priya Shah", "Dana Whitfield"]);
    expect(turns[1].cleanText).toBe("A rule-based controller. Well, Dana: it oscillated.");
  });

  it("keeps the speakers of text copied from the Teams transcript pane", () => {
    // Name line, time line, speech; with and without blank lines between turns.
    for (const content of [
      "Priya Shah\n0:03\nWe could not predict flow at the feeder.\nDana Whitfield\n0:12\nHow long did it take?\nPriya Shah\n1:02:20\nAbout six weeks, then we rebuilt it.",
      "Priya Shah\n0:03\nWe could not predict flow at the feeder.\n\nDana Whitfield\n0:12\nHow long did it take?\n\nPriya Shah\n1:02:20\nAbout six weeks, then we rebuilt it.",
    ]) {
      const turns = parseTranscriptTurns(content);
      expect(speakers(turns)).toEqual(["Priya Shah", "Dana Whitfield", "Priya Shah"]);
      expect(turns.map((turn) => [turn.startMs, turn.endMs])).toEqual([
        [3_000, 12_000],
        [12_000, 3_740_000],
        [3_740_000, undefined],
      ]);
      expect(content.slice(turns[1].charStart, turns[1].charEnd)).toBe("How long did it take?");
      expectSpansValid(content, turns);
    }
    const lastFirst = "Shah, Priya\n0:03\nWe could not predict flow.\nWhitfield, Dana\n0:12\nWhy not?";
    expect(speakers(parseTranscriptTurns(lastFirst))).toEqual(["Priya Shah", "Dana Whitfield"]);
  });

  it("needs two pane headers, and leaves a Google Meet layout as it was", () => {
    // One name above one time is not a pattern: the text stays plain.
    expect(speakers(parseTranscriptTurns("Priya Shah\n0:03\nWe could not predict flow."))).toEqual([undefined]);
    // A short reply above a Meet timestamp stays in the turn it ends.
    const meet = "00:00:00\nDana Whitfield: Thanks for joining.\nOkay\n00:05:00\nPriya Shah: We built the rig.\nRight\n00:06:00\nDana Whitfield: Why?";
    const turns = parseTranscriptTurns(meet);
    expect(speakers(turns)).toEqual(["Dana Whitfield", "Priya Shah", "Dana Whitfield"]);
    expect(turns[0].cleanText).toBe("Thanks for joining. Okay");
    expect(turns[1].startMs).toBe(300_000);
  });

  it("never lets a heading such as Result: take over the paragraphs after it", () => {
    const notes = [
      "The team started in March with a baseline rig.",
      "They measured flow every hour across the feeder.",
      "Result: throughput improved 30%.",
      "The next quarter focused on the controller.",
      "It held voltage within band.",
    ].join("\n\n");
    const turns = parseTranscriptTurns(notes);
    expect(turns).toHaveLength(5);
    expect(speakers(turns)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(notes.slice(turns[2].charStart, turns[2].charEnd)).toBe("Result: throughput improved 30%.");
    expect(speakerOfTranscriptLine("Result: throughput improved 30%.")).toBeUndefined();
    expect(speakerOfTranscriptLine("Next Steps: rebuild the rig.")).toBeUndefined();
  });

  it("counts a plain label only when the transcript shows a speaker pattern", () => {
    // A lone label in prose names no one, even when it looks like a name.
    const prose = "We built the rig in March.\n\nIt failed twice.\n\nLessons Learned: calibrate first.\n\nThe second rig held.";
    expect(speakers(parseTranscriptTurns(prose))).toEqual([undefined, undefined, undefined, undefined]);
    // Two speakers, each once, is an exchange.
    expect(speakers(parseTranscriptTurns("Dana: How long did the rig take?\n\nPriya: About six weeks."))).toEqual([
      "Dana",
      "Priya",
    ]);
    // So is a single speaker who recurs, one whose label opens the text, or
    // one whose label carries a time.
    expect(speakers(parseTranscriptTurns("Notes.\n\nPriya: We built it.\n\nIt failed.\n\nPriya: Then it held."))).toEqual([
      undefined,
      "Priya",
      "Priya",
    ]);
    expect(speakers(parseTranscriptTurns("Priya Shah: We built it.\n\n[00:12:30] And then it failed."))).toEqual([
      "Priya Shah",
    ]);
    expect(speakers(parseTranscriptTurns("Intro notes.\n\nPriya [00:00:05]: We built it."))).toEqual([undefined, "Priya"]);
    // A heading inside a real transcript stays in the speaker's turn.
    const interview = "Dana Whitfield: What did you measure?\n\nPriya Shah: Flow at the feeder.\nResult: throughput improved 30%.\n\nDana Whitfield: Good.";
    const turns = parseTranscriptTurns(interview);
    expect(speakers(turns)).toEqual(["Dana Whitfield", "Priya Shah", "Dana Whitfield"]);
    expect(turns[1].cleanText).toBe("Flow at the feeder. Result: throughput improved 30%.");
  });

  it("lists every name the speaker labels hold, for placeholders", () => {
    const content = [
      "Shah, Priya (Northwind Labs)   0:03",
      "We could not predict flow.",
      "",
      "Whitfield, Dana   0:12",
      "Why not?",
      "",
      "Tom Becker (he/him)   0:20",
      "The sensor drifted.",
    ].join("\n");
    const turns = parseTranscriptTurns(content);
    const names = transcriptSpeakerNames(content);
    expect(names.labels).toEqual(["Priya Shah", "Dana Whitfield", "Tom Becker"]);
    expect(names.labels).toEqual([...new Set(speakers(turns))]);
    expect(names.otherNames).toEqual(["Shah, Priya", "Whitfield, Dana"]);
    expect(names.organizations).toEqual(["Northwind Labs"]);
    // A label the transcript-wide rules set aside is still a name to hide.
    expect(transcriptSpeakerNames("Notes.\n\nMore notes.\n\nPriya: We built it.")).toEqual({
      labels: [],
      otherNames: ["Priya"],
      organizations: [],
    });
    expect(transcriptSpeakerNames("Priya Shah\n0:03\nWe could not.").otherNames).toEqual(["Priya Shah"]);
  });
});

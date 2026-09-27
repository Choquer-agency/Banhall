import { describe, expect, it } from "vitest";
import {
  detectTranscriptFormat,
  isCueRender,
  parseTranscriptTurns,
  prepareTranscriptUpload,
  speakerOfTranscriptLine,
  splitSpeakerLine,
  transcriptSpeakerNames,
  TRANSCRIPT_PARSER_VERSION,
  type TranscriptTurn,
} from "./transcriptParse";

/**
 * Parser v8 (2026-09-26, audit wave 2, a4 #9 and a2 P2-5): lowercase, email
 * and caseless-script speaker labels, with guards so prose never names a
 * speaker. Every name in these fixtures is fictional.
 */

function speakers(turns: TranscriptTurn[]): Array<string | undefined> {
  return turns.map((turn) => turn.speakerLabel);
}

function expectSpansValid(content: string, turns: TranscriptTurn[]) {
  let previousEnd = 0;
  for (const turn of turns) {
    expect(turn.charStart).toBeGreaterThanOrEqual(previousEnd);
    expect(turn.charEnd).toBeGreaterThan(turn.charStart);
    expect(content.slice(turn.charStart, turn.charEnd).trim()).toBe(content.slice(turn.charStart, turn.charEnd));
    previousEnd = turn.charEnd;
  }
}

it("is version 8", () => {
  expect(TRANSCRIPT_PARSER_VERSION).toBe("8");
});

describe("lowercase labels", () => {
  it("reads lowercase names as speakers, on one line and in turns", () => {
    expect(speakerOfTranscriptLine("priya shah: We rebuilt the rig.")).toBe("priya shah");
    expect(speakerOfTranscriptLine("dana: How long did it take?")).toBe("dana");
    expect(speakerOfTranscriptLine("ludwig van beethoven: Yes.")).toBe("ludwig van beethoven");
    expect(speakerOfTranscriptLine("[00:01:02] priya shah: We rebuilt it.")).toBe("priya shah");
    expect(speakerOfTranscriptLine("interviewer (dana): What changed?")).toBe("dana");
    expect(speakerOfTranscriptLine("speaker 2: Yes.")).toBe("speaker 2");
    const content = "dana whitfield: What did you build?\n\npriya shah: A feeder controller.\nIt held voltage.\n\ndana whitfield: How long?\n\npriya shah: Six weeks.";
    const turns = parseTranscriptTurns(content);
    expect(speakers(turns)).toEqual(["dana whitfield", "priya shah", "dana whitfield", "priya shah"]);
    expect(turns[1].cleanText).toBe("A feeder controller. It held voltage.");
    expectSpansValid(content, turns);
  });

  it("takes a two-speaker exchange where each speaks once, like v7", () => {
    expect(speakers(parseTranscriptTurns("dana: How long did the rig take?\n\npriya: About six weeks."))).toEqual([
      "dana",
      "priya",
    ]);
  });

  it("reads a lowercase name above a time as a header when the transcript has two", () => {
    const content = "priya shah   0:03\nWe could not predict flow.\n\ndana whitfield   0:12\nWhy not?";
    const turns = parseTranscriptTurns(content);
    expect(speakers(turns)).toEqual(["priya shah", "dana whitfield"]);
    expect(turns.map((turn) => turn.startMs)).toEqual([3_000, 12_000]);
  });

  it("marks the line as weak and leaves format detection as v7 had it", () => {
    expect(splitSpeakerLine("priya: yes")).toMatchObject({ kind: "inline", speaker: "priya", weak: "lower" });
    expect(splitSpeakerLine("Priya: yes")).not.toHaveProperty("weak");
    expect(detectTranscriptFormat({ fileName: "notes.docx", text: "priya: one\n\ndana: two\n\npriya: three" })).toBe(
      "unknown"
    );
  });
});

describe("email labels", () => {
  it("reads an email address as the speaker, inline and as a VTT voice", () => {
    expect(speakerOfTranscriptLine("pshah@acme.example: We rebuilt the rig.")).toBe("pshah@acme.example");
    expect(speakerOfTranscriptLine("<v priya.shah@acme.example>We rebuilt it.")).toBe("priya.shah@acme.example");
    expect(splitSpeakerLine("pshah@acme.example: yes")).toMatchObject({ weak: "email" });
    // One email line is enough: an address is never prose.
    const content = "Notes from the call.\n\nMore notes.\n\npshah@acme.example: We rebuilt the rig in March.";
    expect(speakers(parseTranscriptTurns(content))).toEqual([undefined, undefined, "pshah@acme.example"]);
  });

  it("names the speaker of a VTT file with email voices", () => {
    const vtt = prepareTranscriptUpload({
      fileName: "call.vtt",
      text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v priya.shah@acme.example>We could not predict flow.\n\n00:00:03.000 --> 00:00:04.000\n<v dana@firm.example>Why not?",
    });
    const turns = parseTranscriptTurns(vtt.content, { cues: isCueRender(vtt.format, vtt.content) });
    expect(speakers(turns)).toEqual(["priya.shah@acme.example", "dana@firm.example"]);
  });
});

describe("caseless-script labels", () => {
  it("reads Chinese, Korean, Japanese and Arabic names", () => {
    expect(speakerOfTranscriptLine("李伟: 我们重建了测试台。")).toBe("李伟");
    expect(speakerOfTranscriptLine("김민수: 네, 맞습니다.")).toBe("김민수");
    expect(speakerOfTranscriptLine("タナカ・ハナコ: はい。")).toBe("タナカ・ハナコ");
    expect(speakerOfTranscriptLine("محمد علي: نعم")).toBe("محمد علي");
    expect(splitSpeakerLine("李伟: 是的")).toMatchObject({ weak: "caseless" });
  });

  it("keeps a client's lines out of the interviewer's turn", () => {
    const content = "Dana Whitfield: What did you build?\n\n李伟: 一个馈线控制器。\n\nDana Whitfield: How long?\n\n李伟: 六周。";
    const turns = parseTranscriptTurns(content);
    expect(speakers(turns)).toEqual(["Dana Whitfield", "李伟", "Dana Whitfield", "李伟"]);
    expect(turns[1].cleanText).toBe("一个馈线控制器。");
  });

  it("reads caseless names in Teams pane copies and Teams cue documents", () => {
    const pane = "李伟\n0:03\n我们无法预测流量。\n王芳\n0:12\n为什么？";
    expect(speakers(parseTranscriptTurns(pane))).toEqual(["李伟", "王芳"]);
    const docx = prepareTranscriptUpload({
      fileName: "call.docx",
      text: "00:00:01.000 --> 00:00:02.000\n\n李伟\n\n我们无法预测流量。\n\n00:00:03.000 --> 00:00:04.000\n\n王芳\n\n为什么？\n\n00:00:05.000 --> 00:00:06.000\n\n李伟\n\n因为传感器漂移。",
    });
    expect(docx.content).toBe("李伟 [00:00:01]: 我们无法预测流量。\n\n王芳 [00:00:03]: 为什么？\n\n李伟 [00:00:05]: 因为传感器漂移。");
  });
});

describe("guards: prose never names a speaker", () => {
  it("refuses notes words, function words and openers in lowercase", () => {
    for (const line of [
      "note: the rig failed twice.",
      "fyi: the rig failed twice.",
      "the result was: stable",
      "the answer is: yes",
      "however: it held.",
      "well: we tried.",
      "next steps: rebuild the rig.",
      "key point: the drift.",
      "so we tried: two options",
      "e.g.: a feeder",
      "q: why?",
      "a: because.",
      "注意: 这是备注。",
      "问题: 为什么？",
    ]) {
      expect(speakerOfTranscriptLine(line), line).toBeUndefined();
    }
  });

  it("refuses links, times and timestamps", () => {
    for (const line of [
      "http://example.com/a: b",
      "see https://example.com: for details",
      "at 10:30: we started",
      "10:30: we started",
      "10:30 the meeting began",
      "mailto:pshah@acme.example: hi",
    ]) {
      expect(speakerOfTranscriptLine(line), line).toBeUndefined();
    }
  });

  it("keeps a lone lowercase or caseless label in notes as text", () => {
    const notes = "The team started in March.\n\nThey measured flow hourly.\n\nthermal drift: it held within band.\n\nThe next quarter focused on control.";
    expect(speakers(parseTranscriptTurns(notes))).toEqual([undefined, undefined, undefined, undefined]);
    const chinese = "团队三月开始。\n\n他们每小时测量流量。\n\n结果是: 很好。";
    expect(speakers(parseTranscriptTurns(chinese))).toEqual([undefined, undefined, undefined]);
    // A lowercase line of speech above a time is not a pane header.
    const speech = "sounds good\n0:03\nWe rebuilt it.\nthermal drift\n0:12\nIt held.";
    expect(speakers(parseTranscriptTurns(speech))).toEqual([undefined]);
  });

  it("keeps a lowercase heading inside a v7 transcript in the speaker's turn", () => {
    const content = "Dana Whitfield: What did you measure?\n\nPriya Shah: Flow at the feeder.\nthermal drift: within band.\n\nDana Whitfield: Good.";
    const turns = parseTranscriptTurns(content);
    expect(speakers(turns)).toEqual(["Dana Whitfield", "Priya Shah", "Dana Whitfield"]);
    expect(turns[1].cleanText).toBe("Flow at the feeder. thermal drift: within band.");
    // It is still hidden, as written.
    expect(transcriptSpeakerNames(content).looseLabels).toEqual(["thermal drift"]);
  });

  it("keeps lowercase caption lines in a VTT or SRT cue as text", () => {
    const srt = prepareTranscriptUpload({
      fileName: "call.srt",
      text: "1\n00:00:01,000 --> 00:00:03,000\nthermal drift: it held.\n\n2\n00:00:04,500 --> 00:00:06,000\nso we built a rig.",
    });
    expect(srt.content).toBe("[00:00:01] thermal drift: it held.\n\n[00:00:04] so we built a rig.");
  });
});

describe("names to hide", () => {
  it("lists weak labels that open turns as labels", () => {
    const names = transcriptSpeakerNames("priya shah: one\n\ndana: two\n\npriya shah: three");
    expect(names.labels).toEqual(["priya shah", "dana"]);
    expect(names.looseLabels).toBeUndefined();
  });

  it("keeps a weak label no turn took as a loose label, hidden as written only", () => {
    const names = transcriptSpeakerNames("Notes.\n\nMore notes.\n\npriya: We built it.");
    expect(names).toEqual({ labels: [], otherNames: [], organizations: [], looseLabels: ["priya"] });
    expect(transcriptSpeakerNames("团队三月开始。\n\n李伟: 很好。").looseLabels).toEqual(["李伟"]);
  });

  it("lists an email label as a label", () => {
    expect(transcriptSpeakerNames("pshah@acme.example: We built it.").labels).toEqual(["pshah@acme.example"]);
  });
});

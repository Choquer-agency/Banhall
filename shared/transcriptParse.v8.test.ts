import { describe, expect, it } from "vitest";
import {
  isCueRender,
  parseTranscriptTurns,
  prepareTranscriptUpload,
  speakerOfTranscriptLine,
  speakersAtOffsets,
  splitSpeakerLine,
  transcriptSpeakerNames,
  TRANSCRIPT_PARSER_VERSION,
  weakSpeakerLine,
  type TranscriptTurn,
} from "./transcriptParse";
import * as v7 from "./__fixtures__/transcriptParseV7";
import { inferSpeakerRoles } from "../convex/lib/transcriptSpeakers";

/**
 * Parser v8 (2026-09-26, audit wave 2, a2 P2-5 and a4 #9; review fixes of
 * the same day): lowercase, email and caseless-script speaker labels, which
 * open turns only on strong evidence. Every name here is fictional.
 */

function speakers(turns: TranscriptTurn[]): Array<string | undefined> {
  return turns.map((turn) => turn.speakerLabel);
}

/** Turns under v8 are exactly v7's. */
function expectAsV7(content: string, options: { cues?: boolean } = {}) {
  expect(parseTranscriptTurns(content, options)).toEqual(v7.parseTranscriptTurns(content, options));
  const names = transcriptSpeakerNames(content, options);
  const before = v7.transcriptSpeakerNames(content, options);
  expect({ labels: names.labels, otherNames: names.otherNames, organizations: names.organizations }).toEqual(before);
}

it("is version 8", () => {
  expect(TRANSCRIPT_PARSER_VERSION).toBe("8");
});

describe("weak labels that open turns", () => {
  it("reads a lowercase exchange where each speaker alternates", () => {
    const content = "dana whitfield: What did you build?\n\npriya shah: A feeder controller.\nIt held voltage.\n\ndana whitfield: How long?\n\npriya shah: Six weeks.";
    const turns = parseTranscriptTurns(content);
    expect(speakers(turns)).toEqual(["dana whitfield", "priya shah", "dana whitfield", "priya shah"]);
    expect(turns[1].cleanText).toBe("A feeder controller. It held voltage.");
  });

  it("reads a lowercase label that is a v7 speaker in another case as that speaker", () => {
    const content = "Dana Whitfield: What did you build?\n\nPriya Shah: A controller.\n\npriya shah: And a rig.";
    const turns = parseTranscriptTurns(content);
    expect(speakers(turns)).toEqual(["Dana Whitfield", "Priya Shah", "Priya Shah"]);
    expect(transcriptSpeakerNames(content).otherNames).toContain("priya shah");
  });

  it("reads an email label, once is enough", () => {
    const content = "Notes from the call.\n\nMore notes.\n\npshah@acme.example: We rebuilt the rig in March.";
    expect(speakers(parseTranscriptTurns(content))).toEqual([undefined, undefined, "pshah@acme.example"]);
    const vtt = prepareTranscriptUpload({
      fileName: "call.vtt",
      text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v priya.shah@acme.example>We could not predict flow.\n\n00:00:03.000 --> 00:00:04.000\n<v dana@firm.example>Why not?",
    });
    expect(speakers(parseTranscriptTurns(vtt.content, { cues: isCueRender(vtt.format, vtt.content) }))).toEqual([
      "priya.shah@acme.example",
      "dana@firm.example",
    ]);
  });

  it("reads a caseless speaker alternating with a v7 speaker written the same way", () => {
    const content = "Dana Whitfield: What did you build?\n\n李伟: 一个馈线控制器。\n\nDana Whitfield: How long?\n\n李伟: 六周。";
    const turns = parseTranscriptTurns(content);
    expect(speakers(turns)).toEqual(["Dana Whitfield", "李伟", "Dana Whitfield", "李伟"]);
    expect(turns[1].cleanText).toBe("一个馈线控制器。");
  });

  it("reads a full-width colon and a colon with no space after a caseless name (P2-3)", () => {
    for (const content of [
      "李伟：我们重建了测试台。\n\n王芳：为什么？\n\n李伟：因为传感器漂移。\n\n王芳：多久？",
      "李伟:我们重建了测试台。\n\n王芳:为什么？\n\n李伟:因为传感器漂移。\n\n王芳:多久？",
    ]) {
      const turns = parseTranscriptTurns(content);
      expect(speakers(turns), content).toEqual(["李伟", "王芳", "李伟", "王芳"]);
      expect(turns[0].cleanText).toBe("我们重建了测试台。");
    }
    // Once is not an exchange.
    expectAsV7("团队三月开始。\n\n李伟：我们重建了测试台。");
  });

  it("reads caseless names in Teams pane copies and Teams cue documents that alternate", () => {
    const pane = "李伟\n0:03\n我们无法预测流量。\n王芳\n0:12\n为什么？\n李伟\n0:20\n传感器漂移。\n王芳\n0:31\n多久？";
    expect(speakers(parseTranscriptTurns(pane))).toEqual(["李伟", "王芳", "李伟", "王芳"]);
    const otter = "李伟  0:03\n我们无法预测流量。\n\n王芳  0:12\n为什么？\n\n李伟  0:20\n传感器漂移。\n\n王芳  0:31\n多久？";
    expect(speakers(parseTranscriptTurns(otter))).toEqual(["李伟", "王芳", "李伟", "王芳"]);
    // Two pane names, each once, are not an exchange: the text stays as v7 read it.
    expectAsV7("李伟\n0:03\n我们无法预测流量。\n王芳\n0:12\n为什么？");
    const docx = prepareTranscriptUpload({
      fileName: "call.docx",
      text: "00:00:01.000 --> 00:00:02.000\n\n李伟\n\n我们无法预测流量。\n\n00:00:03.000 --> 00:00:04.000\n\n王芳\n\n为什么？\n\n00:00:05.000 --> 00:00:06.000\n\n李伟\n\n因为传感器漂移。\n\n00:00:07.000 --> 00:00:08.000\n\n王芳\n\n多久？",
    });
    expect(docx.content).toBe(
      "李伟 [00:00:01]: 我们无法预测流量。\n\n王芳 [00:00:03]: 为什么？\n\n李伟 [00:00:05]: 因为传感器漂移。\n\n王芳 [00:00:07]: 多久？"
    );
  });

  it("keeps per-line reads at v7 and offers weak candidates separately", () => {
    expect(speakerOfTranscriptLine("priya shah: We rebuilt the rig.")).toBeUndefined();
    expect(splitSpeakerLine("priya: yes")).toBeUndefined();
    expect(weakSpeakerLine("priya: yes")).toMatchObject({ kind: "inline", speaker: "priya", weak: "lower" });
    expect(weakSpeakerLine("李伟：是的")).toMatchObject({ speaker: "李伟", weak: "caseless" });
    expect(weakSpeakerLine("Priya: yes")).toBeUndefined();
  });
});

describe("no new speaker without evidence (review P1-1)", () => {
  it("leaves a lowercase caption line in a cue as text", () => {
    for (const text of [
      "1\n00:00:01,000 --> 00:00:03,000\nthermal drift: it held.\n\n2\n00:00:04,500 --> 00:00:06,000\nso we built a rig.",
      "1\n00:00:12,000 --> 00:00:14,000\nworst case: we redesign.\n\n2\n00:00:15,000 --> 00:00:16,000\nthen we tested it.",
    ]) {
      const srt = prepareTranscriptUpload({ fileName: "call.srt", text });
      expect(srt).toEqual(v7.prepareTranscriptUpload({ fileName: "call.srt", text }));
      expectAsV7(srt.content, { cues: true });
    }
    expectAsV7("[00:00:01] thermal drift: it held.\n\n[00:00:12] worst case: we redesign.", { cues: true });
  });

  it("never reads a label with a time or a digit in it", () => {
    expectAsV7("Priya Shah: We ran it overnight.\naround 10:30: the pump stalled.\n\nDana Whitfield: And then?");
    expect(weakSpeakerLine("around 10:30: the pump stalled.")).toBeUndefined();
    // Otter writes a name above a time; "roughly 2:30" is speech.
    expectAsV7("Priya Shah  0:03\nWe tested it for\nroughly 2:30\nhours.\n\nDana Whitfield  0:12\nWhy?");
    expect(weakSpeakerLine("roughly 2:30")).toMatchObject({ kind: "header" });
    expect(weakSpeakerLine("speaker 2: yes")).toBeUndefined();
  });

  it("leaves recurring headings inside a speaker's turns in that speaker's turns", () => {
    const docx = [
      "Priya Shah   0:03",
      "root cause: the sensor drifted.",
      "",
      "Dana Whitfield   0:40",
      "And the fix?",
      "",
      "Priya Shah   0:52",
      "root cause: a loose clamp, the second time.",
      "",
      "Dana Whitfield   1:30",
      "Understood.",
    ].join("\n");
    expectAsV7(docx);
    const inline = "Dana Whitfield: What failed?\n\nPriya Shah: Two things.\nroot cause: drift.\n\nDana Whitfield: And?\n\nPriya Shah: Then this.\nroot cause: a clamp.";
    expectAsV7(inline);
  });

  it("leaves bilingual lines as text", () => {
    const bilingual = "english: We rebuilt the rig.\nfrançais: Nous avons reconstruit le banc.\nenglish: It held.\nfrançais: Il a tenu.";
    expectAsV7(bilingual);
    expectAsV7("中文: 我们重建了测试台。\n英文: We rebuilt the rig.\n中文: 它稳定了。\n英文: It held.");
  });

  it("never lets a lowercase label beside v7 speakers take the client's words", () => {
    const content = [
      "Dana Whitfield: What did you measure?",
      "Priya Shah: Flow at the feeder.",
      "thermal drift: within band.",
      "Priya Shah: Then pressure.",
      "thermal drift: out of band twice.",
      "Dana Whitfield: Why?",
      "Priya Shah: A loose clamp.",
    ].join("\n\n");
    expectAsV7(content);
    const roles = inferSpeakerRoles(parseTranscriptTurns(content), { staffNames: ["Dana Whitfield"], clientNames: ["Priya Shah"] });
    expect(roles.map((guess) => [guess.label, guess.role])).toEqual([
      ["Dana Whitfield", "interviewer"],
      ["Priya Shah", "client"],
    ]);
  });

  it("leaves a lone weak label in notes as text", () => {
    expectAsV7("The team started in March.\n\nthermal drift: it held within band.\n\nThe next quarter focused on control.");
    expectAsV7("团队三月开始。\n\n结果是: 很好。");
    expectAsV7("dana: How long did the rig take?\n\npriya: About six weeks.");
  });

  it("leaves data readings and code as text", () => {
    expectAsV7("rate: 5\ntemp: 20\nrate: 6\ntemp: 21");
    expectAsV7("  type: message\n  role: assistant\n  type: message\n  role: assistant");
  });
});

describe("Teams pane copies (review P2-1)", () => {
  it("keeps pane headers whose speech opens with a lowercase phrase and a colon", () => {
    const pane = "Priya Shah\n0:03\nflow rate: thirty litres a minute.\nDana Whitfield\n0:12\nhow did you measure it?\nPriya Shah\n0:20\nwith a clamp meter.";
    expect(speakers(parseTranscriptTurns(pane))).toEqual(["Priya Shah", "Dana Whitfield", "Priya Shah"]);
    expectAsV7(pane);
  });
});

describe("names to hide", () => {
  it("lists weak labels that open turns as labels", () => {
    const names = transcriptSpeakerNames("priya shah: one\n\ndana: two\n\npriya shah: three\n\ndana: four");
    expect(names.labels).toEqual(["priya shah", "dana"]);
    expect(names.looseLabels).toBeUndefined();
  });

  it("keeps a weak label that opens no turn as a loose label, with its written form", () => {
    expect(transcriptSpeakerNames("Notes.\n\nMore notes.\n\npriya: We built it.").looseLabels).toEqual(["priya"]);
    expect(transcriptSpeakerNames("团队三月开始。\n\n李伟: 很好。").looseLabels).toEqual(["李伟"]);
    expect(transcriptSpeakerNames("Notes.\n\ndana (acme): We built it.").looseLabels).toEqual(["dana", "dana (acme)"]);
  });

  it("hides the lowercase names in a promoted label's brackets", () => {
    const names = transcriptSpeakerNames("dana (acme): one\n\npriya (northwind labs): two\n\ndana (acme): three\n\npriya (northwind labs): four");
    expect(names.labels).toEqual(["dana", "priya"]);
    expect(names.organizations).toEqual(expect.arrayContaining(["acme", "northwind labs"]));
  });
});

describe("citation places read the analyzed turns (review P2-5)", () => {
  it("names the turn's speaker, never an unguarded line read", () => {
    const content = "Priya Shah: We measured flow.\nthermal drift: within band.\n\nDana Whitfield: Why?";
    const offset = content.indexOf("within band");
    expect(speakersAtOffsets(content, [offset, content.indexOf("Why?")])).toEqual(["Priya Shah", "Dana Whitfield"]);
    const exchange = "dana: What failed?\n\npriya: The clamp.\n\ndana: And?\n\npriya: The sensor.";
    expect(speakersAtOffsets(exchange, [exchange.indexOf("The clamp")])).toEqual(["priya"]);
    expect(speakersAtOffsets("Just notes.", [2])).toEqual([undefined]);
  });
});

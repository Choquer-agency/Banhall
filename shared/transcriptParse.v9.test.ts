import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTranscriptTurns, speakersAtOffsets, transcriptSpeakerNames } from "./transcriptParse";
import * as v7 from "./__fixtures__/transcriptParseV7";
import { transcriptNamesToHide } from "../convex/lib/transcriptPlaceholders";

/**
 * Parser v9 (2026-09-26, live test): the Northwind transcript's second line,
 * "Project: Low-temperature ...", was read as a speaker "Project" and hidden
 * as a person. A metadata heading above the exchange is text now; the same
 * word still names a speaker inside an exchange, or when it speaks again.
 * Every name here is fictional.
 */

const NORTHWIND = readFileSync(new URL("./__fixtures__/transcripts/metadata-header.txt", import.meta.url), "utf8");

function names(content: string): string[] {
  const read = transcriptSpeakerNames(content);
  return [...read.labels, ...read.otherNames, ...(read.looseLabels ?? [])];
}

describe("metadata headings above the exchange", () => {
  it("reads the Northwind header as text: no speaker, no name to hide", () => {
    const turns = parseTranscriptTurns(NORTHWIND);
    expect(turns[0].speakerLabel).toBeUndefined();
    expect(turns[0].cleanText).toContain("Project: Low-temperature structural bonding");
    expect(turns[0].cleanText).toContain("Client: Northwind Test Labs");
    expect(turns.slice(1).map((turn) => turn.speakerLabel)).toEqual([
      "Dana Whitfield", "Maren Kowalczyk", "Elliot Fairbanks", "Dana Whitfield", "Elliot Fairbanks",
    ]);
    expect(names(NORTHWIND)).not.toContain("Project");
    expect(names(NORTHWIND)).not.toContain("Client");
    expect(speakersAtOffsets(NORTHWIND, [NORTHWIND.indexOf("Low-temperature")])).toEqual([undefined]);
    // v8 took both as speakers.
    expect(v7.transcriptSpeakerNames(NORTHWIND).labels).toEqual(expect.arrayContaining(["Project", "Client"]));
  });

  it("keeps the header out of the placeholder map the project builds", () => {
    const hidden = transcriptNamesToHide({ content: NORTHWIND, sourceFormat: "txt" } as never, []);
    expect(hidden.people).toEqual(["Dana Whitfield", "Elliot Fairbanks", "Maren Kowalczyk"]);
    expect(hidden.phrases).toEqual([]);
  });

  it("reads the other heading words the same way", () => {
    const text = [
      "Topic: Cold-cure adhesives",
      "Company: Northwind Test Labs",
      "Subject: Field trials",
      "Recorded: September 18",
      "",
      "Dana Whitfield: What did you set out to do?",
      "",
      "Maren Kowalczyk: Bond brackets at five degrees.",
    ].join("\n");
    expect(parseTranscriptTurns(text).map((turn) => turn.speakerLabel)).toEqual([
      undefined, "Dana Whitfield", "Maren Kowalczyk",
    ]);
    expect(names(text)).toEqual(["Dana Whitfield", "Maren Kowalczyk"]);
  });
});

describe("the same words still name speakers", () => {
  it("inside an exchange, where Client answers once", () => {
    const text = ["Interviewer: What was uncertain?", "Client: The loop could not hold peak load."].join("\n");
    expect(parseTranscriptTurns(text).map((turn) => turn.speakerLabel)).toEqual(["Interviewer", "Client"]);
  });

  it("when a role's first line is speech, even above the rest of the exchange", () => {
    const text = ["Client: We tried heating blankets first.", "", "Dana Whitfield: Why did that fail?"].join("\n");
    expect(parseTranscriptTurns(text).map((turn) => turn.speakerLabel)).toEqual(["Client", "Dana Whitfield"]);
  });

  it("when the label speaks again", () => {
    const text = ["Client: Northwind Test Labs", "", "Dana Whitfield: Go on.", "", "Client: Brackets fail in the cold."].join("\n");
    expect(parseTranscriptTurns(text).map((turn) => turn.speakerLabel)).toEqual(["Client", "Dana Whitfield", "Client"]);
  });

  it("when nothing follows it: one line alone reads as v8 read it", () => {
    const text = "Project: Low-temperature structural bonding of composite sensor brackets";
    expect(parseTranscriptTurns(text)).toEqual(v7.parseTranscriptTurns(text));
  });
});

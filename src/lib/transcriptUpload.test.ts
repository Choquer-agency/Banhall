import { describe, expect, it } from "vitest";
import {
  readPastedTranscript,
  readTranscriptFile,
  transcriptContentHash,
  TranscriptFileError,
} from "./transcriptUpload";

describe("readTranscriptFile", () => {
  it("renders a WebVTT file to the canonical text and names its format", async () => {
    const file = new File(
      ["WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Dana Whitfield>What did you try?</v>\n"],
      "call.vtt"
    );
    const read = await readTranscriptFile(file);
    expect(read).toMatchObject({
      label: "call.vtt",
      format: "vtt",
      formatLabel: "WebVTT",
      content: "Dana Whitfield [00:00:01]: What did you try?",
    });
  });

  it("detects Zoom text and keeps it verbatim", async () => {
    const text = "[Dana] 10:02:33\nHello.\n\n[Priya] 10:02:37\nHi.";
    const read = await readTranscriptFile(new File([text], "zoom.txt"));
    expect(read.format).toBe("zoom");
    expect(read.content).toBe(text);
  });

  it("refuses other file types and over-long text with a sentence the writer can act on", async () => {
    await expect(readTranscriptFile(new File(["x"], "notes.pdf"))).rejects.toThrow(
      "notes.pdf is not a transcript file. Transcripts can be Word (.docx), WebVTT (.vtt), SubRip (.srt) or text (.txt) files."
    );
    await expect(readTranscriptFile(new File(["x".repeat(500_001)], "long.txt"))).rejects.toBeInstanceOf(
      TranscriptFileError
    );
    await expect(readTranscriptFile(new File(["   "], "empty.txt"))).rejects.toThrow(/Couldn't extract any text/);
  });
});

describe("pasted text and hashing", () => {
  it("labels pasted text as pasted", () => {
    expect(readPastedTranscript("Dana: Hi.\n\nPriya: Hello.").format).toBe("paste");
  });

  it("hashes like the server", async () => {
    expect(await transcriptContentHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { parseTranscriptTurns, prepareTranscriptUpload } from "../../shared/transcriptParse";
import {
  docxTranscriptText,
  readPastedTranscript,
  releaseOriginalsOnFailure,
  readTranscriptFile,
  transcriptContentHash,
  TranscriptFileError,
} from "./transcriptUpload";

const CUES = [
  ["0:0:0.0 --> 0:0:3.520", "Dana Whitfield", "Thanks for joining."],
  ["0:0:3.520 --> 0:0:9.100", "Priya Shah", "We could not predict flow at the feeder."],
  ["0:0:9.100 --> 0:0:12.0", "Priya Shah", "So we built a test rig."],
] as const;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A Word package holding `body` as its document body, as mammoth's Node build reads it. */
async function docxInput(body: string): Promise<{ buffer: Uint8Array }> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return { buffer: await zip.generateAsync({ type: "uint8array" }) };
}

/**
 * The cue-timed Teams export as Teams writes it: one paragraph per cue, with
 * soft line breaks (`w:br`) between the timing, the name and the speech. The
 * run layout copies a real export (the Apache-2.0 sample in
 * github.com/endjin/TeamsTranscript, Artefacts/Transcripts/transcript-01.docx).
 */
function teamsCueBody(): string {
  return CUES.map(
    ([timing, name, speech]) =>
      `<w:p><w:r><w:t>${escapeXml(timing)}</w:t></w:r><w:r><w:br/><w:t>${escapeXml(name)}</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>${escapeXml(speech)}</w:t></w:r></w:p>`
  ).join("");
}

/** The same cues with the timing, the name and the speech each in its own paragraph. */
function paragraphCueBody(): string {
  return CUES.flatMap((cue) => cue.map((text) => `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`)).join("");
}

function fixture(name: string): string {
  return readFileSync(new URL(`../../shared/__fixtures__/transcripts/${name}`, import.meta.url), "utf8");
}

const CANONICAL_CUES =
  "Dana Whitfield [00:00:00]: Thanks for joining.\n\nPriya Shah [00:00:03]: We could not predict flow at the feeder. So we built a test rig.";

describe("cue-timed Teams .docx", () => {
  it("keeps the soft line breaks of a Teams export, so every cue keeps its speaker", async () => {
    const text = await docxTranscriptText(await docxInput(teamsCueBody()));
    const prepared = prepareTranscriptUpload({ fileName: "Helios.docx", text, intake: "file" });
    expect(prepared.format).toBe("teams_docx");
    expect(prepared.content).toBe(CANONICAL_CUES);
    expect(parseTranscriptTurns(prepared.content).map((turn) => [turn.speakerLabel, turn.startMs])).toEqual([
      ["Dana Whitfield", 0],
      ["Priya Shah", 3_000],
    ]);
  });

  it("reads cues whose timing, name and speech are separate paragraphs", async () => {
    const text = await docxTranscriptText(await docxInput(paragraphCueBody()));
    const prepared = prepareTranscriptUpload({ fileName: "Helios.docx", text, intake: "file" });
    expect(prepared.format).toBe("teams_docx");
    expect(prepared.content).toBe(CANONICAL_CUES);
  });

  it("the parser fixtures are the exact text extraction gives for both layouts", async () => {
    expect(await docxTranscriptText(await docxInput(teamsCueBody()))).toBe(fixture("teams-cues-docx.txt"));
    expect(await docxTranscriptText(await docxInput(paragraphCueBody()))).toBe(
      fixture("teams-cues-paragraphs-docx.txt")
    );
  });

  it("changes nothing but soft line breaks: tabs, paragraphs, tables and page breaks read as before", async () => {
    const body =
      `<w:p><w:r><w:t>Dana Whitfield</w:t></w:r><w:r><w:tab/><w:t>0:03</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Thanks.</w:t></w:r><w:r><w:br w:type="page"/><w:t>Next</w:t></w:r></w:p>` +
      `<w:p></w:p>` +
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const mammoth = await import("mammoth");
    const input = await docxInput(body);
    const raw = (await mammoth.extractRawText(input as unknown as Parameters<typeof mammoth.extractRawText>[0])).value;
    expect(await docxTranscriptText(input)).toBe(raw);
  });
});

describe("Otter .docx", () => {
  // Shaped after Otter's documented turn layout (name, time, then the
  // speech), in both ways Word can hold it; not a real export.
  const turns = [
    ["Speaker 1", "0:00", "Thanks for joining."],
    ["Priya Shah", "0:05", "We could not predict flow at the feeder."],
  ] as const;
  const footer = `<w:p><w:r><w:t>Transcribed by https://otter.ai</w:t></w:r></w:p>`;

  it("reads name and time headers held as separate paragraphs", async () => {
    const body =
      turns
        .map(
          ([name, time, speech]) =>
            `<w:p><w:r><w:t xml:space="preserve">${name}  ${time}</w:t></w:r></w:p><w:p><w:r><w:t>${escapeXml(speech)}</w:t></w:r></w:p>`
        )
        .join("") + footer;
    const text = await docxTranscriptText(await docxInput(body));
    const prepared = prepareTranscriptUpload({ fileName: "Helios.docx", text, intake: "file" });
    expect(prepared.format).toBe("otter");
    expect(parseTranscriptTurns(prepared.content).map((turn) => [turn.speakerLabel, turn.startMs])).toEqual([
      ["Speaker 1", 0],
      ["Priya Shah", 5_000],
    ]);
  });

  it("reads a header and its speech held in one paragraph with a soft break", async () => {
    const body =
      turns
        .map(
          ([name, time, speech]) =>
            `<w:p><w:r><w:t>${name}</w:t><w:tab/><w:t>${time}</w:t><w:br/><w:t>${escapeXml(speech)}</w:t></w:r></w:p>`
        )
        .join("") + footer;
    const text = await docxTranscriptText(await docxInput(body));
    const prepared = prepareTranscriptUpload({ fileName: "Helios.docx", text, intake: "file" });
    expect(prepared.format).toBe("otter");
    const parsed = parseTranscriptTurns(prepared.content);
    expect(parsed.map((turn) => [turn.speakerLabel, turn.startMs])).toEqual([
      ["Speaker 1", 0],
      ["Priya Shah", 5_000],
    ]);
    expect(prepared.content.slice(parsed[0].charStart, parsed[0].charEnd)).toBe("Thanks for joining.");
  });
});

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

describe("releaseOriginalsOnFailure", () => {
  it("releases the uploaded originals when the save is refused, then passes the refusal on", async () => {
    const discard = vi.fn(async () => null);
    const refusal = new Error("This transcript is already added (Day 1.docx)");
    await expect(
      releaseOriginalsOnFailure(["storage-1"], discard, async () => {
        throw refusal;
      })
    ).rejects.toBe(refusal);
    expect(discard).toHaveBeenCalledWith(["storage-1"]);
  });

  it("keeps the originals when the save succeeds, and never lets a failed release hide the refusal", async () => {
    const discard = vi.fn(async () => null);
    await expect(releaseOriginalsOnFailure(["storage-1"], discard, async () => "transcript-1")).resolves.toBe(
      "transcript-1"
    );
    expect(discard).not.toHaveBeenCalled();

    const refusal = new Error("Combined transcript text is too large");
    await expect(
      releaseOriginalsOnFailure(
        ["storage-2"],
        async () => {
          throw new Error("offline");
        },
        async () => {
          throw refusal;
        }
      )
    ).rejects.toBe(refusal);
    // Nothing to release: no call.
    const none = vi.fn(async () => null);
    await expect(
      releaseOriginalsOnFailure([], none, async () => {
        throw refusal;
      })
    ).rejects.toBe(refusal);
    expect(none).not.toHaveBeenCalled();
  });
});

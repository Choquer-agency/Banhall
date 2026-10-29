import { describe, expect, it } from "vitest";
import { briefQuoteLocator, type BriefSourceAdapter } from "./ai/brief";
import { BRIEF_EXCERPTS, BRIEF_INPUT_BUDGET, briefMessageWithReport, briefSourcesFit, buildBriefUserMessage } from "./lib/briefRequest";
import { briefInputsHash } from "./lib/briefInputsHash";

// Phase D, step 1 (owner decision "2026-10-28 (fourth)"): over the budget,
// the Brief reads the parts of each file that best match the interviews,
// and a quote is found only in what it sent.

function filler(seed: number, chars: number): string {
  let text = "";
  for (let i = 0; text.length < chars; i++) text += `The gasket held after ${(seed * 31 + i * 7) % 900} cycles on the bench. `;
  return text.slice(0, chars);
}

const FACT = "The cryogenic soak at minus 60 cracked the Viton membrane on trial 418.";
const UNSENT = "the pressure gauge was recalibrated by the night crew";

function sources() {
  const rows: Array<{ _id: string; kind: string; label: string; content: string; contentHash: string; transcriptId?: string }> = [
    {
      _id: "t1",
      kind: "transcript",
      label: "Interview",
      content: "Interviewer: What failed?\nClient: The Viton membrane cracked during the cryogenic soak, twice.",
      contentHash: "h-t1",
      transcriptId: "tr1",
    },
  ];
  for (let index = 1; index <= 30; index++) {
    let content = filler(index, 30_000);
    if (index === 25) content = `${filler(99, 15_000)} ${FACT} ${filler(98, 14_000)}`;
    if (index === 30) content = `${filler(97, 15_000)} Later ${UNSENT}. ${filler(96, 14_000)}`;
    rows.push({ _id: `d${index}`, kind: "project_document", label: `other:file-${index}.md`, content, contentHash: `h-d${index}` });
  }
  return rows;
}

describe("the Brief over its budget (2026-10-28, fourth)", () => {
  it("sends the interview whole and the part of a late file that matches it, with the excerpts notice", () => {
    const rows = sources();
    const message = buildBriefUserMessage(rows as never);
    expect(message).toContain("The Viton membrane cracked during the cryogenic soak, twice.");
    expect(message).toContain(FACT);
    expect(message).toContain(BRIEF_EXCERPTS.noticePrefix);
    expect(message).not.toContain(UNSENT);
    const { report } = briefMessageWithReport(rows as never);
    const file25 = report.find((entry) => (entry.source as unknown as { _id: string })._id === "d25")!;
    expect(file25.sent).toBeGreaterThan(0);
    expect(file25.sent).toBeLessThan(file25.total);
    expect(file25.ranges.length).toBeGreaterThan(0);
    // The same request every time.
    expect(buildBriefUserMessage(rows as never)).toBe(message);
  });

  it("finds a quote in what it sent, at its place in the whole file, and never in text it left out", async () => {
    const rows = sources();
    const adapter: BriefSourceAdapter<string> = { sources: rows as never, speakers: async (spans) => spans.map(() => "evidence" as never) };
    const locate = briefQuoteLocator(adapter);
    const found = await locate(FACT, false);
    const file25 = rows.find((row) => row._id === "d25")!;
    expect(found).toMatchObject({ sourceId: "d25", exactExcerpt: FACT, startOffset: file25.content.indexOf(FACT) });
    expect(await locate(UNSENT, false)).toBeNull();
  });
});

describe("Brief review fixes (2026-10-28)", () => {
  const big = (label: string, seed: number, uploaderRole?: string) => ({
    _id: label,
    kind: "project_document",
    label,
    content: filler(seed, 199_000),
    contentHash: `h-${label}`,
    ...(uploaderRole ? { uploaderRole } : {}),
  });

  it("sends writer's notes whole only when an internal user uploaded them", () => {
    const rows = [sources()[0]!, big("other:a.md", 1), big("other:b.md", 2), big("writer_notes:notes.md", 3, "writer"), big("writer_notes:client-notes.md", 4, "client")];
    const { report } = briefMessageWithReport(rows as never);
    const sentOf = (id: string) => report.find((entry) => (entry.source as unknown as { _id: string })._id === id)!;
    expect(sentOf("writer_notes:notes.md").sent).toBe(sentOf("writer_notes:notes.md").total);
    expect(sentOf("writer_notes:client-notes.md").sent).toBeLessThan(sentOf("writer_notes:client-notes.md").total);
  });

  it("keeps the old path exactly at the total, and chooses one character over it", () => {
    const total = BRIEF_INPUT_BUDGET.totalTokens * 4;
    // Each file under the per-source limit, so every character counts.
    const at = [
      { _id: "t", kind: "transcript", label: "I", content: "x".repeat(100), contentHash: "h", transcriptId: "tr" },
      { _id: "d", kind: "project_document", label: "other:d.md", content: "y".repeat(300_000), contentHash: "h2" },
      { _id: "d2", kind: "project_document", label: "other:d2.md", content: "w".repeat(total - 100 - 300_000), contentHash: "h4" },
    ];
    expect(briefSourcesFit(at as never)).toBe(true);
    const over = [...at, { _id: "e", kind: "project_document", label: "other:e.md", content: "z", contentHash: "h3" }];
    expect(briefSourcesFit(over as never)).toBe(false);
  });

  it("says the parts came in order when none matched the interviews", () => {
    const rows = sources().map((row) => (row.kind === "transcript" ? { ...row, content: "Interviewer: Hello.\nClient: Hi." } : row));
    const message = buildBriefUserMessage(rows as never);
    expect(message).toContain(BRIEF_EXCERPTS.noticeUnmatchedPrefix);
  });

  it("keeps the inputs hash as it was, so a Brief made before (writers' edits included) is still reused for the same sources", async () => {
    const rows = sources();
    const { sha256 } = await import("./lib/contracts");
    const plain = async (list: typeof rows) =>
      sha256([...list].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)).map((row) => row.contentHash).join("|"));
    expect(await briefInputsHash(rows.slice(0, 3) as never)).toBe(await plain(rows.slice(0, 3)));
    expect(await briefInputsHash(rows as never)).toBe(await plain(rows));
  });

  it("reserves at least the request it will send when the sources do not fit", async () => {
    const { briefRequestCharsUpperBound } = await import("./lib/briefRequest");
    const many = Array.from({ length: 200 }, (_, index) => ({
      _id: `f${index}`,
      kind: "company_file",
      label: `background:${"a-long-company-file-name-".repeat(5)}${index}.md`,
      content: filler(index, 8_000),
      contentHash: `h-f${index}`,
    }));
    const rows = [sources()[0]!, ...many];
    expect(buildBriefUserMessage(rows as never).length).toBeLessThanOrEqual(briefRequestCharsUpperBound(rows as never));
  });
});

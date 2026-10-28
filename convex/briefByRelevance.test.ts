import { describe, expect, it } from "vitest";
import { briefQuoteLocator, type BriefSourceAdapter } from "./ai/brief";
import { BRIEF_EXCERPTS, briefMessageWithReport, buildBriefUserMessage } from "./lib/briefRequest";

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

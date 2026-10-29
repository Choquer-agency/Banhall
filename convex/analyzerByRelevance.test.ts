import { describe, expect, it } from "vitest";
import { buildTrustedContext, CONTEXT_SCAFFOLDS, DEFAULT_CONTEXT_BUDGET, type ContextDoc } from "./ai/trustedContext";

// Phase D, step 1 (owner decision "2026-10-28 (fourth)"): when the
// documents do not all fit, the analysis ranks files of the same trust by
// how well they match the interviews, and a long file sends its best parts.

function filler(seed: number, chars: number): string {
  let text = "";
  for (let i = 0; text.length < chars; i++) text += `The gasket held after ${(seed * 31 + i * 7) % 900} cycles on the bench. `;
  return text.slice(0, chars);
}

const FACT = "The cryogenic soak at minus 60 cracked the Viton membrane on trial 418.";
const doc = (fileName: string, content: string): ContextDoc => ({ category: "other", fileName, content, uploaderRole: "writer" } as ContextDoc);
const transcript = [{ label: "Interview", content: "Client: The Viton membrane cracked during the cryogenic soak." }];

describe("the analysis over its budget (2026-10-28, eighth)", () => {
  it("sends the same message as before when every document fits, in upload order, a matching later file included", () => {
    const documents = [doc("a.md", filler(1, 5_000)), doc("b.md", `${filler(2, 4_000)} ${FACT}`)];
    const { userMessage } = buildTrustedContext({ transcriptParts: transcript, documents });
    expect(userMessage).toContain(filler(1, 5_000));
    expect(userMessage.indexOf("a.md")).toBeLessThan(userMessage.indexOf("b.md"));
    expect(userMessage).not.toContain(CONTEXT_SCAFFOLDS.excerpts.noticePrefix);
  });

  it("sends one long file's best parts on a small project", () => {
    const documents = [doc("long.md", `${filler(5, 80_000)} ${FACT} ${filler(6, 20_000)}`)];
    const { userMessage } = buildTrustedContext({ transcriptParts: transcript, documents });
    expect(userMessage).toContain(FACT);
    expect(userMessage).toContain(CONTEXT_SCAFFOLDS.excerpts.noticePrefix);
  });

  it("keeps scope and category ahead of relevance, and writer's notes' start", () => {
    const company = { ...doc("company-match.md", `${filler(7, 3_000)} ${FACT}`), company: true } as ContextDoc;
    const notes = { ...doc("notes.md", `${filler(8, 50_000)} ${FACT}`), category: "writer_notes" } as ContextDoc;
    const documents = [company, ...Array.from({ length: 12 }, (_, index) => doc(`p-${index}.md`, filler(index + 20, 3_000))), notes];
    const { userMessage, report } = buildTrustedContext({ transcriptParts: transcript, documents, budget: DEFAULT_CONTEXT_BUDGET });
    // Twelve fit: the writer's notes first, then project files; the company file is not reached.
    expect(report.sources.find((source) => source.label === "company-match.md")!.included).toBe(false);
    const notesSource = report.sources.find((source) => source.label === "notes.md")!;
    expect(notesSource.included).toBe(true);
    expect(userMessage).toContain(filler(8, 1_000));
  });

  it("ranks a late file that matches the interviews into the twelve it reads, and sends its matching part", () => {
    const documents = Array.from({ length: 20 }, (_, index) =>
      doc(`file-${index + 1}.md`, index === 17 ? `${filler(99, 50_000)} ${FACT} ${filler(98, 20_000)}` : filler(index + 1, 30_000))
    );
    const { userMessage, report } = buildTrustedContext({ transcriptParts: transcript, documents, budget: DEFAULT_CONTEXT_BUDGET });
    expect(userMessage).toContain(FACT);
    expect(userMessage).toContain(CONTEXT_SCAFFOLDS.excerpts.noticePrefix);
    const file18 = report.sources.find((source) => source.label === "file-18.md")!;
    expect(file18.included).toBe(true);
    expect(file18.truncated).toBe(true);
    expect(report.sources.filter((source) => source.kind === "document" && source.included)).toHaveLength(DEFAULT_CONTEXT_BUDGET.maxDocuments);
  });

  it("sends a file's start, as before, when no part fits the room left", () => {
    const documents = [doc("a.md", filler(1, 8_000)), doc("b.md", filler(2, 8_000))];
    const tight = { ...DEFAULT_CONTEXT_BUDGET, totalTokens: 2_500, transcriptTokens: 100, perDocumentTokens: 2_000 };
    const { userMessage, report } = buildTrustedContext({ transcriptParts: transcript, documents, budget: tight });
    const b = report.sources.find((source) => source.label === "b.md")!;
    expect(b.included).toBe(true);
    expect(b.includedLength).toBeGreaterThan(0);
    expect(userMessage).toContain("[TRUNCATED");
    expect(userMessage).not.toContain(CONTEXT_SCAFFOLDS.excerpts.noticePrefix);
  });
});

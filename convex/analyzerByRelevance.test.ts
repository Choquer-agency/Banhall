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
  it("sends the same message as before when every document fits", () => {
    const documents = [doc("a.md", filler(1, 5_000)), doc("b.md", filler(2, 5_000))];
    const once = buildTrustedContext({ transcriptParts: transcript, documents });
    expect(once.userMessage).toContain(filler(1, 5_000));
    expect(once.userMessage).not.toContain(CONTEXT_SCAFFOLDS.excerpts.noticePrefix);
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
    const { report } = buildTrustedContext({ transcriptParts: transcript, documents, budget: tight });
    expect(report.sources.filter((source) => source.kind === "document" && source.included).length).toBeGreaterThan(0);
  });
});

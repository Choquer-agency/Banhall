/**
 * 2026-10-26 (owner): the browser reads Word as Markdown, exactly as the
 * server does, and says so.
 */
import { describe, expect, it } from "vitest";
import { parseFileToText } from "./parseDocument";
import { RICH_WORD_MARKDOWN, richWordFile } from "../../convex/ai/testFiles.fixture";

describe("a Word file read by the browser's reader (in Node, with a Buffer)", () => {
  it("is Markdown with its headings, bold, italic and tables, flagged as such", async () => {
    const bytes = await richWordFile();
    const parsed = await parseFileToText(new File([bytes as BlobPart], "trials.docx"));
    expect(parsed).toMatchObject({ fileType: "docx", content: RICH_WORD_MARKDOWN, textFormat: "markdown" });
  });
});

/**
 * 2026-10-26 (owner, review): the browser's own mammoth build reads Word as
 * Markdown from an ArrayBuffer, the path real browsers take.
 */
import { expect, it } from "vitest";
import { parseFileToText } from "./parseDocument";
import { RICH_WORD_MARKDOWN, richWordFile } from "../../convex/ai/testFiles.fixture";

it("reads a Word file as Markdown in a real browser", async () => {
  const bytes = await richWordFile();
  const parsed = await parseFileToText(new File([bytes as BlobPart], "trials.docx"));
  expect(parsed).toMatchObject({ fileType: "docx", content: RICH_WORD_MARKDOWN, textFormat: "markdown" });
});

/// <reference types="vite/client" />
/**
 * 2026-10-04 (second, round 2, owner approved 2026-10-05): the frozen source
 * documents the facts check reads in full, within their byte budget.
 */
import { describe, expect, it } from "vitest";
import { decisionFixture } from "./seedDecision.fixture";
import { loadFactsSourceDocuments } from "./lib/generations/seedStage";
import { SOURCE_DOCUMENTS_BUDGET_UTF8_BYTES } from "./lib/seedRevisions";

async function addSource(
  s: Awaited<ReturnType<typeof decisionFixture>>,
  kind: "transcript" | "project_document" | "transcript_digest" | "writer_storyline",
  label: string,
  content: string
) {
  await s.t.run(async (ctx) => {
    await ctx.db.insert("generationSources", {
      generationId: s.generationId,
      projectId: s.projectId,
      kind,
      label,
      content,
      contentHash: `${label}-hash`,
      truncated: false,
      originalLength: content.length,
      capturedAt: 2,
    });
  });
}

describe("the facts check's source documents (round 2)", () => {
  it("reads transcripts and project documents in full, in the order frozen, and nothing else", async () => {
    const s = await decisionFixture();
    await addSource(s, "project_document", "Trial summary", "Deep cove: 13 percent of 180 panels.");
    await addSource(s, "transcript_digest", "Digest", "A digest the check never reads.");
    await addSource(s, "writer_storyline", "Storyline", "A Storyline the check never reads here.");
    const documents = await s.t.run(async (ctx) =>
      await loadFactsSourceDocuments(ctx, (await ctx.db.get(s.generationId))!));
    expect(documents).toEqual({
      included: true,
      documents: [
        { label: "Interview", content: "Evidence alpha supports the work." },
        { label: "Trial summary", content: "Deep cove: 13 percent of 180 panels." },
      ],
    });
  });

  it("includes none over the budget, says how many bytes it read, and stops reading there", async () => {
    expect(SOURCE_DOCUMENTS_BUDGET_UTF8_BYTES).toBe(48_000);
    const s = await decisionFixture();
    const first = "Evidence alpha supports the work.";
    await addSource(s, "transcript", "Long interview", "x".repeat(SOURCE_DOCUMENTS_BUDGET_UTF8_BYTES - first.length));
    // At the budget exactly: still included.
    const atBudget = await s.t.run(async (ctx) =>
      await loadFactsSourceDocuments(ctx, (await ctx.db.get(s.generationId))!));
    expect(atBudget.included).toBe(true);
    await addSource(s, "project_document", "One byte more", "y");
    await addSource(s, "project_document", "Never read", "z".repeat(10));
    const over = await s.t.run(async (ctx) =>
      await loadFactsSourceDocuments(ctx, (await ctx.db.get(s.generationId))!));
    expect(over).toEqual({ included: false, bytes: SOURCE_DOCUMENTS_BUDGET_UTF8_BYTES + 1, budget: SOURCE_DOCUMENTS_BUDGET_UTF8_BYTES });
  });
});

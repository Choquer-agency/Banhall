/// <reference types="vite/client" />

/**
 * Report sections of a generation that reads fact packs (phase 3, plan step
 * 8): the quote pool is the packs' verified client quotes, and every claim
 * cites the frozen transcript row at the fact's own span, never the pack.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { ActionCtx } from "./_generated/server";
import { sha256 } from "./lib/contracts";
import { buildTiptapDocument } from "./lib/tiptapReport";
import { provenanceDrafts, recordCandidateProvenance } from "./ai/pipeline";

const modules = import.meta.glob("./**/*.ts");

const TRANSCRIPT = [
  "Dana Whitfield: So the forecast could not keep up with cloud cover changes?",
  "Priya Shah: The forecast could not keep up with cloud cover changes at the substation.",
  "Priya Shah: The ramp model reached 71 percent accuracy on sunny days in March.",
].join("\n\n");

function span(needle: string, from = 0) {
  const charStart = TRANSCRIPT.indexOf(needle, from);
  return { charStart, charEnd: charStart + needle.length };
}

// The client's sentence, after the interviewer said nearly the same words.
const clientCloud = span(
  "forecast could not keep up with cloud cover changes at the substation",
  TRANSCRIPT.indexOf("Priya Shah")
);
const clientRamp = span("The ramp model reached 71 percent accuracy on sunny days in March.");

async function setup(options: { pack: boolean }) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "fp-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid",
      status: "generating",
      createdBy: userId,
      shareToken: "fp-token",
      createdAt: 1,
      updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content: TRANSCRIPT, createdAt: 1, position: 0 });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      transcriptFacts: true,
      inputMode: "full",
      status: "running",
      startedAt: 1,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const transcriptSourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      transcriptId,
      label: "Helios call",
      content: TRANSCRIPT,
      contentHash: await sha256(TRANSCRIPT),
      truncated: false,
      originalLength: TRANSCRIPT.length,
      capturedAt: 1,
    });
    const packSourceId = options.pack
      ? await ctx.db.insert("generationSources", {
          generationId,
          projectId,
          kind: "transcript_facts",
          transcriptId,
          label: "Helios call",
          content: "Transcript 1: Helios call\n\n[F1-1] (uncertainty) The forecast could not keep up with cloud cover.",
          contentHash: "sha256:pack",
          truncated: false,
          originalLength: 90,
          capturedAt: 1,
          factsVersion: "1",
          factSpans: [
            { id: "F1-1", type: "uncertainty", quotes: [{ ...clientCloud, speakerLabel: "Priya Shah", role: "client" }] },
            { id: "F1-2", type: "result", quotes: [{ ...clientRamp, speakerLabel: "Priya Shah", role: "client" }] },
          ],
        })
      : null;
    return { projectId, generationId, transcriptSourceId, packSourceId };
  });
  return { t, ...ids };
}

const SECTIONS = [
  { section: "242" as const, text: "The forecast could not keep up with cloud cover changes, so the team studied it." },
  { section: "246" as const, text: "The ramp model reached 71 percent accuracy on sunny days." },
];

describe("sections cite verified fact quotes on the transcript row (plan step 8)", () => {
  it("draws the quote pool from the packs and stores citations at the fact spans", async () => {
    const f = await setup({ pack: true });
    const input = await f.t.query(internal.generations.getGenerationInput, { generationId: f.generationId });
    expect(input?.transcriptReading).toBe("facts");
    expect(input?.factQuotes?.map((quote) => [quote.startOffset, quote.endOffset])).toEqual([
      [clientCloud.charStart, clientCloud.charEnd],
      [clientRamp.charStart, clientRamp.charEnd],
    ]);

    // The analyzer's own quote list is ignored in favour of verified quotes.
    const drafts = provenanceDrafts(SECTIONS, input!.transcript, ["an unverified quote from the analyzer"], input!.factQuotes);
    expect(drafts.map((draft) => draft.citation?.startOffset)).toEqual([clientCloud.charStart, clientRamp.charStart]);
    // Not the interviewer's earlier, nearly identical words.
    expect(drafts[0].citation!.startOffset).toBeGreaterThan(TRANSCRIPT.indexOf("Priya Shah"));

    const content = JSON.stringify(buildTiptapDocument("Helios", SECTIONS[0].text, "", SECTIONS[1].text));
    const ctx = { runMutation: f.t.mutation } as unknown as ActionCtx;
    const provenanceId = await recordCandidateProvenance(ctx, {
      projectId: f.projectId,
      generationId: f.generationId,
      input: input!,
      content,
      claimDrafts: drafts,
    });
    const stored = await f.t.run((c) => c.db.get(provenanceId));
    expect(stored?.claims.map((claim) => claim.state)).toEqual(["needs_review", "needs_review"]);
    for (const claim of stored!.claims) {
      expect(claim.sources[0].generationSourceId).toBe(f.transcriptSourceId);
      expect(TRANSCRIPT.slice(claim.sources[0].startOffset, claim.sources[0].endOffset)).toBe(claim.sources[0].exactExcerpt);
    }
  });

  it("keeps today's pool and parts when the generation fell back (no pack)", async () => {
    const f = await setup({ pack: false });
    const input = await f.t.query(internal.generations.getGenerationInput, { generationId: f.generationId });
    expect(input?.transcriptReading).toBe("full");
    expect(input?.factQuotes).toBeUndefined();
    const drafts = provenanceDrafts(
      SECTIONS,
      input!.transcript,
      ["The ramp model reached 71 percent accuracy on sunny days in March."],
      input!.factQuotes
    );
    expect(drafts.map((draft) => draft.sourceQuote)).toEqual([
      undefined,
      "The ramp model reached 71 percent accuracy on sunny days in March.",
    ]);
    expect(drafts.every((draft) => draft.citation === undefined)).toBe(true);
  });
});

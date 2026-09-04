/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MANAGER_AUTH_ID = "reports-provenance-manager";

const CLAIM_TEXT = "The team ran the novel cure step under vacuum.";
const REPORT_CONTENT = JSON.stringify({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: CLAIM_TEXT }] },
  ],
});

/** A project whose generation froze two transcripts and one digest of each. */
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: MANAGER_AUTH_ID,
      role: "manager",
      name: "Provenance Manager",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Provenance project",
      clientName: "Test client",
      status: "review",
      createdBy: userId,
      shareToken: "reports-provenance-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptIds: Id<"transcripts">[] = [];
    const digestIds: Id<"transcriptDigests">[] = [];
    for (const [index, body] of [
      "Alpha body about widgets",
      "Bravo body about the novel cure step",
    ].entries()) {
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        label: index === 0 ? "First" : "Second",
        position: index,
        content: body,
        createdAt: now + index,
      });
      transcriptIds.push(transcriptId);
      digestIds.push(
        await ctx.db.insert("transcriptDigests", {
          transcriptId,
          projectId,
          sourceContentHash: await sha256(body),
          condenseVersion: "1",
          content: `Digest of ${body}`,
          structured: "{}",
          model: "test-model",
          promptVersion: "sha256:test",
          charCount: body.length,
          originalLength: body.length,
          createdAt: now + index,
        })
      );
    }
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId: transcriptIds[0],
      transcriptIds,
      status: "completed",
      requestedBy: userId,
      candidateMode: "single",
      startedAt: now,
      completedAt: now,
    });
    const sourceContent = "Bravo body about the novel cure step";
    const generationSourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      transcriptId: transcriptIds[1],
      label: "Second",
      content: sourceContent,
      contentHash: await sha256(sourceContent),
      truncated: false,
      originalLength: sourceContent.length,
      capturedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      generationId,
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
      content: REPORT_CONTENT,
      contentHash: await sha256(REPORT_CONTENT),
      revisionNumber: 0,
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    return {
      projectId,
      generationId,
      generationSourceId,
      reportId,
      transcriptIds,
      digestIds,
      sourceContent,
    };
  });
  return { t, ...ids };
}

describe("provenance rows record the transcript set (AC2)", () => {
  it("stores the set on createProvenance and copies it to the reviewed successor", async () => {
    const {
      t,
      projectId,
      generationId,
      generationSourceId,
      reportId,
      transcriptIds,
      digestIds,
      sourceContent,
    } = await setup();
    const quote = "the novel cure step";
    const startOffset = sourceContent.indexOf(quote);

    const provenanceId = await t.mutation(internal.reports.createProvenance, {
      projectId,
      generationId,
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
      digestIds,
      content: REPORT_CONTENT,
      claims: [
        {
          claimId: "c1",
          section: "242",
          material: true,
          claimText: CLAIM_TEXT,
          claimTextHash: await sha256(CLAIM_TEXT),
          state: "needs_review",
          sources: [
            {
              generationSourceId,
              sourceContentHash: await sha256(sourceContent),
              exactExcerpt: quote,
              startOffset,
              endOffset: startOffset + quote.length,
            },
          ],
        },
      ],
    });
    await t.run((ctx) => ctx.db.patch(reportId, { provenanceId }));

    const frozen = await t.run((ctx) => ctx.db.get(provenanceId));
    expect(frozen).toMatchObject({
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
      digestIds,
    });

    const nextId = await t
      .withIdentity({ subject: MANAGER_AUTH_ID })
      .mutation(api.reports.reviewClaimCitation, {
        reportId,
        provenanceId,
        claimId: "c1",
        state: "approved",
      });

    const successor = await t.run((ctx) => ctx.db.get(nextId));
    expect(successor).toMatchObject({
      status: "approved",
      generationId,
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
      digestIds,
    });
    // The frozen row it supersedes is untouched.
    await expect(t.run((ctx) => ctx.db.get(provenanceId))).resolves.toMatchObject({
      status: "needs_review",
      sourceTranscriptIds: transcriptIds,
    });
  });

  it("invents neither list on a legacy call that passes only the single id", async () => {
    const { t, projectId, generationId, reportId, transcriptIds } = await setup();

    const provenanceId = await t.mutation(internal.reports.createProvenance, {
      projectId,
      generationId,
      sourceTranscriptId: transcriptIds[0],
      content: REPORT_CONTENT,
      claims: [
        {
          claimId: "c1",
          section: "242",
          material: false,
          claimText: CLAIM_TEXT,
          claimTextHash: await sha256(CLAIM_TEXT),
          state: "unsupported",
          sources: [],
        },
      ],
    });
    await t.run((ctx) => ctx.db.patch(reportId, { provenanceId }));
    const nextId = await t
      .withIdentity({ subject: MANAGER_AUTH_ID })
      .mutation(api.reports.reviewClaimCitation, {
        reportId,
        provenanceId,
        claimId: "c1",
        state: "approved",
      });

    for (const row of [provenanceId, nextId]) {
      const stored = await t.run((ctx) => ctx.db.get(row));
      expect(stored?.sourceTranscriptId).toBe(transcriptIds[0]);
      expect(stored?.sourceTranscriptIds).toBeUndefined();
      expect(stored?.digestIds).toBeUndefined();
    }
  });
});

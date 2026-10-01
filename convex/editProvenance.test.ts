/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import { carryClaims, deleteProvenanceIfUnheld } from "./lib/editProvenance";
import { buildTiptapDocument } from "./lib/tiptapReport";
import schema from "./schema";

// Amendment 2026-09-25 (fifth), audit 2026-09-25 a4 #1: a human edit used to
// clear the report's claim record, so an edited report could never be
// exported. Every edit path now carries the record over: unchanged claims
// keep their state, changed ones need review again, and the manager's review
// plus the filing gate then allow export as for a generated report.

const modules = import.meta.glob("./**/*.ts");
const WRITER = "ep-writer";
const MANAGER = "ep-manager";

const P242 = "The team could not predict how the alloy cracks under cyclic cold loads.";
const P244 = "The team ran forty fatigue tests at minus forty degrees on three alloys.";
const P246 = "The team learned which grain size stops early cracking in cold cycles.";
const SOURCE = "Client: we ran forty fatigue tests at minus forty on three alloys.";
const EXCERPT = "forty fatigue tests at minus forty";

type Claim = Doc<"reportProvenance">["claims"][number];

function doc(s242: string, s244: string, s246: string) {
  return JSON.stringify(buildTiptapDocument("Alloy fatigue PD", s242, s244, s246));
}
const ORIGINAL = doc(P242, P244, P246);

function claim(id: string, section: Claim["section"], text: string, state: Claim["state"]): Claim {
  return {
    claimId: id,
    section,
    material: true,
    claimText: text,
    claimTextHash: `hash-${id}`,
    state,
    sources: [],
  };
}

describe("carryClaims", () => {
  const claims = [
    claim("242-1", "242", P242, "approved"),
    claim("244-1", "244", P244, "approved"),
    claim("246-1", "246", P246, "unsupported"),
  ];
  const carry = (next: string) => carryClaims(ORIGINAL, next, claims, "r1")!.claims;

  it("keeps every claim and its state when no paragraph changed", () => {
    expect(carry(ORIGINAL)).toEqual(claims);
  });

  it("moves a rewritten claim to its new wording and marks it for review", () => {
    const rewritten = "The team ran fifty fatigue tests at minus forty degrees on three alloys.";
    const out = carry(doc(P242, rewritten, P246));
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual(claims[0]);
    expect(out[1]).toMatchObject({
      claimId: "244-1",
      section: "244",
      claimText: rewritten,
      state: "needs_review",
      claimTextHash: undefined,
    });
    expect(out[2]).toEqual(claims[2]);
  });

  it("marks a claim for review when a sentence is added to its paragraph", () => {
    const extended = `${P244} It also proved the coating doubles fatigue life.`;
    const out = carry(doc(P242, extended, P246));
    expect(out[1]).toMatchObject({ claimId: "244-1", claimText: extended, state: "needs_review" });
  });

  it("drops a claim whose paragraph was deleted", () => {
    const out = carry(doc(P242, P244, "[NOT GENERATED]"));
    expect(out).toEqual(claims.slice(0, 2));
  });

  it("adds a new paragraph as a new claim that needs review, and never a heading", () => {
    const added = "The team also tried a nickel coating that failed at minus thirty.";
    const out = carry(doc(P242, `${P244}\n\n${added}`, P246));
    expect(out.slice(0, 3)).toEqual(claims);
    expect(out[3]).toEqual({
      claimId: "r1-244-1",
      section: "244",
      material: true,
      claimText: added,
      state: "needs_review",
      sources: [],
    });
    expect(out).toHaveLength(4);
  });

  // Review r2 P2-1 (2026-09-25): Section boundaries used to come from the
  // text, so a paragraph that starts like a Section heading was taken for
  // one and never became a claim.
  it("a paragraph that starts like a Section heading is still a claim that needs review", () => {
    const added = "Line 246 results show a 40% yield gain over baseline.";
    const out = carry(doc(P242, `${P244}\n\n${added}`, P246));
    expect(out.slice(0, 3)).toEqual(claims);
    expect(out[3]).toMatchObject({ section: "244", claimText: added, state: "needs_review" });
    const lookalike = "Section 242 was harder than the team expected.";
    expect(carry(doc(P242, P244, `${P246}\n\n${lookalike}`))[3]).toMatchObject({
      section: "246",
      claimText: lookalike,
      state: "needs_review",
    });
  });

  it("only a level 2 Section heading node starts a Section", () => {
    const parsed = JSON.parse(ORIGINAL) as { content: Array<Record<string, unknown>> };
    // A lower heading that reads like a Section heading stays inside Line 244.
    const at244 = parsed.content.findIndex(
      (node) => node.type === "heading" && JSON.stringify(node).includes("Line 244")
    );
    parsed.content.splice(at244 + 2, 0, {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Line 246 gains" }],
    });
    const out = carry(JSON.stringify(parsed));
    expect(out.slice(0, 3)).toEqual(claims);
    expect(out[3]).toMatchObject({ section: "244", claimText: "Line 246 gains", state: "needs_review" });
  });
});

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: WRITER, role: "writer", name: "Wren" });
    const managerId = await ctx.db.insert("users", { authId: MANAGER, role: "manager", name: "Max" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      scienceCode: "1.02.01",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "ep-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: SOURCE,
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "completed",
      requestedBy: writerId,
      candidateMode: "single",
      startedAt: now,
      completedAt: now,
    });
    const generationSourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      transcriptId,
      label: "Interview",
      content: SOURCE,
      contentHash: await sha256(SOURCE),
      truncated: false,
      originalLength: SOURCE.length,
      capturedAt: now,
    });
    const start = SOURCE.indexOf(EXCERPT);
    const source = {
      generationSourceId,
      sourceContentHash: await sha256(SOURCE),
      exactExcerpt: EXCERPT,
      startOffset: start,
      endOffset: start + EXCERPT.length,
    };
    const claims = await Promise.all(
      ([["242", P242], ["244", P244], ["246", P246]] as const).map(async ([section, text]) => ({
        claimId: `${section}-1`,
        section,
        material: true,
        claimText: text,
        claimTextHash: await sha256(text),
        state: "approved" as const,
        sources: [source],
      }))
    );
    const provenanceId = await ctx.db.insert("reportProvenance", {
      projectId,
      generationId,
      sourceTranscriptId: transcriptId,
      sourceTranscriptIds: [transcriptId],
      contentHash: await sha256(ORIGINAL),
      status: "approved",
      claims,
      createdAt: now,
      reviewedAt: now,
      reviewedBy: managerId,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      generationId,
      provenanceId,
      content: ORIGINAL,
      contentHash: await sha256(ORIGINAL),
      revisionNumber: 0,
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("projectIdentityEvidence", {
      projectId,
      subjectName: "Acme Metals Inc.",
      relationship: "claimant",
      evidenceKind: "corporate_registry",
      sourceDescription: "Registry extract",
      status: "verified",
      verifiedBy: managerId,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { writerId, managerId, projectId, reportId, provenanceId, source };
  });
  return {
    t,
    writer: t.withIdentity({ subject: WRITER }),
    manager: t.withIdentity({ subject: MANAGER }),
    ...ids,
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function reportAndProvenance(f: Fixture) {
  return await f.t.run(async (ctx) => {
    const report = (await ctx.db.get(f.reportId))!;
    const provenance = report.provenanceId ? await ctx.db.get(report.provenanceId) : null;
    return { report, provenance };
  });
}

/** Attest the current revision and export it, as the export dialog does. */
async function attestAndExport(f: Fixture) {
  const { report } = await reportAndProvenance(f);
  await f.manager.mutation(api.projectEvidence.setFilingAttestation, {
    projectId: f.projectId,
    reportId: f.reportId,
    status: "approved",
  });
  return await f.writer.mutation(api.reports.authorizeExport, {
    reportId: f.reportId,
    expectedRevisionNumber: report.revisionNumber ?? 0,
    expectedContentHash: await sha256(report.content),
  });
}

async function blockers(f: Fixture) {
  const readiness = await f.manager.query(api.projectEvidence.getReadiness, {
    projectId: f.projectId,
    reportId: f.reportId,
  });
  return readiness.blockers.map((row) => row.code);
}

const REWRITTEN_244 = "The team ran fifty fatigue tests at minus forty degrees on three alloys.";

describe("an edited report can be exported once its claims are reviewed", () => {
  it("exports the generated report as the baseline", async () => {
    const f = await setup();
    await expect(attestAndExport(f)).resolves.toMatchObject({ revisionNumber: 0 });
  });

  it("writer edit: the changed claim needs review, the rest keep theirs, then export succeeds", async () => {
    const f = await setup();
    await f.writer.mutation(api.reports.updateReportContent, {
      reportId: f.reportId,
      content: doc(P242, REWRITTEN_244, P246),
      expectedRevisionNumber: 0,
    });
    const { report, provenance } = await reportAndProvenance(f);
    expect(report.provenanceId).toBeDefined();
    expect(report.provenanceId).not.toBe(f.provenanceId);
    expect(provenance).toMatchObject({
      status: "needs_review",
      contentHash: await sha256(report.content),
      generationId: expect.anything(),
    });
    const byId = new Map(provenance!.claims.map((row) => [row.claimId, row]));
    expect(byId.get("242-1")).toMatchObject({ state: "approved", claimText: P242 });
    expect(byId.get("246-1")).toMatchObject({ state: "approved", claimText: P246 });
    expect(byId.get("244-1")).toMatchObject({
      state: "needs_review",
      claimText: REWRITTEN_244,
      claimTextHash: await sha256(REWRITTEN_244),
      sources: [f.source],
    });
    expect(await blockers(f)).toContain("PROVENANCE_REVIEW_REQUIRED");
    expect(await blockers(f)).not.toContain("PROVENANCE_UNAVAILABLE");

    // The existing manager review applies to the new revision's record.
    await f.manager.mutation(api.reports.reviewClaimCitation, {
      reportId: f.reportId,
      provenanceId: report.provenanceId!,
      claimId: "244-1",
      state: "approved",
    });
    await expect(attestAndExport(f)).resolves.toMatchObject({ revisionNumber: 1 });
  });

  it("an edit outside every claim keeps the approved record, and export needs only a new attestation", async () => {
    const f = await setup();
    const retitled = ORIGINAL.replace("Alloy fatigue PD", "Alloy fatigue project");
    await f.writer.mutation(api.reports.updateReportContent, {
      reportId: f.reportId,
      content: retitled,
      expectedRevisionNumber: 0,
    });
    const { provenance } = await reportAndProvenance(f);
    expect(provenance?.status).toBe("approved");
    expect(provenance?.claims.every((row) => row.state === "approved")).toBe(true);
    await expect(attestAndExport(f)).resolves.toMatchObject({ revisionNumber: 1 });
  });

  it("a paragraph starting like a Section heading takes an approved record back to review", async () => {
    const f = await setup();
    const added = "Line 246 results show a 40% yield gain over baseline.";
    await f.writer.mutation(api.reports.updateReportContent, {
      reportId: f.reportId,
      content: doc(P242, `${P244}\n\n${added}`, P246),
      expectedRevisionNumber: 0,
    });
    const { provenance } = await reportAndProvenance(f);
    expect(provenance?.status).toBe("needs_review");
    expect(provenance?.claims.find((row) => row.claimText === added)?.state).toBe("needs_review");
    await expect(attestAndExport(f)).rejects.toThrow(/needs human source review/);
  });

  it("an edit never approves a claim a manager has not approved", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      const provenance = (await ctx.db.get(f.provenanceId))!;
      await ctx.db.patch(f.provenanceId, {
        status: "needs_review",
        claims: provenance.claims.map((row) =>
          row.claimId === "246-1" ? { ...row, state: "needs_review" as const } : row
        ),
      });
    });
    await f.writer.mutation(api.reports.updateReportContent, {
      reportId: f.reportId,
      content: ORIGINAL.replace("Alloy fatigue PD", "Alloy fatigue project"),
      expectedRevisionNumber: 0,
    });
    const { provenance } = await reportAndProvenance(f);
    expect(provenance?.status).toBe("needs_review");
    expect(provenance?.claims.find((row) => row.claimId === "246-1")?.state).toBe("needs_review");
    await expect(attestAndExport(f)).rejects.toThrow(/needs human source review/);
  });

  it("accepting a client's suggested edit carries the record over", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("comments", {
        projectId: f.projectId,
        reportId: f.reportId,
        commenterId: "client",
        commenterType: "client",
        highlightFrom: 0,
        highlightTo: 0,
        highlightText: "forty fatigue tests",
        body: "It was fifty.",
        suggestedEdit: "fifty fatigue tests",
        resolved: false,
        createdAt: Date.now(),
      });
    });
    const comment = await f.t.run(async (ctx) => (await ctx.db.query("comments").first())!);
    await f.writer.mutation(api.comments.acceptEdit, { commentId: comment._id });
    const { provenance } = await reportAndProvenance(f);
    expect(provenance?.claims.find((row) => row.claimId === "244-1")).toMatchObject({
      state: "needs_review",
      claimText: REWRITTEN_244,
    });
    expect(provenance?.claims.find((row) => row.claimId === "242-1")?.state).toBe("approved");
    await f.manager.mutation(api.reports.reviewClaimCitation, {
      reportId: f.reportId,
      provenanceId: provenance!._id,
      claimId: "244-1",
      state: "approved",
    });
    await expect(attestAndExport(f)).resolves.toMatchObject({ revisionNumber: 1 });
  });

  async function chatProposal(f: Fixture) {
    return await f.t.run(async (ctx) => {
      await ctx.db.insert("agentChatThreads", {
        agentThreadId: "ep-thread",
        projectId: f.projectId,
        reportId: f.reportId,
        title: "Chat",
        createdAt: 1,
      });
      return await ctx.db.insert("chatProposals", {
        agentThreadId: "ep-thread",
        projectId: f.projectId,
        reportId: f.reportId,
        kind: "edit",
        targetText: "forty fatigue tests",
        newText: "fifty fatigue tests",
        state: "pending",
        createdAt: 2,
      });
    });
  }

  it("applying a chat proposal carries the record over", async () => {
    const f = await setup();
    const proposalId = await chatProposal(f);
    await f.writer.mutation(api.chatV2.applyProposal, { proposalId });
    const { provenance } = await reportAndProvenance(f);
    expect(provenance?.claims.find((row) => row.claimId === "244-1")).toMatchObject({
      state: "needs_review",
      claimText: REWRITTEN_244,
    });
    expect(provenance?.claims.find((row) => row.claimId === "246-1")?.state).toBe("approved");
  });

  it("stepping through a chat proposal (markProposalApplied) carries the record over", async () => {
    const f = await setup();
    const proposalId = await chatProposal(f);
    await f.writer.mutation(api.chatV2.markProposalApplied, {
      proposalId,
      content: doc(P242, REWRITTEN_244, P246),
      expectedRevisionNumber: 0,
    });
    const { provenance } = await reportAndProvenance(f);
    expect(provenance?.claims.find((row) => row.claimId === "244-1")?.state).toBe("needs_review");
    expect(provenance?.claims.find((row) => row.claimId === "242-1")?.state).toBe("approved");
  });

  it("a report with no claim record stays unavailable after an edit, as before", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.patch(f.reportId, { provenanceId: undefined }));
    await f.writer.mutation(api.reports.updateReportContent, {
      reportId: f.reportId,
      content: doc(P242, REWRITTEN_244, P246),
      expectedRevisionNumber: 0,
    });
    const { report } = await reportAndProvenance(f);
    expect(report.provenanceId).toBeUndefined();
    expect(await blockers(f)).toContain("PROVENANCE_UNAVAILABLE");
  });
});

// Review r2 P2-2 (2026-09-25): every autosave inserted a new claim record and
// nothing deleted the old ones.
describe("claim records do not pile up on autosave", () => {
  async function provenanceRows(f: Fixture) {
    return await f.t.run((ctx) =>
      ctx.db
        .query("reportProvenance")
        .withIndex("by_projectId", (q) => q.eq("projectId", f.projectId))
        .collect()
    );
  }
  const retitle = (title: string) => ORIGINAL.replace("Alloy fatigue PD", title);

  it("saves that leave every claim as it was reuse one record", async () => {
    const f = await setup();
    for (const [revision, title] of ["Draft one", "Draft two", "Draft three"].entries()) {
      await f.writer.mutation(api.reports.updateReportContent, {
        reportId: f.reportId,
        content: retitle(title),
        expectedRevisionNumber: revision,
      });
    }
    const { report, provenance } = await reportAndProvenance(f);
    expect(report.provenanceId).toBe(f.provenanceId);
    expect(provenance).toMatchObject({
      status: "approved",
      contentHash: await sha256(retitle("Draft three")),
    });
    expect(await provenanceRows(f)).toHaveLength(1);
    await expect(attestAndExport(f)).resolves.toMatchObject({ revisionNumber: 3 });
  });

  it("a save that changes a claim replaces the record and deletes the old one", async () => {
    const f = await setup();
    await f.writer.mutation(api.reports.updateReportContent, {
      reportId: f.reportId,
      content: doc(P242, REWRITTEN_244, P246),
      expectedRevisionNumber: 0,
    });
    const rows = await provenanceRows(f);
    expect(rows).toHaveLength(1);
    const { report } = await reportAndProvenance(f);
    expect(rows[0]._id).toBe(report.provenanceId);
    expect(rows[0]._id).not.toBe(f.provenanceId);
  });

  it("never changes or deletes a record a snapshot or export holds", async () => {
    const f = await setup();
    await attestAndExport(f);
    const snapshotId = await f.t.run((ctx) =>
      ctx.db.insert("reportSnapshots", {
        projectId: f.projectId,
        reportId: f.reportId,
        content: ORIGINAL,
        reason: "manual",
        createdByRole: "writer",
        createdAt: Date.now(),
        provenanceId: f.provenanceId,
        contentHash: "held",
      })
    );
    await f.writer.mutation(api.reports.updateReportContent, {
      reportId: f.reportId,
      content: retitle("Held"),
      expectedRevisionNumber: 0,
    });
    const { report } = await reportAndProvenance(f);
    expect(report.provenanceId).not.toBe(f.provenanceId);
    const kept = await f.t.run((ctx) => ctx.db.get(f.provenanceId));
    expect(kept?.contentHash).toBe(await sha256(ORIGINAL));
    expect(await provenanceRows(f)).toHaveLength(2);

    // Once the snapshot is gone the export still holds it.
    await f.t.run(async (ctx) => {
      await ctx.db.delete(snapshotId);
      await deleteProvenanceIfUnheld(ctx, f.provenanceId);
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.provenanceId))).not.toBeNull();
  });

  it("a record only a pruned snapshot held is deleted with it", async () => {
    const f = await setup();
    const { snapshotId, orphanId } = await f.t.run(async (ctx) => {
      const orphanId = await ctx.db.insert("reportProvenance", {
        projectId: f.projectId,
        contentHash: "old",
        status: "needs_review",
        claims: [],
        createdAt: 1,
      });
      const snapshotId = await ctx.db.insert("reportSnapshots", {
        projectId: f.projectId,
        reportId: f.reportId,
        content: ORIGINAL,
        reason: "manual",
        createdByRole: "writer",
        createdAt: 1,
        provenanceId: orphanId,
      });
      return { snapshotId, orphanId };
    });
    await f.t.run((ctx) => deleteProvenanceIfUnheld(ctx, orphanId));
    expect(await f.t.run((ctx) => ctx.db.get(orphanId))).not.toBeNull();
    await f.t.run(async (ctx) => {
      await ctx.db.delete(snapshotId);
      await deleteProvenanceIfUnheld(ctx, orphanId);
    });
    expect(await f.t.run((ctx) => ctx.db.get(orphanId))).toBeNull();
    // The report's own record is never taken.
    await f.t.run((ctx) => deleteProvenanceIfUnheld(ctx, f.provenanceId));
    expect(await f.t.run((ctx) => ctx.db.get(f.provenanceId))).not.toBeNull();
  });
});

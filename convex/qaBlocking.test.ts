/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sha256 } from "./lib/contracts";
import { buildTiptapDocument } from "./lib/tiptapReport";

const modules = import.meta.glob("./**/*.ts");
const FAILURE = "It was uncertain whether the alloy would resist fatigue.";
const FIXED = "It was uncertain whether the alloy would resist fatigue because the cyclic response was unknown.";
const contentFor = (text: string) => JSON.stringify(buildTiptapDocument("Alloy", text, "The team tested the alloy.", "The team learned the response."));
const scorecard = (compliance: Record<string, boolean>) => JSON.stringify({
  overall_score: 90,
  section_scores: {},
  cra_compliance: compliance,
});

async function setup(content = contentFor(FIXED)) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { authId: "qa-owner", role: "writer" });
    await ctx.db.insert("users", { authId: "qa-manager", role: "manager" });
    await ctx.db.insert("users", { authId: "qa-admin", role: "admin" });
    await ctx.db.insert("users", { authId: "qa-other", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy", clientName: "Client", createdBy: ownerId, ownerId,
      status: "review", shareToken: "qa-token", createdAt: 1, updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content: "Interview", createdAt: 1 });
    const generationId = await ctx.db.insert("generations", {
      projectId, transcriptId, requestedBy: ownerId, status: "completed", candidateMode: "single", startedAt: 1,
      agentOutputs: JSON.stringify({ analyzer: { subject: "Alloy" }, section242: "Frozen old text", section244: "Old work", section246: "Old advancement" }),
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, generationId, content, revisionNumber: 0, contentHash: await sha256(content),
      version: 1, generatedAt: 1, updatedAt: 1,
    });
    return { ownerId, projectId, generationId, reportId };
  });
  return { t, actor: t.withIdentity({ subject: "qa-owner" }), ...ids };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
async function rows(f: Fixture) {
  return f.t.run(async (ctx) => (await ctx.db.query("qaFindings").collect()).filter((r) => r.reportId === f.reportId));
}
async function ref(f: Fixture) {
  return f.t.run(async (ctx) => {
    const report = await ctx.db.get(f.reportId);
    if (!report) throw new Error("fixture report missing");
    return { reportId: report._id, revisionNumber: report.revisionNumber ?? 0, contentHash: await sha256(report.content) };
  });
}
async function readiness(f: Fixture) {
  const result = await f.actor.query(api.projects.getProjectReadiness, { projectId: f.projectId, reportId: f.reportId });
  if (!result) throw new Error("fixture readiness missing");
  return result;
}
async function expectBlocked(f: Fixture, subject = "qa-owner") {
  expect((await readiness(f)).blockers.map((b) => b.code)).toContain("QA_BLOCKING");
  const before = await f.t.run((ctx) => ctx.db.get(f.projectId));
  await expect(f.t.withIdentity({ subject }).mutation(api.projects.publishForReview, {
    projectId: f.projectId, reportId: f.reportId,
  })).rejects.toMatchObject({ data: { code: "QA_BLOCKING" } });
  expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toEqual(before);
}
async function saveQa(f: Fixture, compliance: Record<string, boolean>) {
  await f.t.mutation(internal.generations.saveReportQa, { generationId: f.generationId, capturedRef: await ref(f), qa: scorecard(compliance) });
}

describe("CAP-8 absolute current-revision QA gate", () => {
  test("human content save persists because findings and rejects publish atomically", async () => {
    const f = await setup();
    await f.actor.mutation(api.reports.updateReportContent, { reportId: f.reportId, content: contentFor(FAILURE), expectedRevisionNumber: 0 });
    expect(await rows(f)).toEqual(expect.arrayContaining([expect.objectContaining({
      check: "because_clause", blocking: true, revisionNumber: 1, contentHash: await sha256(contentFor(FAILURE)),
    })]));
    await expectBlocked(f);
  });

  test.each(["why_how_why_intact", "uncertainties_distinguished"])("explicit %s failure persists and blocks both boundaries", async (key) => {
    const f = await setup();
    await saveQa(f, { [key]: false });
    expect(await rows(f)).toEqual(expect.arrayContaining([expect.objectContaining({ check: "cra_methodology", blocking: true, ...(await ref(f)) })]));
    await expectBlocked(f);
  });

  test("house-style findings and false verbiage do not block client review", async () => {
    const f = await setup();
    await f.actor.mutation(api.reports.updateReportContent, { reportId: f.reportId, content: contentFor("The robust solution was tested."), expectedRevisionNumber: 0 });
    await saveQa(f, { verbiage_present: false, why_how_why_intact: true, uncertainties_distinguished: true });
    expect((await rows(f)).some((r) => r.check === "banned_word" && !r.blocking)).toBe(true);
    expect((await readiness(f)).blockers.map((b) => b.code)).not.toContain("QA_BLOCKING");
    // Other filing prerequisites remain absent, but do not prevent client review.
    expect((await readiness(f)).ready).toBe(false);
    await f.actor.mutation(api.projects.publishForReview, { projectId: f.projectId, reportId: f.reportId });
    expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toMatchObject({ sharedReportId: f.reportId, status: "client_review" });
  });

  test.each(["qa-manager", "qa-admin"])("%s cannot waive findings by reclassifying QA feedback", async (subject) => {
    const f = await setup();
    await saveQa(f, { why_how_why_intact: false });
    await f.t.withIdentity({ subject }).mutation(api.reviews.saveQaItemFeedback, {
      target: { reportId: f.reportId }, itemKey: "methodology", itemKind: "issue", section: "242",
      itemText: "Methodology failure", originalSeverity: "deduction", overrideSeverity: "warning", vote: -1,
    });
    await expectBlocked(f, subject);
  });

  test("human correction preserves history without carrying old failure to new content", async () => {
    const f = await setup(contentFor(FAILURE));
    await saveQa(f, { why_how_why_intact: false });
    const oldRows = await rows(f);
    expect(oldRows.some((r) => r.check === "because_clause")).toBe(true);
    await expectBlocked(f);
    await f.actor.mutation(api.reports.updateReportContent, { reportId: f.reportId, content: contentFor(FIXED), expectedRevisionNumber: 0 });
    expect(await rows(f)).toEqual(expect.arrayContaining(oldRows));
    expect((await readiness(f)).blockers.map((b) => b.code)).not.toContain("QA_BLOCKING");
    await f.actor.mutation(api.projects.publishForReview, { projectId: f.projectId, reportId: f.reportId });
  });

  test("QA input uses current content and late completion cannot relabel the old revision", async () => {
    const f = await setup();
    const input = await f.t.query(internal.generations.getPostQaInput, { generationId: f.generationId });
    expect(input?.section242).toContain(FIXED);
    expect(input?.section242).not.toContain("Frozen old text");
    expect(input?.capturedRef).toEqual(await ref(f));
    if (!input) throw new Error("QA input missing");
    await f.actor.mutation(api.reports.updateReportContent, { reportId: f.reportId, content: contentFor("The corrected investigation is documented."), expectedRevisionNumber: 0 });
    await f.t.mutation(internal.generations.saveReportQa, { generationId: f.generationId, capturedRef: input.capturedRef, qa: scorecard({ why_how_why_intact: false }) });
    expect((await rows(f)).filter((r) => r.check === "cra_methodology" && r.revisionNumber === 1)).toEqual([]);
    expect((await readiness(f)).blockers.map((b) => b.code)).not.toContain("QA_BLOCKING");
  });

  test("legacy rows without QA, revision or hash still get the deterministic gate", async () => {
    const f = await setup(FAILURE);
    await f.t.run((ctx) => ctx.db.patch(f.reportId, { revisionNumber: undefined, contentHash: undefined }));
    expect(await rows(f)).toEqual([]);
    await expectBlocked(f);
  });

  test("foreign report identity and stale content hash cannot affect current readiness", async () => {
    const f = await setup();
    await saveQa(f, { uncertainties_distinguished: false });
    const otherReportId = await f.t.run(async (ctx) => {
      return ctx.db.insert("reports", { projectId: f.projectId, content: contentFor(FIXED), revisionNumber: 0, version: 2, generatedAt: 2, updatedAt: 2 });
    });
    const other = await f.actor.query(api.projects.getProjectReadiness, { projectId: f.projectId, reportId: otherReportId });
    expect(other?.blockers.map((b) => b.code)).not.toContain("QA_BLOCKING");
    // Deliberately corrupt the stored hash/revision to prove actual bytes fence old findings.
    await f.t.run((ctx) => ctx.db.patch(f.reportId, { content: contentFor("Different content at the same number.") }));
    expect((await readiness(f)).blockers.map((b) => b.code)).not.toContain("QA_BLOCKING");
  });

  test("same-revision QA retries are deduplicated and a passing score is not a waiver", async () => {
    const f = await setup();
    await saveQa(f, { why_how_why_intact: false });
    const first = await rows(f);
    await saveQa(f, { why_how_why_intact: false });
    expect(await rows(f)).toEqual(first);
    await saveQa(f, { why_how_why_intact: true });
    expect(await rows(f)).toEqual(first);
    await expectBlocked(f);
  });

  test("frozen style waivers remove advisory rows but never the because blocker", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.patch(f.generationId, {
      agentOutputs: JSON.stringify({ styleOverrides: {
        bannedWords: true, openingClauses: true, repetitionCaps: true, reportSkeleton: true,
      } }),
    }));
    await f.actor.mutation(api.reports.updateReportContent, {
      reportId: f.reportId, content: contentFor("The robust solution. " + FAILURE), expectedRevisionNumber: 0,
    });
    const findings = await rows(f);
    expect(findings.some((r) => r.check === "banned_word")).toBe(false);
    expect(findings.some((r) => r.check === "because_clause" && r.blocking)).toBe(true);
    await expectBlocked(f, "qa-manager");
  });

  test("legacy unpinned QA cannot create current methodology findings", async () => {
    const f = await setup();
    await f.t.mutation(internal.generations.saveReportQa, { generationId: f.generationId, qa: scorecard({ why_how_why_intact: false }) });
    expect((await rows(f)).filter((r) => r.check === "cra_methodology")).toEqual([]);
  });

  test("publish authorization still precedes QA validation", async () => {
    const f = await setup(contentFor(FAILURE));
    await expect(f.t.withIdentity({ subject: "qa-other" }).mutation(api.projects.publishForReview, { projectId: f.projectId, reportId: f.reportId })).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
  });

  test("single-candidate completion persists both deterministic and methodology failures", async () => {
    const f = await setup();
    const runId = await f.t.run(async (ctx) => {
      await ctx.db.delete(f.reportId);
      await ctx.db.patch(f.generationId, { status: "running", totalCandidates: 1 });
      await ctx.db.patch(f.projectId, { activeGenerationId: f.generationId });
      return ctx.db.insert("generationCandidateRuns", { projectId: f.projectId, generationId: f.generationId, model: "test-model", label: "A", status: "running", queuedAt: 1 });
    });
    await f.t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runId, content: contentFor(FAILURE),
      agentOutputs: JSON.stringify({ qa: JSON.parse(scorecard({ uncertainties_distinguished: false })) }), qaScore: 90,
    });
    const report = await f.actor.query(api.reports.getLatestReport, { projectId: f.projectId });
    if (!report) throw new Error("candidate produced no canonical report");
    const generated = { ...f, reportId: report._id };
    expect((await rows(generated)).filter((r) => r.blocking).map((r) => r.check)).toEqual(expect.arrayContaining(["because_clause", "cra_methodology"]));
    await expectBlocked(generated);
  });
});

describe("CAP-8 review regressions", () => {
  test("body prose resembling a section heading cannot hide a failure", async () => {
    const f = await setup(contentFor("Line 244 — " + FAILURE));
    await expectBlocked(f);
  });
  test("no-op save carries exact-content methodology to the new revision", async () => {
    const f = await setup();
    await saveQa(f, { why_how_why_intact: false });
    await f.actor.mutation(api.reports.updateReportContent, { reportId: f.reportId, content: contentFor(FIXED), expectedRevisionNumber: 0 });
    expect(await rows(f)).toEqual(expect.arrayContaining([expect.objectContaining({ ...(await ref(f)), check: "cra_methodology", blocking: true })]));
    await expectBlocked(f);
  });
  test("restoring byte-identical historical content carries its methodology failure", async () => {
    const f = await setup();
    await saveQa(f, { uncertainties_distinguished: false });
    const snapshotId = await f.t.run(ctx => ctx.db.insert("reportSnapshots", {
      projectId: f.projectId, reportId: f.reportId, content: contentFor(FIXED), reason: "manual", createdByRole: "writer", createdAt: 1,
    }));
    await f.actor.mutation(api.reports.updateReportContent, { reportId: f.reportId, content: contentFor("Different content"), expectedRevisionNumber: 0 });
    await f.actor.mutation(api.snapshots.restoreSnapshot, { snapshotId, targetReportId: f.reportId, expectedRevisionNumber: 1 });
    expect(await rows(f)).toEqual(expect.arrayContaining([expect.objectContaining({ ...(await ref(f)), check: "cra_methodology", blocking: true })]));
    await expectBlocked(f);
  });
  test("identical advisory messages in different sections retain distinct retry identities", async () => {
    const f = await setup(JSON.stringify(buildTiptapDocument("Title", "The robust solution.", "The robust solution.", "The robust solution.")));
    await saveQa(f, {});
    const findings = (await rows(f)).filter(row => row.check === "banned_word");
    expect(findings.map(row => row.section).sort()).toEqual(["s242", "s244", "s246"]);
    await saveQa(f, {});
    expect((await rows(f)).filter(row => row.check === "banned_word")).toEqual(findings);
  });
  test.each(["single", "iterative"] as const)("empty current %s report has no QA input", async candidateMode => {
    const f = await setup(JSON.stringify({ type: "doc", content: [] }));
    await f.t.run(ctx => ctx.db.patch(f.generationId, { candidateMode }));
    expect(await f.t.query(internal.generations.getPostQaInput, { generationId: f.generationId })).toBeNull();
  });
  test.each(["applyProposal", "markProposalApplied", "acceptEdit", "restoreSnapshot"] as const)("%s persists findings on the exact resulting revision", async path => {
    const f = await setup();
    if (path === "applyProposal" || path === "markProposalApplied") {
      const proposalId = await f.t.run(ctx => ctx.db.insert("chatProposals", {
        agentThreadId: "qa-thread", projectId: f.projectId, reportId: f.reportId, kind: "edit",
        targetText: FIXED, newText: FAILURE, state: "pending", createdAt: 1,
      }));
      if (path === "applyProposal") await f.actor.mutation(api.chatV2.applyProposal, { proposalId });
      else await f.actor.mutation(api.chatV2.markProposalApplied, { proposalId, content: contentFor(FAILURE), expectedRevisionNumber: 0 });
    } else if (path === "acceptEdit") {
      const commentId = await f.t.run(async ctx => {
        const commenterId = await ctx.db.insert("commenters", { projectId: f.projectId, name: "Client", color: "blue", createdAt: 1 });
        return ctx.db.insert("comments", { projectId: f.projectId, reportId: f.reportId, commenterId, commenterType: "client", highlightFrom: 0, highlightTo: FIXED.length, highlightText: FIXED, body: "Suggested correction", suggestedEdit: FAILURE, resolved: false, createdAt: 1 });
      });
      await f.actor.mutation(api.comments.acceptEdit, { commentId });
    } else {
      const snapshotId = await f.t.run(ctx => ctx.db.insert("reportSnapshots", { projectId: f.projectId, reportId: f.reportId, content: contentFor(FAILURE), reason: "manual", createdByRole: "writer", createdAt: 1 }));
      await f.actor.mutation(api.snapshots.restoreSnapshot, { snapshotId, targetReportId: f.reportId, expectedRevisionNumber: 0 });
    }
    expect(await rows(f)).toEqual(expect.arrayContaining([expect.objectContaining({ ...(await ref(f)), section: "s242", check: "because_clause", blocking: true })]));
    expect((await ref(f)).revisionNumber).toBe(1);
  });
  test("project copy persists deterministic findings for the destination report", async () => {
    const f = await setup(contentFor(FAILURE));
    const toProjectId = await f.t.run(ctx => ctx.db.insert("projects", { title: "Copy", clientName: "Client", createdBy: f.ownerId, ownerId: f.ownerId, status: "draft", shareToken: "copy", createdAt: 1, updatedAt: 1 }));
    const copy = await f.actor.mutation(api.projects.prepareProjectContentCopy, { fromProjectId: f.projectId, toProjectId });
    if (!copy.reportId) throw new Error("No copied report");
    const copied = { ...f, reportId: copy.reportId, projectId: toProjectId };
    expect(await rows(copied)).toEqual(expect.arrayContaining([expect.objectContaining({ ...(await ref(copied)), check: "because_clause", blocking: true })]));
  });
});


describe("CAP-8 extraction bypass regressions", () => {
  test.each(["punctuated", "renamed", "removed", "nested"])("%s uncertainty headings retain blocking prose", async variant => {
    const doc = buildTiptapDocument("Title", FAILURE, "Work.", "Knowledge.");
    if (variant === "punctuated") doc.content[1] = { type: "heading", content: [{ type: "text", text: "Line 242 — Technological Uncertainty." }] };
    if (variant === "renamed") doc.content[1] = { type: "heading", content: [{ type: "text", text: "Uncertainties" }] };
    if (variant === "removed") doc.content.splice(1, 1);
    const content = variant === "nested"
      ? JSON.stringify({ type: "doc", content: [{ type: "blockquote", content: doc.content }] })
      : JSON.stringify(doc);
    const f = await setup(content);
    await expectBlocked(f);
    await f.actor.mutation(api.reports.updateReportContent, { reportId: f.reportId, content, expectedRevisionNumber: 0 });
    expect((await rows(f)).some(row => row.check === "because_clause" && row.blocking)).toBe(true);
  });

  test("legacy whitespace-only blank lines separate unrelated explanations", async () => {
    const f = await setup("Line 242: Uncertainty\nIt was uncertain whether the alloy holds\n \t \nWe ran tests because evidence was needed.\nLine 244: Work\nTests.");
    await expectBlocked(f);
  });
});


test("legacy heading-like body sentences cannot hide uncertainty", async () => {
  const f = await setup("Line 242: Uncertainty\nLine 244 — It was uncertain whether the alloy holds.\nLine 244: Work\nTests.");
  await expectBlocked(f);
});

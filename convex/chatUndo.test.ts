/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { APPLIED_CHANGE_MAX_CHARS } from "./lib/appliedChange";
import { PROPOSAL_UNDO_CONFLICT_MESSAGE, PROPOSAL_UNDO_TOO_LONG_MESSAGE } from "./chatV2";

const modules = import.meta.glob("./**/*.ts");

/**
 * Chat parity Phase B (W3): Undo for an applied chat card. The only new card
 * transition is `applied -> pending`, by a person with report edit access,
 * and it puts back exactly what the apply replaced. Every name and passage
 * here is fictional.
 */

type Block = Record<string, unknown>;
const text = (value: string, marks?: Array<Record<string, unknown>>) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: Block[]) => ({ type: "paragraph", content });
const heading = (value: string) => ({ type: "heading", attrs: { level: 2 }, content: [text(value)] });

/** A report whose target sentence spans a bold run and a highlight. */
const ORIGINAL = {
  type: "doc",
  content: [
    heading("Line 242"),
    paragraph(
      text("The team "),
      text("tested", [{ type: "bold" }]),
      text(" the coupon at "),
      text("[GAP: load]", [{ type: "highlight", attrs: { color: "#fde68a" } }]),
      text(" cycles.")
    ),
    paragraph(text("The coating was sprayed twice.")),
    heading("Line 244"),
    paragraph(text("The rig ran overnight.")),
  ],
};

type Kind = "edit" | "replacements" | "bulk";

async function setup(doc: unknown = ORIGINAL) {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const content = JSON.stringify(doc);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { authId: "undo-owner", role: "writer", firstName: "Owen" });
    await ctx.db.insert("users", { authId: "undo-other-writer", role: "writer", firstName: "Wanda" });
    await ctx.db.insert("users", { authId: "undo-roleless", firstName: "Rory" });
    await ctx.db.insert("users", { authId: "undo-manager", role: "manager", firstName: "Mara" });
    const projectId = await ctx.db.insert("projects", {
      title: "Coupon fatigue PD",
      clientName: "Quillfeather Metals",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "undo-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content,
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 0,
    });
    await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId: "undo-thread", title: "Chat", createdAt: now });
    // listProposals finds a card through its turn.
    await ctx.db.insert("chatTurns", {
      userId: ownerId, agentThreadId: "undo-thread", promptMessageId: "undo-prompt",
      order: 0, status: "completed", stepCount: 1,
    });
    return { ownerId, projectId, reportId };
  });
  const owner = t.withIdentity({ subject: "undo-owner" });
  const propose = (kind: Kind, pairs: Array<{ find: string; replaceWith: string }>) =>
    t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "undo-thread",
        promptMessageId: "undo-prompt",
        projectId: ids.projectId,
        reportId: ids.reportId,
        ...(kind === "edit"
          ? { kind: "edit" as const, targetText: pairs[0]!.find, newText: pairs[0]!.replaceWith }
          : { kind: "replacements" as const, replacements: pairs }),
        ...(kind === "bulk" ? { requireUniqueTargets: true } : {}),
        state: "pending" as const,
        createdAt: Date.now(),
      })
    );
  const report = () => t.run(async (ctx) => (await ctx.db.get(ids.reportId))!);
  const proposal = (id: Id<"chatProposals">) => t.run(async (ctx) => (await ctx.db.get(id))!);
  const setContent = (next: unknown) =>
    t.run(async (ctx) => {
      await ctx.db.patch(ids.reportId, { content: JSON.stringify(next) });
    });
  const snapshots = () =>
    t.run((ctx) => ctx.db.query("reportSnapshots").withIndex("by_reportId", (q) => q.eq("reportId", ids.reportId)).collect());
  const listed = async (id: Id<"chatProposals">) =>
    (await owner.query(api.chatV2.listProposals, { threadId: "undo-thread" })).find((row) => row._id === id)!;
  return { t, ...ids, content, owner, propose, report, proposal, setContent, snapshots, listed };
}

async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) return String((data as { code: unknown }).code);
    return `untyped: ${String(error)}`;
  }
  return "no error";
}

const TARGET = "The team tested the coupon at [GAP: load] cycles.";
const REWRITE = "The team cycled the coupon to failure at [GAP: load] cycles.";

describe("undoProposal", () => {
  it("puts back exactly what the apply replaced, marks included, and returns the card to pending", async () => {
    const f = await setup();
    const id = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id })).toMatchObject({ applied: true, count: 1 });
    const applied = await f.report();
    // The match spanned inline nodes, so the apply rebuilt the block as plain
    // text: reversing the pair could never bring the bold and highlight back.
    expect(JSON.parse(applied.content).content[1]).toEqual(paragraph(text(REWRITE)));
    expect(applied.revisionNumber).toBe(1);
    const card = await f.proposal(id);
    expect(card.state).toBe("applied");
    expect(card.appliedChange).toMatchObject({ revisionNumber: 1, appliedBy: f.ownerId });
    expect(card.appliedChange!.hunks).toHaveLength(1);
    // The browser learns only whether it can be undone, never the hunks.
    const before = await f.listed(id);
    expect(before.undoable).toBe(true);
    expect(before).not.toHaveProperty("appliedChange");

    expect(await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id })).toEqual({ undone: true, revisionNumber: 2 });
    const restored = await f.report();
    expect(restored.content).toBe(f.content);
    expect(restored.revisionNumber).toBe(2);
    const undone = await f.proposal(id);
    expect(undone.state).toBe("pending");
    expect(undone.appliedChange).toBeUndefined();
    expect(undone.undoneBy).toBe(f.ownerId);
    expect(typeof undone.undoneAt).toBe("number");
    const after = await f.listed(id);
    expect(after.undoable).toBe(false);
    expect(after.undoneAt).toBe(undone.undoneAt);

    // A `pre_chat_undo` snapshot of the applied text, labelled for Version history.
    const undoSnapshots = (await f.snapshots()).filter((snapshot) => snapshot.reason === "pre_chat_undo");
    expect(undoSnapshots).toHaveLength(1);
    expect(undoSnapshots[0]).toMatchObject({ label: "Before undo", content: applied.content, sourceRevisionNumber: 1 });
  });

  it("restores the passage after an unrelated edit elsewhere and an editor re-save, and keeps that edit", async () => {
    const f = await setup();
    const id = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id });
    const applied = JSON.parse((await f.report()).content);
    // The writer edits another Line, and the editor re-saves the document its
    // own way: a null attribute added, a text run split.
    applied.content[4] = paragraph(text("The rig ran "), text("overnight and again at noon."));
    applied.content[1] = { ...applied.content[1], attrs: { textAlign: null } };
    applied.content.splice(3, 0, paragraph(text("A paragraph the writer added.")));
    await f.setContent(applied);

    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    const restored = JSON.parse((await f.report()).content);
    expect(restored.content[1]).toEqual(ORIGINAL.content[1]);
    expect(restored.content[2]).toEqual(ORIGINAL.content[2]);
    expect(restored.content[3]).toEqual(paragraph(text("A paragraph the writer added.")));
    expect(restored.content[5]).toEqual(paragraph(text("The rig ran "), text("overnight and again at noon.")));
  });

  it("refuses with PROPOSAL_UNDO_CONFLICT when the applied passage changed, and changes nothing", async () => {
    const f = await setup();
    const id = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id });
    const applied = JSON.parse((await f.report()).content);
    applied.content[1] = paragraph(text(`${REWRITE} The writer added a sentence.`));
    await f.setContent(applied);
    const stored = await f.report();

    let message = "";
    try {
      await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    } catch (error) {
      message = String((error as { data?: { message?: unknown } }).data?.message);
    }
    expect(message).toBe(PROPOSAL_UNDO_CONFLICT_MESSAGE);
    expect(await errorCode(() => f.owner.mutation(api.chatV2.undoProposal, { proposalId: id }))).toBe("PROPOSAL_UNDO_CONFLICT");
    expect(await f.report()).toEqual(stored);
    expect((await f.proposal(id)).state).toBe("applied");
    expect((await f.snapshots()).filter((snapshot) => snapshot.reason === "pre_chat_undo")).toEqual([]);
  });

  it("refuses when the applied passage now appears twice", async () => {
    const f = await setup();
    const id = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id });
    const applied = JSON.parse((await f.report()).content);
    // The writer pasted the changed paragraph and its neighbour again.
    applied.content.splice(3, 0, applied.content[0], applied.content[1], applied.content[2]);
    await f.setContent(applied);
    expect(await errorCode(() => f.owner.mutation(api.chatV2.undoProposal, { proposalId: id }))).toBe("PROPOSAL_UNDO_CONFLICT");
    expect((await f.proposal(id)).state).toBe("applied");
  });

  it("undoes a bulk card's passages together", async () => {
    const f = await setup();
    const id = await f.propose("bulk", [
      { find: TARGET, replaceWith: REWRITE },
      { find: "The rig ran overnight.", replaceWith: "The rig ran for 14 hours." },
    ]);
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id })).toMatchObject({ applied: true, count: 2 });
    const card = await f.proposal(id);
    expect(card.appliedChange!.hunks).toHaveLength(2);
    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    expect((await f.report()).content).toBe(f.content);
  });

  it("undoes a replace-all card and a one-by-one (stepper) apply", async () => {
    const f = await setup();
    const id = await f.propose("replacements", [{ find: "The", replaceWith: "Our" }]);
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id });
    expect((await f.report()).content).not.toBe(f.content);
    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    expect((await f.report()).content).toBe(f.content);

    // The writer stepped through it in the editor and accepted one occurrence.
    const stepped = structuredClone(ORIGINAL);
    stepped.content[2] = paragraph(text("Our coating was sprayed twice."));
    const revision = (await f.report()).revisionNumber ?? 0;
    await f.owner.mutation(api.chatV2.markProposalApplied, {
      proposalId: id,
      content: JSON.stringify(stepped),
      expectedRevisionNumber: revision,
    });
    expect((await f.listed(id)).undoable).toBe(true);
    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    expect((await f.report()).content).toBe(f.content);
  });

  it("leaves the writer's other edits from a stepped session in place", async () => {
    const f = await setup();
    const id = await f.propose("replacements", [{ find: "sprayed", replaceWith: "brushed" }]);
    const stepped = structuredClone(ORIGINAL);
    stepped.content[2] = paragraph(text("The coating was brushed twice."));
    // Typed by the writer during the session, away from the card's passage.
    stepped.content[4] = paragraph(text("The rig ran overnight and again at noon."));
    await f.owner.mutation(api.chatV2.markProposalApplied, {
      proposalId: id, content: JSON.stringify(stepped), expectedRevisionNumber: 0,
    });
    expect((await f.proposal(id)).appliedChange!.hunks).toHaveLength(1);
    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    const restored = JSON.parse((await f.report()).content);
    expect(restored.content[2]).toEqual(ORIGINAL.content[2]);
    expect(restored.content[4]).toEqual(paragraph(text("The rig ran overnight and again at noon.")));
  });

  it("refuses an Undo that would make the report too long, and changes nothing", async () => {
    const f = await setup();
    const id = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id });
    // The applied passage stays; the old text it puts back is large, and the
    // writer has since filled the report close to the limit.
    await f.t.run(async (ctx) => {
      const card = (await ctx.db.get(id))!;
      const hunk = card.appliedChange!.hunks[0]!;
      const big = JSON.stringify([paragraph(text("x".repeat(300_000)))]);
      await ctx.db.patch(id, { appliedChange: { ...card.appliedChange!, hunks: [{ before: big, after: hunk.after }] } });
      const report = (await ctx.db.get(f.reportId))!;
      const doc = JSON.parse(report.content);
      doc.content.push(paragraph(text("y".repeat(800_000))));
      await ctx.db.patch(f.reportId, { content: JSON.stringify(doc) });
    });
    const stored = await f.report();
    let message = "";
    try {
      await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    } catch (error) {
      message = String((error as { data?: { message?: unknown } }).data?.message);
    }
    expect(message).toBe(PROPOSAL_UNDO_TOO_LONG_MESSAGE);
    expect(await errorCode(() => f.owner.mutation(api.chatV2.undoProposal, { proposalId: id }))).toBe("INVALID_INPUT");
    expect(await f.report()).toEqual(stored);
    expect((await f.proposal(id)).state).toBe("applied");
  });

  it("allows an Undo that shortens a report already over the byte limit (round 2 N3)", async () => {
    const f = await setup();
    const id = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id });
    // Accented text: about 520,000 characters but over 1,000,000 bytes. The
    // Undo puts back a shorter passage, so the report gets smaller.
    await f.t.run(async (ctx) => {
      const card = (await ctx.db.get(id))!;
      const hunk = card.appliedChange!.hunks[0]!;
      const small = JSON.stringify([paragraph(text("Short."))]);
      await ctx.db.patch(id, { appliedChange: { ...card.appliedChange!, hunks: [{ before: small, after: hunk.after }] } });
      const report = (await ctx.db.get(f.reportId))!;
      const doc = JSON.parse(report.content);
      doc.content.push(paragraph(text("é".repeat(520_000))));
      await ctx.db.patch(f.reportId, { content: JSON.stringify(doc) });
    });
    expect(new TextEncoder().encode((await f.report())!.content).length).toBeGreaterThan(1_000_000);
    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    expect((await f.proposal(id)).state).toBe("pending");
  });

  it("lets an undone card be applied again, and undone again", async () => {
    const f = await setup();
    const id = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id });
    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id })).toMatchObject({ applied: true, count: 1 });
    expect((await f.listed(id)).undoable).toBe(true);
    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: id });
    expect((await f.report()).content).toBe(f.content);
    expect((await f.report()).revisionNumber).toBe(4);
    // A pending card can also be dismissed after Undo.
    await f.owner.mutation(api.chatV2.rejectProposal, { proposalId: id });
    expect((await f.proposal(id)).state).toBe("rejected");
  });

  it("needs report edit access", async () => {
    const f = await setup();
    const id = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id });
    const applied = await f.report();
    expect(await errorCode(() => f.t.withIdentity({ subject: "undo-other-writer" }).mutation(api.chatV2.undoProposal, { proposalId: id }))).toBe("NOT_AUTHORIZED");
    expect(await errorCode(() => f.t.withIdentity({ subject: "undo-roleless" }).mutation(api.chatV2.undoProposal, { proposalId: id }))).toBe("NOT_AUTHORIZED");
    expect(await errorCode(() => f.t.mutation(api.chatV2.undoProposal, { proposalId: id }))).toBe("NOT_AUTHENTICATED");
    expect(await f.report()).toEqual(applied);
    expect((await f.proposal(id)).state).toBe("applied");
    // A manager may.
    await f.t.withIdentity({ subject: "undo-manager" }).mutation(api.chatV2.undoProposal, { proposalId: id });
    expect((await f.report()).content).toBe(f.content);
  });

  it("refuses with INVALID_STATE for a card that is not applied or has no recorded change", async () => {
    const f = await setup();
    const pending = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    expect(await errorCode(() => f.owner.mutation(api.chatV2.undoProposal, { proposalId: pending }))).toBe("INVALID_STATE");
    // Applied before this change (no record), a highlight, a record-only revision.
    const legacy = await f.t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "undo-thread", projectId: f.projectId, reportId: f.reportId,
        kind: "edit", targetText: "x", newText: "y", state: "applied", createdAt: Date.now(),
      })
    );
    const highlight = await f.t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "undo-thread", projectId: f.projectId, reportId: f.reportId,
        kind: "references", references: ["The rig ran overnight."], state: "applied", createdAt: Date.now(),
      })
    );
    const recordOnly = await f.t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "undo-thread", projectId: f.projectId, reportId: f.reportId,
        kind: "replacements", replacements: [], requireUniqueTargets: true, state: "applied", createdAt: Date.now(),
      })
    );
    for (const proposalId of [legacy, highlight, recordOnly]) {
      expect(await errorCode(() => f.owner.mutation(api.chatV2.undoProposal, { proposalId }))).toBe("INVALID_STATE");
    }
    expect((await f.report()).content).toBe(f.content);
  });

  it(`keeps no Undo for a change over ${APPLIED_CHANGE_MAX_CHARS.toLocaleString("en-US")} characters`, async () => {
    const long = "word ".repeat(Math.ceil(APPLIED_CHANGE_MAX_CHARS / 5));
    const f = await setup({ type: "doc", content: [paragraph(text(`Start. ${long}`))] });
    const id = await f.propose("edit", [{ find: "Start.", replaceWith: "Begin." }]);
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id })).toMatchObject({ applied: true });
    expect((await f.proposal(id)).appliedChange).toBeUndefined();
    expect((await f.listed(id)).undoable).toBe(false);
    expect(await errorCode(() => f.owner.mutation(api.chatV2.undoProposal, { proposalId: id }))).toBe("INVALID_STATE");
  });

  it("records nothing for a research card, whose row reaches the browser whole", async () => {
    const f = await setup();
    const id = await f.propose("edit", [{ find: TARGET, replaceWith: REWRITE }]);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(id, { agentThreadId: "research:session" });
    });
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id });
    expect((await f.proposal(id)).appliedChange).toBeUndefined();
  });
});

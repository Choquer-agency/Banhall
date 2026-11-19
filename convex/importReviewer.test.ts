/// <reference types="vite/client" />
// Reviewers from the file name and "Reviewed by CRA" (2026-11-17,
// docs/product-domain.md): the reviewer initials after the writer's
// ("T1.DW.PN": reviewer PN) give a file its reviewer by the writer's own
// check and freeze rule; a firm-wide pick applies to both roles; a writer
// referenced only as a reviewer is never removed or deleted; an Admin marks
// final PDs reviewed by CRA by hand. Made-up people and companies only.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { classify } from "./lib/ingestionClassify";
import schema from "./schema";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

const modules = import.meta.glob("./**/*.ts");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;
type Who = ReturnType<T["withIdentity"]>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const FY = "Cedarline Systems/2025 - Mar 31";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "reviewer-admin", role: "admin", firstName: "Kim", lastName: "Tran" });
    await ctx.db.insert("users", { authId: "reviewer-writer", role: "writer", firstName: "Sam", lastName: "Okafor" });
    await ctx.db.insert("users", { authId: "reviewer-manager", role: "manager", firstName: "Halden", lastName: "Reyes" });
  });
  return {
    t,
    admin: t.withIdentity({ subject: "reviewer-admin" }),
    writer: t.withIdentity({ subject: "reviewer-writer" }),
    manager: t.withIdentity({ subject: "reviewer-manager" }),
  };
}

async function addMember(t: T, firstName: string, lastName: string, initials?: string): Promise<Id<"users">> {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      authId: `member-${firstName}-${lastName}`,
      firstName,
      lastName,
      role: "writer",
      ...(initials === undefined ? {} : { initials }),
    })
  );
}

function discoveredArgs(path: string, extra: { driveItemId?: string; contentHash?: string } = {}) {
  const segments = path.split("/");
  const name = segments.pop()!;
  const meta = classify(segments.join("/"), name);
  return {
    driveItemId: extra.driveItemId ?? `drive-${path}`,
    path,
    name,
    clientName: meta.clientName,
    fiscalYearLabel: meta.fiscalYearLabel,
    fiscalYear: meta.fiscalYear,
    docKind: meta.docKind,
    size: 2048,
    lastModifiedAt: 1_700_000_000_000,
    contentHash: extra.contentHash ?? "hash-1",
    pairGroupKey: meta.pairGroupKey,
  };
}

/** A final PD "T1.<writer>.<reviewer>" path. */
const pdPath = (writer: string, reviewer: string | null, n: number, stage = "To be submitted") =>
  `${FY}/${stage}/${String(n).padStart(2, "0")} CedarlineSystems 2025-03-31 T1.${writer}${reviewer ? `.${reviewer}` : ""} Project${n}.docx`;

async function stage(t: T, path: string, driveItemId = `drive-${path}`): Promise<Id<"ingestionItems">> {
  await t.mutation(internal.ingestion.upsertDiscoveredItem, discoveredArgs(path, { driveItemId }));
  const row = await t.run((ctx) => ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", driveItemId)).unique());
  return row!._id;
}

async function markRead(t: T, id: Id<"ingestionItems">) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
  await t.mutation(internal.ingestion.markItemProcessed, { itemId: id, storageId, text: "Text", documentScienceCode: "2.02.09" });
}

/** A read final PD by `writer`, reviewed by `reviewer`. */
async function pd(t: T, writer: string, reviewer: string | null, n: number, stageName?: string) {
  const id = await stage(t, pdPath(writer, reviewer, n, stageName), `${writer}-${reviewer}-${n}-${stageName ?? ""}`);
  await markRead(t, id);
  return id;
}

async function getItem(t: T, id: Id<"ingestionItems">): Promise<Doc<"ingestionItems">> {
  const row = await t.run((ctx) => ctx.db.get(id));
  if (!row) throw new Error("item missing");
  return row;
}

async function writerById(t: T, id: Id<"pdWriters"> | undefined) {
  return id ? await t.run((ctx) => ctx.db.get(id)) : null;
}

async function ownWriterOf(t: T, userId: Id<"users">) {
  const rows = await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_userId", (q) => q.eq("userId", userId)).collect());
  return rows.find((row) => row.linkedAt === undefined) ?? null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The scheduled writer walks, run to the end (and nothing else). */
async function runWriterWalk(t: T) {
  const done = new Set<string>();
  const walks = {
    applyWriterInitials: internal.ingestion.applyWriterInitials,
    refreshWriterFiles: internal.ingestion.refreshWriterFiles,
    backfillImportWriters: internal.ingestion.backfillImportWriters,
  } as const;
  for (;;) {
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const next = jobs.find(
      (job) => job.state.kind === "pending" && !done.has(job._id) && Object.keys(walks).some((name) => job.name.endsWith(`:${name}`))
    );
    if (!next) return;
    done.add(next._id);
    const name = next.name.split(":").pop() as keyof typeof walks;
    const run = t.mutation as (fn: unknown, args: unknown) => Promise<unknown>;
    await run(walks[name], next.args[0]);
  }
}

/** Every file's writer and reviewer fields, and every pick: what a pick then its Undo must put back. */
async function roleState(t: T) {
  return await t.run(async (ctx) => ({
    files: (await ctx.db.query("ingestionItems").collect()).map((row) => [
      row._id,
      row.writerId ?? null,
      row.writerNameSource ?? null,
      row.writerName ?? null,
      row.writerBeforePick ?? null,
      row.reviewerId ?? null,
      row.reviewerSource ?? null,
      row.reviewerBeforePick ?? null,
    ]),
    picks: (await ctx.db.query("pdWriterPicks").collect()).map((pick) => [pick.initials, pick.writerId]),
  }));
}

/** Each writer's file, review and held counts against a hand recount of every file. */
async function expectWriterCountsByHand(t: T, label: string) {
  const { items, writers } = await t.run(async (ctx) => ({
    items: await ctx.db.query("ingestionItems").collect(),
    writers: await ctx.db.query("pdWriters").collect(),
  }));
  for (const writer of writers) {
    const id = writer._id;
    expect(writer.fileCount, `${label}: files of ${writer.initials ?? writer.name}`).toBe(items.filter((row) => row.writerId === id).length);
    expect(writer.reviewCount ?? 0, `${label}: reviewed by ${writer.initials ?? writer.name}`).toBe(
      items.filter((row) => row.reviewerId === id).length
    );
    expect(writer.heldCount ?? 0, `${label}: held ${writer.initials ?? writer.name}`).toBe(
      items.filter((row) => row.writerBeforePick?.writerId === id).length +
        items.filter((row) => row.reviewerBeforePick?.reviewerId === id).length
    );
  }
  for (const row of items) {
    if (row.reviewerId) expect(writers.some((writer) => writer._id === row.reviewerId), `${label}: ${row.path} reviewer is there`).toBe(true);
  }
}

async function approve(t: T, admin: Who, id: Id<"ingestionItems">) {
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
  t.registerComponent("embedPool", workpoolSchema, workpoolModules);
  await admin.mutation(internal.ingestion.finalizeApproval, { itemId: id, content: "Approved text", industry: "Cold chain logistics", writerTier: 0.5 });
}

describe("the reviewer check on each imported file", () => {
  it("gives a file the one team member whose saved initials are its reviewer's, however the file arrives", async () => {
    const { t, admin } = await setup();
    const priya = await addMember(t, "Priya", "Nair", "PN");
    // OneDrive sync, one file.
    const sync = await pd(t, "DW", "PN", 1);
    // The client uploader.
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...discoveredArgs(pdPath("DW", "PN", 2), { driveItemId: "local-uploader-2" }),
      via: "uploader",
    });
    const uploader = (await t.run((ctx) => ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", "local-uploader-2")).unique()))!._id;
    // OneDrive sync, a page of files.
    await t.mutation(internal.ingestion.upsertDiscoveredBatch, { items: [discoveredArgs(pdPath("DW", "PN", 3), { driveItemId: "batch-3" })] });
    const batch = (await t.run((ctx) => ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", "batch-3")).unique()))!._id;
    // A drop on the Import page.
    const text = "Priya's review copy";
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([text])));
    const batchId = await admin.mutation(api.ingestion.startImportBatch, { toSend: 1, alreadyHere: 0 });
    await admin.mutation(api.ingestion.stageImportFiles, {
      batchId,
      files: [{ path: pdPath("DW", "PN", 4), storageId, contentHash: await sha256Hex(text), lastModifiedAt: 1 }],
    });
    const dropped = (await t.run((ctx) => ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", `local:${pdPath("DW", "PN", 4)}`)).unique()))!._id;
    // Put back: deleted while two people had KT (no reviewer); once only one has KT, putting it back gives it them.
    const jordan = await addMember(t, "Jordan", "Ellis", "KT");
    const kimAdmin = (await t.run((ctx) => ctx.db.query("users").collect())).find((user) => user.authId === "reviewer-admin")!;
    await t.run((ctx) => ctx.db.patch(kimAdmin._id, { initials: "KT" }));
    const putBack = await pd(t, "DW", "KT", 5);
    expect((await getItem(t, putBack)).reviewerId).toBeUndefined();
    await admin.mutation(api.ingestion.removeItems, { ids: [putBack] });
    await t.run((ctx) => ctx.db.patch(jordan, { initials: "JE" }));
    await admin.mutation(api.ingestion.restoreItems, { ids: [putBack] });

    const priyaWriter = (await ownWriterOf(t, priya))!;
    for (const id of [sync, uploader, batch, dropped]) {
      expect(await getItem(t, id), id).toMatchObject({ reviewerId: priyaWriter._id, reviewerSource: "initials" });
      const row = await admin.query(api.ingestion.sheetFile, { id });
      expect(row).toMatchObject({ reviewerName: "Priya Nair", reviewerHasLogin: true, reviewerSource: "initials" });
    }
    expect((await getItem(t, putBack)).reviewerId).toBe((await ownWriterOf(t, kimAdmin._id))!._id);
    expect(priyaWriter.reviewCount).toBe(4);
    // Priya wrote none of them.
    expect(priyaWriter.fileCount).toBe(0);
    await expectWriterCountsByHand(t, "after five ways in");
  });

  it("makes one bare past writer from new initials, shared by both roles: PN reviewing and PN writing are one person", async () => {
    const { t } = await setup();
    const reviewed = await pd(t, "DW", "PN", 1);
    const written = await pd(t, "PN", null, 2);
    const pn = (await writerById(t, (await getItem(t, reviewed)).reviewerId))!;
    expect(pn).toMatchObject({ initials: "PN", createdVia: "import", fileCount: 1, reviewCount: 1 });
    expect(pn.userId).toBeUndefined();
    expect((await getItem(t, written)).writerId).toBe(pn._id);
    await expectWriterCountsByHand(t, "after one person in both roles");
  });

  it("gives no reviewer, and no check reason, when two members share the initials", async () => {
    const { t, admin } = await setup();
    await addMember(t, "Priya", "Nair", "PN");
    await addMember(t, "Pat", "Nolan", "PN");
    await addMember(t, "Dana", "Whitlock", "DW");
    const id = await pd(t, "DW", "PN", 1);
    const row = await getItem(t, id);
    expect(row.reviewerId).toBeUndefined();
    expect(row.reviewerSource).toBeUndefined();
    // Nothing is to check: a reviewer is never required.
    expect(row).toMatchObject({ needsCheck: false, checkReasons: [] });
    const shown = await admin.query(api.ingestion.sheetFile, { id });
    expect(shown?.reviewerId).toBeUndefined();
    expect(shown?.reviewerInitials).toBe("PN");
    await expectWriterCountsByHand(t, "after two people with PN");
  });

  it("takes part only for final PDs, drafts and review copies, and lets go when a file stops being one", async () => {
    const { t, admin } = await setup();
    const draft = await stage(t, `${FY}/Drafts/03 CedarlineSystems 2025-03-31 R2.DW.PN SensorDraft.docx`);
    await markRead(t, draft);
    expect((await getItem(t, draft)).reviewerSource).toBe("initials");
    const pn = (await getItem(t, draft)).reviewerId!;
    // Moved to Transcripts: it takes no reviewer, so the one from its initials goes, and the bare writer with it.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [draft], patch: { category: "transcript" } });
    expect((await getItem(t, draft)).reviewerId).toBeUndefined();
    expect(await writerById(t, pn)).toBeNull();
    await expectWriterCountsByHand(t, "after a move to Transcripts");
  });

  it("keeps a file's reviewer once it has one: new saved initials and an edit never move it (the freeze rule)", async () => {
    const { t, admin } = await setup();
    const frozen = await pd(t, "DW", "PN", 1);
    const pastPn = (await getItem(t, frozen)).reviewerId!;
    const priya = await addMember(t, "Priya", "Nair");
    await admin.mutation(api.users.setUserInitials, { userId: priya, initials: "PN" });
    await runWriterWalk(t);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [frozen], patch: { scienceCode: "1.02.01" } });
    expect(await getItem(t, frozen)).toMatchObject({ reviewerId: pastPn, reviewerSource: "initials" });
    // A new PN file is hers.
    const later = await pd(t, "DW", "PN", 2);
    expect((await getItem(t, later)).reviewerId).toBe((await ownWriterOf(t, priya))!._id);
    // The past writer referenced only as a reviewer still lists under Past writers, and cannot be deleted.
    const past = (await admin.query(api.users.listPastWriters, {})).find((row) => row._id === pastPn);
    expect(past).toMatchObject({ initials: "PN", canDelete: false });
    await expectWriterCountsByHand(t, "after the facts changed under a frozen reviewer");
  });

  it("fills a file with no reviewer once only one member has the initials", async () => {
    const { t, admin } = await setup();
    const priya = await addMember(t, "Priya", "Nair", "PN");
    const pat = await addMember(t, "Pat", "Nolan", "PN");
    const id = await pd(t, "DW", "PN", 1);
    expect((await getItem(t, id)).reviewerId).toBeUndefined();
    await admin.mutation(api.users.setUserInitials, { userId: pat, initials: "PT" });
    await runWriterWalk(t);
    expect(await getItem(t, id)).toMatchObject({ reviewerId: (await ownWriterOf(t, priya))!._id, reviewerSource: "initials" });
    await expectWriterCountsByHand(t, "after the initials were freed");
  });

  it("gives no writer and no reviewer to a name with three or four initials groups, until the client says what they mean", async () => {
    const { t } = await setup();
    const id = await stage(t, `${FY}/To be submitted/01 Cedarline Systems 2026-03-31 T0.DW.PN.KT LabelVision-ColdChain.docx`);
    await markRead(t, id);
    const row = await getItem(t, id);
    expect(row).toMatchObject({ initialsGroups: ["DW", "PN", "KT"], versionCode: "T", versionNumber: 0, pdNumber: "1", pdTitle: "Label Vision-Cold Chain" });
    expect(row.writerInitials).toBeUndefined();
    expect(row.reviewerInitials).toBeUndefined();
    expect(row.writerId).toBeUndefined();
    expect(row.reviewerId).toBeUndefined();
    // As a file with no initials: the writer is to be chosen.
    expect(row.checkReasons).toContain("no_writer");
    expect(await t.run((ctx) => ctx.db.query("pdWriters").collect())).toEqual([]);
  });
});

describe("a firm-wide pick for initials applies to writers and reviewers", () => {
  it("moves the files PN wrote and the files PN reviewed, and its Undo puts both back exactly", async () => {
    const { t, admin } = await setup();
    const priya = await addMember(t, "Priya", "Nair");
    const reviewed = await pd(t, "DW", "PN", 1);
    const written = await pd(t, "PN", "SO", 2);
    const both = await pd(t, "PN", "PN", 3);
    // A file whose reviewer a person set on the file keeps it through the pick.
    const own = await pd(t, "DW", "PN", 4);
    await admin.mutation(api.ingestion.setFileReviewers, { ids: [own], reviewer: { kind: "name", name: "Sam Okafor" } });
    // A deleted file follows too.
    const deleted = await pd(t, "DW", "PN", 5);
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const before = await roleState(t);
    const pastPn = (await getItem(t, reviewed)).reviewerId!;

    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: { kind: "user", userId: priya } });
    // The writers' files and the first reviewers' files on To review change in the call.
    expect(result).toMatchObject({ initials: "PN", writerName: "Priya Nair", changed: 3, more: false });
    await runWriterWalk(t);
    const priyaWriter = (await ownWriterOf(t, priya))!;
    expect(await getItem(t, reviewed)).toMatchObject({ reviewerId: priyaWriter._id, reviewerSource: "pick", reviewerBeforePick: { reviewerId: pastPn, reviewerSource: "initials" } });
    expect(await getItem(t, written)).toMatchObject({ writerId: priyaWriter._id, writerNameSource: "pick" });
    expect((await getItem(t, written)).reviewerSource).toBe("initials");
    expect(await getItem(t, both)).toMatchObject({ writerId: priyaWriter._id, reviewerId: priyaWriter._id });
    expect(await getItem(t, deleted)).toMatchObject({ reviewerId: priyaWriter._id, reviewerSource: "pick" });
    expect(await getItem(t, own)).toMatchObject({ reviewerSource: "person" });
    // The past PN is held by the files that remember it, so it stays.
    expect(await writerById(t, pastPn)).toMatchObject({ fileCount: 0, reviewCount: 0 });
    expect((await writerById(t, pastPn))!.heldCount).toBeGreaterThan(0);
    await expectWriterCountsByHand(t, "after the pick");

    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: result.previous });
    await runWriterWalk(t);
    expect(await roleState(t)).toEqual(before);
    await expectWriterCountsByHand(t, "after the Undo");
  });

  it("walks a chain of picks back one Undo at a time, reviewers included", async () => {
    const { t, admin } = await setup();
    const ids = [await pd(t, "DW", "PN", 1), await pd(t, "PN", null, 2)];
    const start = await roleState(t);
    const first = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: { kind: "name", name: "Priya Nair" } });
    await runWriterWalk(t);
    const afterFirst = await roleState(t);
    const second = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: { kind: "name", name: "Pat Nolan" } });
    await runWriterWalk(t);
    expect((await getItem(t, ids[0])).reviewerId).toBe(second.writerId);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: second.previous });
    await runWriterWalk(t);
    expect(await roleState(t)).toEqual(afterFirst);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: first.previous });
    await runWriterWalk(t);
    expect(await roleState(t)).toEqual(start);
    await expectWriterCountsByHand(t, "after the chain");
  });

  it("changes 100 reviewers' files in the call and the rest in scheduled runs", async () => {
    const { t, admin } = await setup();
    await t.run(async (ctx) => {
      for (const authId of ["reviewer-admin", "reviewer-writer"]) {
        const user = (await ctx.db.query("users").collect()).find((row) => row.authId === authId)!;
        await ctx.db.patch(user._id, { initials: "PN" });
      }
    });
    for (let i = 0; i < 105; i++) await stage(t, pdPath("DW", "PN", (i % 20) + 1).replace("Project", `P${i} Project`), `many-${i}`);
    // Not read yet: being read files still follow a pick (only approved files keep theirs).
    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: { kind: "name", name: "Priya Nair" } });
    expect(result).toMatchObject({ changed: 100, more: true });
    await runWriterWalk(t);
    const rows = await t.run((ctx) => ctx.db.query("ingestionItems").collect());
    expect(rows.filter((row) => row.reviewerId === result.writerId)).toHaveLength(105);
    await expectWriterCountsByHand(t, "after 105 reviewers");
  });
});

describe("a writer referenced only as a reviewer", () => {
  it("is never removed on its own, and Delete is refused, while a file names it as reviewer", async () => {
    const { t, admin } = await setup();
    const id = await pd(t, "DW", "PN", 1);
    const pn = (await getItem(t, id)).reviewerId!;
    // Its only file as a writer comes and goes: it stays as a reviewer.
    const written = await pd(t, "PN", null, 2);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [written], patch: { category: "transcript" } });
    expect(await writerById(t, pn)).toMatchObject({ fileCount: 0, reviewCount: 1 });
    expect((await admin.query(api.users.listPastWriters, {})).find((row) => row._id === pn)).toMatchObject({ canDelete: false, fileCount: 0 });
    await expect(admin.mutation(api.users.deletePastWriter, { writerId: pn })).rejects.toThrow(/Files still point at this writer/);
    // A person sets another reviewer on the file: nothing points at the bare PN any more, so it goes.
    await admin.mutation(api.ingestion.setFileReviewers, { ids: [id], reviewer: { kind: "name", name: "Priya Nair" } });
    expect(await writerById(t, pn)).toBeNull();
    await expectWriterCountsByHand(t, "after the reviewer left");
  });

  it("stays while a file remembers it as its reviewer from before a pick", async () => {
    const { t, admin } = await setup();
    const id = await pd(t, "DW", "PN", 1);
    const pn = (await getItem(t, id)).reviewerId!;
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: { kind: "name", name: "Priya Nair" } });
    expect(await writerById(t, pn)).toMatchObject({ reviewCount: 0, heldCount: 1 });
    await expect(admin.mutation(api.users.deletePastWriter, { writerId: pn })).rejects.toThrow(/Files still point at this writer/);
  });
});

describe("setFileReviewers", () => {
  it("sets the reviewer of files alone on To review and Deleted, which wins over a pick, and skips the rest", async () => {
    const { t, admin } = await setup();
    const priya = await addMember(t, "Priya", "Nair");
    const review = await pd(t, "DW", "PN", 1);
    const deleted = await pd(t, "DW", "PN", 2);
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const approved = await pd(t, "DW", "PN", 3);
    await approve(t, admin, approved);
    const transcript = await stage(t, `${FY}/WIP/Technical/Audio/interview.txt`);
    await markRead(t, transcript);
    const beingRead = await stage(t, pdPath("DW", "PN", 4));

    const result = await admin.mutation(api.ingestion.setFileReviewers, {
      ids: [review, deleted, approved, transcript, beingRead],
      reviewer: { kind: "user", userId: priya },
    });
    expect(result.changedIds).toEqual([review, deleted]);
    expect(result.skipped).toEqual([
      { id: approved, reason: "approved" },
      { id: transcript, reason: "does_not_apply" },
      { id: beingRead, reason: "being_read" },
    ]);
    const priyaWriter = (await ownWriterOf(t, priya))!;
    for (const id of [review, deleted]) expect(await getItem(t, id)).toMatchObject({ reviewerId: priyaWriter._id, reviewerSource: "person" });
    // The same again changes nothing.
    expect((await admin.mutation(api.ingestion.setFileReviewers, { ids: [review], reviewer: { kind: "user", userId: priya } })).changed).toBe(0);
    // A pick for PN never moves a reviewer a person set on the file.
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: { kind: "name", name: "Pat Nolan" } });
    await runWriterWalk(t);
    expect(await getItem(t, review)).toMatchObject({ reviewerId: priyaWriter._id, reviewerSource: "person" });
    await expectWriterCountsByHand(t, "after a person's reviewer");
  });

  it("refuses anyone but an Admin, and more than 100 files", async () => {
    const { t, admin, writer, manager } = await setup();
    const id = await pd(t, "DW", "PN", 1);
    for (const who of [writer, manager]) {
      await expect(who.mutation(api.ingestion.setFileReviewers, { ids: [id], reviewer: { kind: "name", name: "Priya Nair" } })).rejects.toThrow(/Admin only/);
    }
    const many = Array.from({ length: 101 }, () => id);
    // The same id 101 times is one file.
    expect((await admin.mutation(api.ingestion.setFileReviewers, { ids: many, reviewer: { kind: "name", name: "Priya Nair" } })).changed).toBe(1);
  });
});

describe("Reviewed by CRA", () => {
  it("marks final PDs by hand, keeps who and when, clears it, and skips every other file", async () => {
    const { t, admin } = await setup();
    const review = await pd(t, "DW", "PN", 1);
    const deleted = await pd(t, "DW", "PN", 2);
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const draft = await stage(t, `${FY}/Drafts/03 CedarlineSystems 2025-03-31 R2.DW.PN SensorDraft.docx`);
    await markRead(t, draft);
    const approved = await pd(t, "DW", "PN", 3);
    await approve(t, admin, approved);
    const sources = await t.run((ctx) => ctx.db.query("brainSources").collect());

    vi.setSystemTime(Date.UTC(2026, 10, 17, 15));
    const result = await admin.mutation(api.ingestion.setCraReviewed, { ids: [review, deleted, draft, approved], reviewed: true });
    expect(result.changedIds).toEqual([review, deleted]);
    expect(result.skipped).toEqual([
      { id: draft, reason: "does_not_apply" },
      { id: approved, reason: "approved" },
    ]);
    const adminId = (await t.run((ctx) => ctx.db.query("users").collect())).find((user) => user.authId === "reviewer-admin")!._id;
    expect(await getItem(t, review)).toMatchObject({ craReviewed: true, craReviewedBy: adminId, craReviewedAt: Date.UTC(2026, 10, 17, 15) });
    expect((await admin.query(api.ingestion.sheetFile, { id: review }))?.craReviewed).toBe(true);
    // It never touches the Brain's craOutcome (that steers retrieval), and is not a check.
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toEqual(sources);
    expect((await getItem(t, review)).checkReasons).toEqual([]);
    // Again: nothing changes.
    expect((await admin.mutation(api.ingestion.setCraReviewed, { ids: [review], reviewed: true })).changed).toBe(0);
    // Moved to Drafts it is kept but not shown; moved back it shows again.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [review], patch: { category: "draft" } });
    expect((await admin.query(api.ingestion.sheetFile, { id: review }))?.craReviewed).toBeUndefined();
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [review], patch: { category: "final_pd" } });
    expect((await admin.query(api.ingestion.sheetFile, { id: review }))?.craReviewed).toBe(true);
    // Cleared: all three go.
    expect((await admin.mutation(api.ingestion.setCraReviewed, { ids: [review], reviewed: false })).changedIds).toEqual([review]);
    const cleared = await getItem(t, review);
    expect(cleared.craReviewed).toBeUndefined();
    expect(cleared.craReviewedBy).toBeUndefined();
    expect(cleared.craReviewedAt).toBeUndefined();
  });

  it("is Admin only", async () => {
    const { t, writer, manager } = await setup();
    const id = await pd(t, "DW", "PN", 1);
    for (const who of [writer, manager]) {
      await expect(who.mutation(api.ingestion.setCraReviewed, { ids: [id], reviewed: true })).rejects.toThrow(/Admin only/);
    }
    expect((await getItem(t, id)).craReviewed).toBeUndefined();
  });
});

describe("the writers backfill gives reviewers too", () => {
  it("reads an older approved file's reviewer from its name, leaving its saved labels as they were", async () => {
    const { t, admin } = await setup();
    const approved = await pd(t, "DW", "PN", 3);
    await approve(t, admin, approved);
    // Approved before the reader knew reviewers: no reviewer initials kept.
    await t.run(async (ctx) => {
      await ctx.db.patch(approved, { reviewerId: undefined, reviewerSource: undefined, reviewerInitials: undefined });
      const pn = (await ctx.db.query("pdWriters").withIndex("by_initials", (q) => q.eq("initials", "PN")).collect())[0];
      await ctx.db.patch(pn._id, { reviewCount: 0 });
    });
    const before = await getItem(t, approved);
    await t.mutation(internal.ingestion.backfillImportWriters, { tab: "review", cursor: null });
    await runWriterWalk(t);
    const pn = (await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_initials", (q) => q.eq("initials", "PN")).collect()))[0];
    const after = await getItem(t, approved);
    expect(after).toMatchObject({ reviewerId: pn._id, status: "approved" });
    expect(after.reviewerInitials).toBeUndefined();
    expect(after.category).toBe(before.category);
    expect(after.writerName).toBe(before.writerName);
    await expectWriterCountsByHand(t, "after reading an older approved file's reviewer");
  });

  it("settles To review and Deleted, gives an approved file only the reference, and can run again", async () => {
    const { t, admin } = await setup();
    const review = await pd(t, "DW", "PN", 1);
    const approved = await pd(t, "DW", "PN", 2);
    await approve(t, admin, approved);
    // As if both had come before reviewers existed.
    await t.run(async (ctx) => {
      for (const id of [review, approved]) await ctx.db.patch(id, { reviewerId: undefined, reviewerSource: undefined });
      const pn = (await ctx.db.query("pdWriters").withIndex("by_initials", (q) => q.eq("initials", "PN")).collect())[0];
      await ctx.db.patch(pn._id, { reviewCount: 0 });
    });
    await t.mutation(internal.ingestion.backfillImportWriters, { tab: "review", cursor: null });
    await runWriterWalk(t);
    const pn = (await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_initials", (q) => q.eq("initials", "PN")).collect()))[0];
    expect(await getItem(t, review)).toMatchObject({ reviewerId: pn._id, reviewerSource: "initials" });
    expect(await getItem(t, approved)).toMatchObject({ reviewerId: pn._id, status: "approved" });
    // Only the reference, as for the writer: no source.
    expect((await getItem(t, approved)).reviewerSource).toBeUndefined();
    await expectWriterCountsByHand(t, "after the backfill");
    const state = await roleState(t);
    await t.mutation(internal.ingestion.backfillImportWriters, { tab: "review", cursor: null });
    await runWriterWalk(t);
    expect(await roleState(t)).toEqual(state);
  });
});

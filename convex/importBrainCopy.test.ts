/// <reference types="vite/client" />
// What a later Approve reads to make an imported final PD's Brain copy
// (2026-11-17): the company by its key (or a merge), every name tied to it,
// the industry picked for a new company and the writer's tier. Nothing here
// writes. Also: chunk notes never ask for, or name, the company. Every
// company and person here is made up.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { CONTEXTUALIZE_SYSTEM_PROMPT, contextualizeMessages } from "./ai/brain/ingest";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

const TEXT = [
  "Prepared by Dana Whitlock",
  "Quillmere Analytics built a kiln controller for Quillmere Labs customers.",
  "Morgan Pell ran the trials at QuillmereCloud.",
].join("\n");

async function seed(t: T, opts: { client?: Partial<Doc<"clients">> | null; pick?: string; tier?: number; companyKey?: string } = {}) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "copy-admin", role: "admin" });
    const companyKey = opts.companyKey ?? "quillmere analytics";
    if (opts.client !== null) {
      const clientId = await ctx.db.insert("clients", {
        name: "Quillmere Analytics",
        nameKey: "quillmere analytics",
        industry: "manufacturing",
        formerNames: ["Quillmere Labs"],
        nameHistoryComplete: true,
        status: "active",
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
        ...opts.client,
      });
      await ctx.db.insert("projects", {
        title: "Kiln controller",
        clientName: "Quillmere Analytics",
        clientId,
        interviewees: ["Morgan Pell"],
        status: "review",
        createdBy: userId,
        shareToken: "copy-token",
        createdAt: 1,
        updatedAt: 1,
      });
    }
    if (opts.pick) {
      await ctx.db.insert("importNewCompanies", { companyKey, industry: opts.pick, setBy: userId, updatedAt: 1 });
    }
    const writerId = await ctx.db.insert("pdWriters", {
      initials: "DW",
      name: "Dana Whitlock",
      createdVia: "import",
      createdAt: 1,
      fileCount: 1,
      ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
    });
    const itemId: Id<"ingestionItems"> = await ctx.db.insert("ingestionItems", {
      driveItemId: "drive-1",
      path: `${companyKey}/2024 - Mar 31/Submitted`,
      name: "04 QuillmereAnalytics 2024-03-31 S1.DW.PN Kiln Controller.docx",
      clientName: "Quillmere Analytics",
      companyKey,
      fiscalYear: 2024,
      docKind: "pd",
      category: "final_pd",
      size: 1,
      lastModifiedAt: 1,
      contentHash: "bytes-1",
      status: "pending_review",
      pairGroupKey: `${companyKey}::2024`,
      writerId,
      updatedAt: 1,
    });
    return { itemId };
  });
}

describe("importBrainCopyPreview", () => {
  test("hides the company's names, its other names, its projects' people and the writer, with the company's industry", async () => {
    const t = convexTest(schema, modules);
    const { itemId } = await seed(t, { tier: 0.7 });
    const result = await t.query(internal.ingestion.importBrainCopyPreview, { itemId, text: TEXT });
    expect(result).toMatchObject({
      ok: true,
      fields: {
        title: "Past PD, FY2024",
        industry: "manufacturing",
        writerName: "Dana Whitlock",
        writerTier: 0.7,
        fiscalYear: 2024,
        importItemId: itemId,
        importContentHash: "bytes-1",
      },
    });
    if (!result.ok) return;
    expect(result.fields.content).toBe(
      "Prepared by [redacted]\n[redacted] built a kiln controller for [redacted] customers.\n[redacted] ran the trials at [redacted]Cloud."
    );
  });

  test("a writer with no tier gets 0.7 (2026-11-18, owner)", async () => {
    const t = convexTest(schema, modules);
    const { itemId } = await seed(t);
    const result = await t.query(internal.ingestion.importBrainCopyPreview, { itemId, text: TEXT });
    expect(result.ok && result.fields.writerTier).toBe(0.7);
  });

  test("a new company uses the industry picked on the sheet, and refuses without one", async () => {
    const t = convexTest(schema, modules);
    const { itemId } = await seed(t, { client: null, pick: "life-sciences" });
    const picked = await t.query(internal.ingestion.importBrainCopyPreview, { itemId, text: TEXT });
    expect(picked.ok && picked.fields.industry).toBe("life-sciences");

    const t2 = convexTest(schema, modules);
    const second = await seed(t2, { client: null });
    expect(await t2.query(internal.ingestion.importBrainCopyPreview, { itemId: second.itemId, text: TEXT })).toMatchObject({
      ok: false,
      code: "no_industry",
      reason: "Pick an industry for this company.",
    });
  });

  test("Also remove: a short entry is hidden, one of only punctuation is refused (Greptile P2)", async () => {
    const t = convexTest(schema, modules);
    const { itemId } = await seed(t);
    const text = `${TEXT}\nLi checked the AB rig.`;
    const hidden = await t.query(internal.ingestion.importBrainCopyPreview, { itemId, text, alsoRemove: ["Li", "AB"] });
    expect(hidden.ok && hidden.fields.content.split("\n").at(-1)).toBe("[redacted] checked the [redacted] rig.");
    expect(await t.query(internal.ingestion.importBrainCopyPreview, { itemId, text, alsoRemove: ["..."] })).toMatchObject({
      ok: false,
      code: "also_remove_no_word",
    });
  });

  test("a company with no industry is refused", async () => {
    const t = convexTest(schema, modules);
    const { itemId } = await seed(t, { client: { industry: undefined } });
    expect(await t.query(internal.ingestion.importBrainCopyPreview, { itemId, text: TEXT })).toMatchObject({
      ok: false,
      code: "no_industry",
    });
  });

  test("a key merged into another company reads the kept company's names and industry", async () => {
    const t = convexTest(schema, modules);
    const { itemId } = await seed(t, { companyKey: "quillmere labs" });
    await t.run(async (ctx) => {
      const kept = await ctx.db.query("clients").first();
      await ctx.db.insert("clients", {
        name: "Quillmere Labs",
        nameKey: "quillmere labs",
        status: "merged",
        mergedIntoClientId: kept!._id,
        mergedAt: 2,
        createdBy: kept!.createdBy,
        createdAt: 1,
        updatedAt: 2,
      });
    });
    const result = await t.query(internal.ingestion.importBrainCopyPreview, { itemId, text: TEXT });
    expect(result.ok && result.fields.industry).toBe("manufacturing");
    expect(result.ok && result.fields.content).not.toMatch(/quillmere/i);
  });

  test("a file no longer in Import says so", async () => {
    const t = convexTest(schema, modules);
    const { itemId } = await seed(t);
    await t.run((ctx) => ctx.db.delete(itemId));
    expect(await t.query(internal.ingestion.importBrainCopyPreview, { itemId, text: TEXT })).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});

describe("chunk notes never name the company", () => {
  test("the prompt no longer asks for the company and says not to name it", () => {
    const messages = contextualizeMessages("<the scrubbed PD>", "<one chunk>");
    const content = messages[0].content as { type: string; text: string }[];
    const ask = content[content.length - 1].text;
    expect(ask).not.toMatch(/\(company,/);
    expect(ask).toContain("Do not name the company or anyone in it.");
    expect(CONTEXTUALIZE_SYSTEM_PROMPT).toContain("Never name a company");
    expect(`${CONTEXTUALIZE_SYSTEM_PROMPT}\n${ask}`).not.toMatch(/[\u2010-\u2015]/);
  });
});

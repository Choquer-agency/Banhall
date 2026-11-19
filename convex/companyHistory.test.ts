/// <reference types="vite/client" />
/**
 * 2026-11-17 (company history, docs/product-domain.md): company files ready
 * for ten years of approved Import files. A draft reads the files added by
 * hand exactly as before, then, on top, pins the final PDs of the two fiscal
 * years before its own within the history cap; the rest of the history is
 * search-only.
 * An imported final PD never counts as the project's previous-year report
 * (decision 42). Chat lists final PDs and hand-added files first and
 * searches every file of the company, with a PD's versions collapsed.
 *
 * Every name here is made up.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { withSourceTexts } from "./lib/sourceText";
import { companyFileTextFacts, insertCompanyFileTextPieces } from "./lib/companyFileText";
import { insertSearchPieces, searchCompanyPieces } from "./lib/searchPieces";
import {
  COMPANY_HISTORY_CHARS,
  FROZEN_COMPANY_CHARS,
  FROZEN_COMPANY_FILES,
  PINNED_FINAL_PDS,
  PINNED_FINAL_PD_CHARS,
  companyFileCategory,
  draftCompanyFiles,
  fairShares,
  pinnedFinalPdsOfYear,
  planDraftCompanyFiles,
  selectFrozenEvidence,
} from "./lib/briefEvidence";
import {
  COMPANY_HISTORY_CATEGORIES,
  collapseVersionFamilies,
  isCompanyHistoryCategory,
  pdNumberKey,
  versionFamily,
} from "./lib/companyEvidence";
import { isPreviousYearDocument, PREVIOUS_YEAR_ONLY_REASON } from "../shared/previousYear";
import { CHAT_FINAL_PD_ROWS_READ, CHAT_LISTED_FINAL_PDS, chatCompanyFilesFor } from "./chatDocuments";
import { MAX_CHAT_COMPANY_FILES } from "./ai/chatEvidence";
import { newDocumentReadTurn, runReadDocument, runSearchDocuments } from "./ai/chatDocumentTools";

const modules = import.meta.glob("./**/*.ts");
const authId = "company-history-writer";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type Category = Doc<"companyFiles">["category"];

async function errorOf(call: () => Promise<unknown>): Promise<{ code: string; reason?: string }> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: { code?: unknown; reason?: unknown } }).data;
    if (data && typeof data === "object" && "code" in data) {
      return { code: String(data.code), ...(data.reason !== undefined ? { reason: String(data.reason) } : {}) };
    }
    return { code: `UNTYPED: ${(error as Error).message}` };
  }
  return { code: "NO_ERROR" };
}

/** A company, Quillmere Pumps, and its project "Cryogenic seal" for fiscal 2025, project number 4. */
async function setup(options: { fiscalYear?: number | null; transcript?: boolean; projectNumber?: string; chat?: boolean } = {}) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const clientId = await ctx.db.insert("clients", {
      name: "Quillmere Pumps", nameKey: "quillmere pumps", status: "active", nameHistoryComplete: true,
      createdBy: userId, createdAt: now, updatedAt: now,
    });
    const year = options.fiscalYear === undefined ? 2025 : options.fiscalYear;
    const projectId = await ctx.db.insert("projects", {
      title: "Cryogenic seal", clientName: "Quillmere Pumps", clientId,
      ...(year === null ? {} : { fiscalYearEnd: Date.UTC(year, 11, 31) }),
      projectNumber: options.projectNumber ?? "4",
      status: "draft", createdBy: userId, ownerId: userId, shareToken: `ch-${Math.random()}`, createdAt: now, updatedAt: now,
    });
    if (options.transcript !== false) {
      await ctx.db.insert("transcripts", { projectId, content: "Orla: The seal held at 4.2 bar on the cold rig.", createdAt: now });
    }
    // A chat needs a report; a draft's start would then ask to confirm.
    if (options.chat) {
      const reportId = await ctx.db.insert("reports", {
        projectId, content: JSON.stringify({ type: "doc", content: [] }), version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
      });
      await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId: "thread-history", title: "Chat", createdAt: now });
    }
    return { userId, clientId, projectId };
  });
  return { t, authed: t.withIdentity({ subject: authId }), ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

type FileExtra = {
  category?: Category;
  fiscalYear?: number | null;
  pdNumber?: string;
  archived?: boolean;
  /** Cut its search pieces now (no sweep). */
  pieces?: boolean;
};

async function addFile(s: Setup, fileName: string, text: string, extra: FileExtra = {}) {
  return await s.t.run(async (ctx) => {
    const facts = await companyFileTextFacts(text);
    const id = await ctx.db.insert("companyFiles", {
      clientId: s.clientId,
      fileName,
      fileType: "txt",
      ...(extra.category ? { category: extra.category } : {}),
      ...(extra.fiscalYear !== undefined ? { fiscalYear: extra.fiscalYear } : {}),
      ...(extra.pdNumber ? { pdNumber: extra.pdNumber } : {}),
      ...(extra.archived ? { archived: true } : {}),
      ...facts,
      processingStatus: "ready",
      uploadedBy: s.userId,
      createdAt: Date.now(),
    });
    await insertCompanyFileTextPieces(ctx, id, text);
    if (extra.pieces) {
      await insertSearchPieces(ctx, { companyFileId: id, clientId: s.clientId }, text, { kind: "text", textHash: facts.textHash });
    }
    return id;
  });
}

const start = (s: Setup, extra: Record<string, unknown> = {}) =>
  s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId, candidateMode: "single", ...extra });

async function companyRows(s: Setup, generationId: Id<"generations">) {
  return await s.t.run(async (ctx) =>
    (
      await withSourceTexts(
        ctx,
        await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
      )
    ).filter((row) => row.kind === "company_file")
  );
}

describe("the categories and fields an Import file keeps (2026-11-17)", () => {
  it("every Import category reads as background or other, never as a previous-year report (decision 42)", () => {
    for (const category of COMPANY_HISTORY_CATEGORIES) {
      expect(isCompanyHistoryCategory(category)).toBe(true);
      const draftCategory = companyFileCategory(category);
      expect(draftCategory).not.toBe("previous_pd");
      expect(isPreviousYearDocument({ category: draftCategory })).toBe(false);
    }
    expect(companyFileCategory("final_pd")).toBe("background");
    for (const category of ["draft", "review_copy", "transcript", "supporting"] as const) {
      expect(companyFileCategory(category)).toBe("other");
    }
    // The hand-added categories read as before.
    expect(companyFileCategory("previous_pd")).toBe("background");
    expect(companyFileCategory("background")).toBe("background");
    expect(companyFileCategory("other")).toBe("other");
    expect(companyFileCategory(undefined)).toBe("other");
    expect(isCompanyHistoryCategory("previous_pd")).toBe(false);
    expect(isCompanyHistoryCategory(undefined)).toBe(false);
  });

  it("stores the Import link, writer, reviewer and PD number, and finds a file by its Import item", async () => {
    const s = await setup();
    const { itemId, writerId, reviewerId, fileId } = await s.t.run(async (ctx) => {
      const now = Date.now();
      const writerId = await ctx.db.insert("pdWriters", { initials: "OV", createdVia: "import", createdAt: now, fileCount: 1 });
      const reviewerId = await ctx.db.insert("pdWriters", { initials: "PN", createdVia: "import", createdAt: now, fileCount: 1 });
      const itemId = await ctx.db.insert("ingestionItems", {
        driveItemId: "drive-1", path: "Quillmere Pumps/2024/final.docx", name: "final.docx", docKind: "pd", size: 10,
        lastModifiedAt: now, contentHash: "hash-1", status: "approved", pairGroupKey: "quillmere pumps::2024", updatedAt: now,
      });
      const facts = await companyFileTextFacts("Final PD text.");
      const fileId = await ctx.db.insert("companyFiles", {
        clientId: s.clientId, fileName: "final.docx", fileType: "docx", category: "final_pd", fiscalYear: 2024, pdNumber: "04",
        importItemId: itemId, writerId, reviewerId, ...facts, processingStatus: "ready", uploadedBy: s.userId, createdAt: now,
      });
      return { itemId, writerId, reviewerId, fileId };
    });
    const found = await s.t.run(async (ctx) =>
      ctx.db.query("companyFiles").withIndex("by_importItemId", (q) => q.eq("importItemId", itemId)).unique()
    );
    expect(found).toMatchObject({ _id: fileId, writerId, reviewerId, pdNumber: "04", category: "final_pd", fiscalYear: 2024 });
  });

  it("Edit details keeps an Import category but never files a file into one by hand", async () => {
    const s = await setup();
    const handFile = await addFile(s, "notes.txt", "Hand notes.");
    const finalPd = await addFile(s, "final-2024.docx", "Final PD.", { category: "final_pd", fiscalYear: 2024 });
    const refused = await errorOf(() =>
      s.authed.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: handFile, category: "final_pd", fiscalYear: 2024 })
    );
    expect(refused.code).toBe("INVALID_INPUT");
    await s.authed.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: finalPd, category: "final_pd", fiscalYear: 2023 });
    expect(await s.t.run(async (ctx) => ctx.db.get(finalPd))).toMatchObject({ category: "final_pd", fiscalYear: 2023 });
    // The company page lists it with its category.
    const listed = await s.authed.query(api.companyFiles.listCompanyFiles, { clientId: s.clientId });
    expect(listed.files.find((file) => file._id === finalPd)?.category).toBe("final_pd");
  });
});

describe("the final PDs a draft pins (pure rule)", () => {
  type Row = Parameters<typeof pinnedFinalPdsOfYear>[0][number];
  let next = 0;
  const row = (fileName: string, extra: Partial<Row> = {}): Row => {
    next += 1;
    return {
      _id: `id-${String(next).padStart(3, "0")}` as Id<"companyFiles">,
      _creationTime: next,
      archived: undefined,
      hasText: true,
      textLength: 10_000,
      category: "final_pd",
      fiscalYear: 2024,
      pdNumber: undefined,
      fileName,
      labels: undefined,
      ...extra,
    };
  };
  const subject = { fiscalYear: 2025, projectNumber: "4", titles: ["Cryogenic seal"] };

  it("keeps two a year: a matching PD number first, then shared title words, then the newest", () => {
    const older = row("01 Quillmere 2024 T1.OV.PN Pump housing.docx");
    const titled = row("02 Quillmere 2024 T1.OV.PN Cryogenic seal trials.docx");
    const newest = row("03 Quillmere 2024 T1.OV.PN Valve body.docx");
    const numbered = row("04 Quillmere 2024 T1.OV.PN Pump casing.docx", { pdNumber: "04" });
    const picked = pinnedFinalPdsOfYear([older, titled, newest, numbered], 2024, subject);
    expect(picked.map((file) => file.fileName)).toEqual([numbered.fileName, titled.fileName]);
    // Ties on number and title: the newest added.
    expect(pinnedFinalPdsOfYear([older, newest], 2024, { fiscalYear: 2025, titles: [] }).map((file) => file.fileName)).toEqual([
      newest.fileName,
      older.fileName,
    ]);
  });

  it("never pins an archived, empty, other-year or non-final file", () => {
    const rows = [
      row("archived.docx", { archived: true }),
      row("empty.docx", { hasText: false }),
      row("other-year.docx", { fiscalYear: 2023 }),
      row("draft.docx", { category: "draft" }),
      row("kept.docx"),
    ];
    expect(pinnedFinalPdsOfYear(rows, 2024, subject).map((file) => file.fileName)).toEqual(["kept.docx"]);
  });

  it("shares 32,000 characters fairly, a shorter PD leaving its share to the others", () => {
    expect(fairShares([20_000, 20_000, 20_000, 20_000], PINNED_FINAL_PD_CHARS)).toEqual([8_000, 8_000, 8_000, 8_000]);
    expect(fairShares([2_000, 20_000, 20_000, 20_000], PINNED_FINAL_PD_CHARS)).toEqual([2_000, 10_000, 10_000, 10_000]);
    expect(fairShares([5_000, 9_000], PINNED_FINAL_PD_CHARS)).toEqual([5_000, 9_000]);
    expect(fairShares([], PINNED_FINAL_PD_CHARS)).toEqual([]);
  });

  it("keeps the files added by hand exactly as before, and puts the pinned on top in places of their own", () => {
    const pinned2024 = [row("a-2024.docx", { textLength: 20_000 }), row("b-2024.docx", { textLength: 20_000 })];
    const pinned2023 = [row("a-2023.docx", { fiscalYear: 2023, textLength: 20_000 }), row("b-2023.docx", { fiscalYear: 2023, textLength: 20_000 })];
    const hand = Array.from({ length: 12 }, (_, index) => row(`hand-${index}.txt`, { category: "background", fiscalYear: undefined, textLength: 5_000 }));
    const plan = planDraftCompanyFiles({
      finalPdsByYear: [
        { year: 2024, rows: pinned2024 },
        { year: 2023, rows: pinned2023 },
      ],
      handNewestFirst: hand,
      subject,
    });
    // The hand-added ones first, all 12 places, whole, as before.
    expect(plan.slice(0, FROZEN_COMPANY_FILES).map((item) => [item.file.fileName, item.limit, item.pinned])).toEqual(
      hand.map((file) => [file.fileName, 5_000, false])
    );
    // Then the pinned, in 4 places of their own, sharing 32,000 characters.
    expect(plan.slice(FROZEN_COMPANY_FILES).map((item) => [item.file.fileName, item.limit, item.pinned])).toEqual([
      ["b-2024.docx", 8_000, true],
      ["a-2024.docx", 8_000, true],
      ["b-2023.docx", 8_000, true],
      ["a-2023.docx", 8_000, true],
    ]);
    expect(plan).toHaveLength(FROZEN_COMPANY_FILES + PINNED_FINAL_PDS);
    expect(PINNED_FINAL_PD_CHARS).toBeLessThanOrEqual(COMPANY_HISTORY_CHARS);
  });

  it("lets the hand-added files keep the old 600,000 first and fits the pinned into what is left", () => {
    const pinned = [row("a-2024.docx", { textLength: 20_000 }), row("b-2024.docx", { textLength: 20_000 })];
    const big = (name: string, textLength: number) => row(name, { category: "background", fiscalYear: undefined, textLength });
    const plan = (hand: Row[]) =>
      planDraftCompanyFiles({ finalPdsByYear: [{ year: 2024, rows: pinned }], handNewestFirst: hand, subject }).map((item) => [
        item.file.fileName,
        item.limit,
      ]);
    // 590,000 of 600,000 taken by hand: 10,000 left for the pinned.
    expect(plan([big("h1", 200_000), big("h2", 200_000), big("h3", 190_000)])).toEqual([
      ["h1", 200_000],
      ["h2", 200_000],
      ["h3", 190_000],
      ["b-2024.docx", 5_000],
      ["a-2024.docx", 5_000],
    ]);
    // All 600,000 taken: nothing pinned.
    expect(plan([big("h1", 250_000), big("h2", 250_000), big("h3", 250_000)])).toEqual([
      ["h1", 200_000],
      ["h2", 200_000],
      ["h3", 200_000],
    ]);
    expect(FROZEN_COMPANY_CHARS).toBe(600_000);
  });
});

describe("what a draft freezes from a company's history", () => {
  it("reads the hand-added files as before, then pins the final PDs of the two years before, and never the rest of the history", async () => {
    const s = await setup();
    await addFile(s, "website.txt", "Quillmere builds cryogenic pumps.", { category: "background" });
    await addFile(s, "final-2022.docx", "Final PD 2022.", { category: "final_pd", fiscalYear: 2022 });
    await addFile(s, "final-2023.docx", "Final PD 2023.", { category: "final_pd", fiscalYear: 2023 });
    await addFile(s, "final-2024-a.docx", "Final PD 2024, pump housing.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "final-2024-b.docx", "Final PD 2024, valve body.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "final-2024-c.docx", "Final PD 2024, third one.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "final-2025.docx", "This year's other final PD.", { category: "final_pd", fiscalYear: 2025 });
    await addFile(s, "final-no-year.docx", "A final PD with no year.", { category: "final_pd" });
    await addFile(s, "archived-2024.docx", "Archived final PD.", { category: "final_pd", fiscalYear: 2024, archived: true });
    for (const category of ["draft", "review_copy", "transcript", "supporting"] as const) {
      await addFile(s, `${category}-2024.docx`, `A ${category} of 2024.`, { category, fiscalYear: 2024 });
    }
    const rows = await companyRows(s, await start(s));
    expect(rows.map((row) => [row.label, row.fiscalYear ?? null])).toEqual([
      // The website file is added by hand: read first, as before.
      ["background:website.txt", null],
      // Three 2024 final PDs: the two newest (no number or title matches),
      // labelled with their year (the archived one never uses a place).
      ["background:final-2024-c.docx (FY 2024)", 2024],
      ["background:final-2024-b.docx (FY 2024)", 2024],
      ["background:final-2023.docx (FY 2023)", 2023],
    ]);
    // Each row traces to its file and stored text version.
    for (const row of rows) {
      expect(row.companyFileId).toBeDefined();
      expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("prefers the final PD whose number matches the project's when a year has several", async () => {
    const s = await setup({ projectNumber: "4" });
    await addFile(s, "04 Quillmere 2024 T1.OV.PN Housing.docx", "Matching PD.", { category: "final_pd", fiscalYear: 2024, pdNumber: "04" });
    await addFile(s, "07 Quillmere 2024 T1.OV.PN Gasket.docx", "Other PD.", { category: "final_pd", fiscalYear: 2024, pdNumber: "07" });
    await addFile(s, "09 Quillmere 2024 T1.OV.PN Flange.docx", "Newest PD.", { category: "final_pd", fiscalYear: 2024, pdNumber: "09" });
    const rows = await companyRows(s, await start(s));
    expect(rows.map((row) => row.label)).toEqual([
      "background:04 Quillmere 2024 T1.OV.PN Housing.docx (FY 2024)",
      "background:09 Quillmere 2024 T1.OV.PN Flange.docx (FY 2024)",
    ]);
  });

  it("caps the pinned at 32,000 characters on top of hand-added text read whole", async () => {
    const s = await setup();
    for (const year of [2024, 2023]) {
      for (const name of ["a", "b"]) await addFile(s, `final-${year}-${name}.docx`, "p".repeat(20_000), { category: "final_pd", fiscalYear: year });
    }
    await addFile(s, "background.txt", "b".repeat(50_000), { category: "background" });
    const rows = await companyRows(s, await start(s));
    expect(rows.map((row) => row.content.length)).toEqual([50_000, 8_000, 8_000, 8_000, 8_000]);
    expect(rows.map((row) => row.truncated)).toEqual([false, true, true, true, true]);
  });

  it("a project with no fiscal year pins nothing, and its hand-added files read as before", async () => {
    const s = await setup({ fiscalYear: null });
    await addFile(s, "final-2024.docx", "Final PD 2024.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "notes.txt", "Hand notes.", { category: "background" });
    const rows = await companyRows(s, await start(s));
    expect(rows.map((row) => row.label)).toEqual(["background:notes.txt"]);
  });

  it("200 imported files never crowd out the files added by hand, and the reads stay bounded", async () => {
    const s = await setup();
    const hand: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      await addFile(s, `hand-${index}.txt`, `Hand file ${index}.`);
      hand.push(`other:hand-${index}.txt`);
    }
    const categories = ["draft", "review_copy", "transcript", "supporting", "final_pd"] as const;
    for (let index = 0; index < 200; index += 1) {
      const category = categories[index % categories.length]!;
      await addFile(s, `import-${index}.docx`, `Imported ${category} ${index}.`, { category, fiscalYear: 2013 + (index % 12) });
    }
    let reads = 0;
    const chosen = await s.t.run(async (ctx) =>
      draftCompanyFiles(ctx, s.clientId, { fiscalYear: 2025, titles: [] }, { read: () => (reads += 1) })
    );
    // Hand files newest first after the pinned 2024 and 2023 final PDs.
    expect(chosen.filter((item) => !item.pinned).map((item) => item.file.fileName)).toEqual(["hand-2.txt", "hand-1.txt", "hand-0.txt"]);
    expect(chosen.filter((item) => item.pinned).every((item) => item.file.category === "final_pd")).toBe(true);
    expect(chosen.filter((item) => item.pinned).map((item) => item.file.fiscalYear)).toEqual([2024, 2024, 2023, 2023]);
    // Final PD rows of two years and the hand-added rows, not the 200.
    expect(reads).toBeLessThan(40);
    const rows = await companyRows(s, await start(s));
    expect(rows.filter((row) => !row.label.startsWith("background:import-")).map((row) => row.label)).toEqual(hand.reverse());
  });

  it("the start dialog lists exactly what a draft would read, the pinned after the hand-added files", async () => {
    const s = await setup();
    await addFile(s, "notes.txt", "Hand notes.");
    await addFile(s, "final-2024.docx", "Final PD 2024.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "draft-2024.docx", "Draft 2024.", { category: "draft", fiscalYear: 2024 });
    const listed = await s.authed.query(api.companyFiles.listForProject, { projectId: s.projectId });
    expect(listed.files.map((file) => [file.fileName, file.category])).toEqual([
      ["notes.txt", null],
      ["final-2024.docx", "final_pd"],
    ]);
    const evidence = await s.t.run(async (ctx) => selectFrozenEvidence(ctx, s.projectId));
    expect(evidence.frozenCompanyFiles.map((item) => item.file.fileName)).toEqual(["notes.txt", "final-2024.docx"]);
  });
});

describe("an imported final PD never counts as the project's previous-year report (decision 42)", () => {
  it("a draft reading last year's final PD still has no previous-year material", async () => {
    const s = await setup();
    await addFile(s, "final-2024.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s);
    const rows = await companyRows(s, generationId);
    expect(rows.map((row) => row.label)).toEqual(["background:final-2024.docx (FY 2024)"]);
    expect((await s.t.run(async (ctx) => ctx.db.get(generationId)))?.previousYearMaterial).toBe(false);
  });

  it("a project whose only evidence is an imported final PD is refused", async () => {
    const s = await setup({ transcript: false });
    await addFile(s, "final-2024.docx", "Last year's final PD, with plenty of detail.", { category: "final_pd", fiscalYear: 2024 });
    expect((await errorOf(() => start(s))).code).toBe("INVALID_INPUT");
  });

  it("next to last year's report, an imported final PD is still not this year's source", async () => {
    const s = await setup({ transcript: false });
    await s.t.run(async (ctx) =>
      ctx.db.insert("projectDocuments", {
        projectId: s.projectId, fileName: "fy2024-report.pdf", fileType: "txt", content: "Last year's report.", category: "previous_pd",
        source: "upload", uploadedBy: s.userId, uploaderRole: "writer", createdAt: Date.now(),
      })
    );
    await addFile(s, "final-2024.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    expect(await errorOf(() => start(s))).toEqual({ code: "INVALID_INPUT", reason: PREVIOUS_YEAR_ONLY_REASON });
  });
});

describe("version families in a company search", () => {
  it("groups a final PD with its drafts and review copies by fiscal year and PD number", () => {
    expect(pdNumberKey(" 04 ")).toBe("4");
    expect(pdNumberKey("t2")).toBe("T2");
    expect(pdNumberKey(undefined)).toBeNull();
    const family = (category: Category, extra: { fiscalYear?: number; pdNumber?: string } = {}) =>
      versionFamily({ _id: `${category}-id`, category, fiscalYear: extra.fiscalYear ?? 2024, pdNumber: extra.pdNumber ?? "04" });
    expect(family("final_pd")).toBe("pd:2024:4");
    expect(family("draft", { pdNumber: "4" })).toBe("pd:2024:4");
    expect(family("review_copy")).toBe("pd:2024:4");
    expect(family("final_pd", { fiscalYear: 2023 })).toBe("pd:2023:4");
    expect(family("transcript")).toBe("file:transcript-id");
    expect(versionFamily({ _id: "x", category: "final_pd", fiscalYear: 2024 })).toBe("file:x");
  });

  it("keeps two hits a family, the final PD's first in the family's best place, and a file of its own up to its own cap", () => {
    const hits = [
      { id: "draft-1", family: "pd:2024:4", final: false },
      { id: "review-1", family: "pd:2024:4", final: false },
      { id: "solo-1", family: "file:a", final: false },
      { id: "final-1", family: "pd:2024:4", final: true },
      { id: "solo-2", family: "file:a", final: false },
      { id: "solo-3", family: "file:a", final: false },
    ];
    // The family keeps the places its best-ranked hits held (0 and 1), its final first.
    expect(collapseVersionFamilies(hits, 3).map((hit) => hit.id)).toEqual(["final-1", "draft-1", "solo-1", "solo-2", "solo-3"]);
  });

  it("with one place left, a family's final PD survives the cut, not a better-ranked draft (review, 2026-11-17)", () => {
    const hits = [
      { id: "solo-1", family: "file:a", final: false },
      { id: "draft-1", family: "pd:2024:4", final: false },
      { id: "final-1", family: "pd:2024:4", final: true },
    ];
    expect(collapseVersionFamilies(hits, 2).slice(0, 2).map((hit) => hit.id)).toEqual(["solo-1", "final-1"]);
    expect(collapseVersionFamilies(hits.slice(1), 2).slice(0, 1).map((hit) => hit.id)).toEqual(["final-1"]);
  });

  it("chat search returns at most two excerpts of one PD's versions, its final first", async () => {
    const s = await setup({ chat: true });
    const word = "zirconia";
    await addFile(s, "final.docx", `Final: the ${word} liner held.`, { category: "final_pd", fiscalYear: 2024, pdNumber: "04", pieces: true });
    for (const name of ["draft-1", "draft-2", "draft-3"]) {
      await addFile(s, `${name}.docx`, `Draft: the ${word} liner held.`, { category: "draft", fiscalYear: 2024, pdNumber: "4", pieces: true });
    }
    await addFile(s, "review.docx", `Review: the ${word} liner held.`, { category: "review_copy", fiscalYear: 2024, pdNumber: "04", pieces: true });
    const found = await s.t.query(internal.chatDocuments.searchForChat, {
      agentThreadId: "thread-history", query: `${word} liner`, maxChars: 20_000, userId: s.userId,
    });
    if (found.status !== "ok") throw new Error(found.status);
    const company = found.excerpts.filter((excerpt) => excerpt.kind === "company");
    expect(company).toHaveLength(2);
    expect(company.map((excerpt) => excerpt.kind === "company" && excerpt.fileName)).toContain("final.docx");
  });
});

describe("the company files a chat turn lists and searches, with 200 files", () => {
  async function bigCompany() {
    const s = await setup({ chat: true });
    // 20 files added by hand.
    const hand: Id<"companyFiles">[] = [];
    for (let index = 0; index < 20; index += 1) hand.push(await addFile(s, `hand-${index}.txt`, `Hand note ${index}.`));
    // 180 imported files over ten years: 30 final PDs and 150 others.
    const categories = ["draft", "review_copy", "transcript", "supporting", "draft"] as const;
    for (let index = 0; index < 30; index += 1) {
      await addFile(s, `final-${index}.docx`, `Final PD ${index}.`, { category: "final_pd", fiscalYear: 2015 + (index % 10) });
    }
    let oldTranscript: Id<"companyFiles"> | null = null;
    for (let index = 0; index < 150; index += 1) {
      const category = categories[index % categories.length]!;
      const text = index === 3 ? "Wendt said the beryllium bushing cracked at minus 150." : `Imported ${category} ${index}.`;
      const id = await addFile(s, `import-${index}.docx`, text, { category, fiscalYear: 2015 + (index % 10), pieces: index === 3 });
      if (index === 3) oldTranscript = id;
    }
    return { s, hand, oldTranscript: oldTranscript! };
  }

  it("lists the pinned and newest final PDs, then the files added by hand, at most 30", async () => {
    const { s, hand } = await bigCompany();
    const listed = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId));
    expect(listed).toHaveLength(MAX_CHAT_COMPANY_FILES);
    const finals = listed.slice(0, CHAT_LISTED_FINAL_PDS);
    expect(finals.every((file) => file.filedAs?.startsWith("final PD, FY "))).toBe(true);
    // The pinned years first: 2024, then 2023.
    expect(finals.slice(0, 4).map((file) => file.filedAs)).toEqual([
      "final PD, FY 2024",
      "final PD, FY 2024",
      "final PD, FY 2023",
      "final PD, FY 2023",
    ]);
    // Then the hand-added files, oldest first, with no "filed as".
    const rest = listed.slice(CHAT_LISTED_FINAL_PDS);
    expect(rest.map((file) => file.companyFileId)).toEqual(hand);
    expect(rest.every((file) => file.filedAs === undefined)).toBe(true);
  });

  it("search finds an old file that is not listed, gives it the next handle, and readDocument opens it by that handle", async () => {
    const { s, oldTranscript } = await bigCompany();
    const listed = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId));
    expect(listed.map((file) => file.companyFileId)).not.toContain(oldTranscript);
    const found = await s.t.query(internal.chatDocuments.searchForChat, {
      agentThreadId: "thread-history", query: "beryllium bushing", maxChars: 20_000, userId: s.userId,
    });
    if (found.status !== "ok") throw new Error(found.status);
    expect(found.excerpts).toEqual([expect.objectContaining({ kind: "company", companyFileId: oldTranscript, fileName: "import-3.docx" })]);

    // Through the tools: the excerpt is placed by its name, and readDocument then opens it.
    const turn = newDocumentReadTurn({ documents: [], transcripts: [], companyFiles: listed }, s.userId);
    const ctx = {
      threadId: "thread-history",
      runQuery: (async (ref: unknown, args: Record<string, unknown>) => {
        void ref;
        return "companyFileId" in args
          ? await s.t.query(internal.chatDocuments.readCompanyFileForChat, args as never)
          : await s.t.query(internal.chatDocuments.searchForChat, args as never);
      }) as never,
    };
    const receipt = await runSearchDocuments(ctx, { query: "beryllium bushing" }, { toolCallId: "call-1" }, turn);
    expect(receipt).toContain("C31 part 1");
    // The excerpt says how Import filed it, as the list does.
    expect(String(turn.opened.get("call-1"))).toContain("company file import-3.docx, filed as supporting file, FY 2018");
    const opened = await runReadDocument(ctx, { file: "C31" }, { toolCallId: "call-2" }, turn);
    expect(opened).toContain("Opened company file");
    expect(String(turn.opened.get("call-2"))).toContain("beryllium bushing");
  });

  it("a company with no Import files lists exactly as before: its newest 30, oldest first", async () => {
    const s = await setup({ chat: true });
    const ids: Id<"companyFiles">[] = [];
    for (let index = 0; index < 35; index += 1) ids.push(await addFile(s, `hand-${index}.txt`, `Hand note ${index}.`));
    const listed = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId));
    expect(listed.map((file) => file.companyFileId)).toEqual(ids.slice(5));
    expect(listed.every((file) => file.filedAs === undefined)).toBe(true);
  });
});

describe("handles for company files a search found (review, 2026-11-17)", () => {
  const listed = [{ companyFileId: "cf-listed" as Id<"companyFiles">, fileName: "notes.txt", textLength: 900 }];
  /** A turn whose search finds `found`, and whose company reads say which file they opened. */
  function turnWith(found: Array<{ id: string; fileName: string }>, documents: Array<{ fileName: string }> = []) {
    const turn = newDocumentReadTurn(
      {
        documents: documents.map((doc, index) => ({
          documentId: `doc-${index}` as Id<"projectDocuments">,
          fileName: doc.fileName,
          content: "Project text.",
          textLength: 13,
        })),
        transcripts: [],
        companyFiles: listed,
      },
      "user-1" as Id<"users">
    );
    const reads: string[] = [];
    const ctx = {
      threadId: "thread-history",
      runQuery: (async (_ref: unknown, args: Record<string, unknown>) => {
        if ("companyFileId" in args) {
          reads.push(String(args.companyFileId));
          return { status: "ok", fileName: "x", totalChars: 10, start: 0, end: 10, text: `Text of ${String(args.companyFileId)}.` };
        }
        if ("documentId" in args) {
          reads.push(String(args.documentId));
          return { status: "ok", fileName: "x", totalChars: 10, start: 0, end: 10, text: "Project text." };
        }
        return {
          status: "ok",
          complete: true,
          excerpts: found.map((file) => ({ kind: "company", companyFileId: file.id, fileName: file.fileName, start: 0, text: "A match." })),
        };
      }) as never,
    };
    return { turn, ctx, reads };
  }

  it("a found file with a project file's name opens by its handle, not the project file", async () => {
    const { turn, ctx, reads } = turnWith([{ id: "cf-old", fileName: "plan.docx" }], [{ fileName: "plan.docx" }]);
    expect(await runSearchDocuments(ctx, { query: "match" }, { toolCallId: "s" }, turn)).toContain("C2 part 1");
    await runReadDocument(ctx, { file: "C2" }, { toolCallId: "r" }, turn);
    expect(reads).toEqual(["cf-old"]);
  });

  it("a found file with a listed company file's name gets its own handle, and the name asks which", async () => {
    const { turn, ctx, reads } = turnWith([{ id: "cf-old", fileName: "notes.txt" }]);
    expect(await runSearchDocuments(ctx, { query: "match" }, { toolCallId: "s" }, turn)).toContain("C2 part 1");
    expect(await runReadDocument(ctx, { file: "notes.txt" }, { toolCallId: "r1" }, turn)).toContain("C1, C2");
    await runReadDocument(ctx, { file: "C2" }, { toolCallId: "r2" }, turn);
    await runReadDocument(ctx, { file: "C1" }, { toolCallId: "r3" }, turn);
    expect(reads).toEqual(["cf-old", "cf-listed"]);
  });

  it("two found files of one name each get a handle and each opens", async () => {
    const { turn, ctx, reads } = turnWith([
      { id: "cf-a", fileName: "report.docx" },
      { id: "cf-b", fileName: "report.docx" },
    ]);
    const receipt = await runSearchDocuments(ctx, { query: "match" }, { toolCallId: "s" }, turn);
    expect(receipt).toContain("C2 part 1");
    expect(receipt).toContain("C3 part 1");
    await runReadDocument(ctx, { file: "C3" }, { toolCallId: "r1" }, turn);
    await runReadDocument(ctx, { file: "C2" }, { toolCallId: "r2" }, turn);
    expect(reads).toEqual(["cf-b", "cf-a"]);
  });
});

describe("review fixes (2026-11-17)", () => {
  it("an archived final PD never uses up a year's places", async () => {
    const s = await setup();
    // 45 archived final PDs of the year around the one kept: the 20 newest
    // rows the draft reads are all not archived.
    for (let index = 0; index < 25; index += 1) {
      await addFile(s, `archived-${index}.docx`, "Archived.", { category: "final_pd", fiscalYear: 2024, archived: true });
    }
    const kept = await addFile(s, "kept.docx", "Kept final PD.", { category: "final_pd", fiscalYear: 2024 });
    for (let index = 25; index < 45; index += 1) {
      await addFile(s, `archived-${index}.docx`, "Archived.", { category: "final_pd", fiscalYear: 2024, archived: true });
    }
    const chosen = await s.t.run(async (ctx) => draftCompanyFiles(ctx, s.clientId, { fiscalYear: 2025, titles: [] }));
    expect(chosen.map((item) => item.file._id)).toEqual([kept]);
  });

  it("Edit details gives an Import file back the category Import approved it under", async () => {
    const s = await setup();
    const { fileId, otherId } = await s.t.run(async (ctx) => {
      const now = Date.now();
      const itemId = await ctx.db.insert("ingestionItems", {
        driveItemId: "drive-2", path: "Quillmere Pumps/2024/final.docx", name: "final.docx", docKind: "pd", size: 10,
        lastModifiedAt: now, contentHash: "hash-2", status: "approved", pairGroupKey: "quillmere pumps::2024", updatedAt: now,
        category: "final_pd",
      });
      const facts = await companyFileTextFacts("Final PD text.");
      const base = { clientId: s.clientId, fileType: "docx" as const, ...facts, processingStatus: "ready" as const, uploadedBy: s.userId, createdAt: now };
      const fileId = await ctx.db.insert("companyFiles", { ...base, fileName: "final.docx", category: "background", fiscalYear: 2024, importItemId: itemId });
      const otherId = await ctx.db.insert("companyFiles", { ...base, fileName: "other.docx", category: "background", importItemId: itemId });
      return { fileId, otherId };
    });
    const listed = await s.authed.query(api.companyFiles.listCompanyFiles, { clientId: s.clientId });
    expect(listed.files.find((file) => file._id === fileId)?.importCategory).toBe("final_pd");
    await s.authed.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: fileId, category: "final_pd", fiscalYear: 2024 });
    expect((await s.t.run(async (ctx) => ctx.db.get(fileId)))?.category).toBe("final_pd");
    // Not another Import category than its Import file's.
    const refused = await errorOf(() =>
      s.authed.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: otherId, category: "draft", fiscalYear: null })
    );
    expect(refused.code).toBe("INVALID_INPUT");
  });

  it("a hand-added file's label has no year, even with one", async () => {
    const s = await setup();
    await addFile(s, "notes-2024.txt", "Hand notes.", { category: "background", fiscalYear: 2024 });
    const rows = await companyRows(s, await start(s));
    expect(rows.map((row) => [row.label, row.fiscalYear])).toEqual([["background:notes-2024.txt", 2024]]);
  });

  it("a company search that stops at its scan bound with fewer hits than asked is not complete", async () => {
    const s = await setup();
    // 40 versions of one PD: the search reads its 32 matches (8 a place
    // asked), then collapses them to 2. Since 2026-11-19 it reads the whole
    // bounded scan, so only the scan bound leaves it not complete.
    for (let index = 0; index < 40; index += 1) {
      await addFile(s, `draft-${index}.docx`, "The cobalt seat held.", { category: "draft", fiscalYear: 2024, pdNumber: "04", pieces: true });
    }
    const found = await s.t.run(async (ctx) => searchCompanyPieces(ctx, { clientId: s.clientId, query: "cobalt seat", limit: 4, perFile: 1 }));
    expect(found.hits).toHaveLength(2);
    expect(found.complete).toBe(false);
    // A search that read every match is complete.
    const all = await s.t.run(async (ctx) => searchCompanyPieces(ctx, { clientId: s.clientId, query: "cobalt seat", limit: 50, perFile: 1 }));
    expect(all.hits).toHaveLength(2);
    expect(all.complete).toBe(true);
  });
});

describe("review fixes, round 2 (2026-11-17)", () => {
  it("a company search with one place left returns the final PD, not the draft found before it", async () => {
    const s = await setup();
    // Search returns matches in the order they were cut: the draft first.
    await addFile(s, "draft.docx", "The tungsten gland held.", { category: "draft", fiscalYear: 2024, pdNumber: "4", pieces: true });
    const finalId = await addFile(s, "final.docx", "The tungsten gland held.", { category: "final_pd", fiscalYear: 2024, pdNumber: "04", pieces: true });
    const found = await s.t.run(async (ctx) => searchCompanyPieces(ctx, { clientId: s.clientId, query: "tungsten gland", limit: 1, perFile: 2 }));
    expect(found.hits.map((hit) => hit.companyFileId)).toEqual([finalId]);
  });

  it("a company search with one place left still finds a final PD after three of its drafts (2026-11-19)", async () => {
    const s = await setup();
    // Three drafts cut before the final PD: they once filled the 3 hits a
    // place gathered, so the final PD was never checked.
    for (let index = 0; index < 3; index += 1) {
      await addFile(s, `draft-${index}.docx`, "The tungsten gland held.", { category: "draft", fiscalYear: 2024, pdNumber: "04", pieces: true });
    }
    const finalId = await addFile(s, "final.docx", "The tungsten gland held.", { category: "final_pd", fiscalYear: 2024, pdNumber: "04", pieces: true });
    const found = await s.t.run(async (ctx) => searchCompanyPieces(ctx, { clientId: s.clientId, query: "tungsten gland", limit: 1, perFile: 2 }));
    expect(found.hits.map((hit) => hit.companyFileId)).toEqual([finalId]);
    expect(found.complete).toBe(true);
  });

  it("many final PDs without text never make the chat list read the whole range", async () => {
    const s = await setup({ chat: true });
    const readable = await addFile(s, "old-final.docx", "Final PD of 2015.", { category: "final_pd", fiscalYear: 2015 });
    // 200 newer final PDs without text, none in the pinned years (2024, 2023).
    for (let index = 0; index < 200; index += 1) {
      await addFile(s, `empty-${index}.docx`, "", { category: "final_pd", fiscalYear: 2016 + (index % 7) });
    }
    let finalRows = 0;
    let rows = 0;
    const listed = await s.t.run(async (ctx) =>
      chatCompanyFilesFor(ctx, s.projectId, s.userId, {
        read: (row) => {
          rows += 1;
          if ((row as Doc<"companyFiles">).category === "final_pd") finalRows += 1;
        },
      })
    );
    expect(listed.map((file) => file.companyFileId)).not.toContain(readable);
    // The final PD walk stops after CHAT_FINAL_PD_ROWS_READ rows; the Import
    // walk after it reads its own bound (its room, 30, plus 10), as before.
    expect(finalRows).toBe(CHAT_FINAL_PD_ROWS_READ + MAX_CHAT_COMPANY_FILES + CHAT_LISTED_FINAL_PDS);
    expect(rows).toBe(finalRows);
  });

  it("the chat list asks the read budget before each row and ends with what it has once there is no room", async () => {
    const s = await setup({ chat: true });
    for (let index = 0; index < 12; index += 1) {
      await addFile(s, `final-${index}.docx`, `Final PD ${index}.`, { category: "final_pd", fiscalYear: 2015 + (index % 5) });
    }
    for (let index = 0; index < 10; index += 1) await addFile(s, `hand-${index}.txt`, `Hand note ${index}.`);
    let rows = 0;
    let asked = 0;
    const listed = await s.t.run(async (ctx) =>
      chatCompanyFilesFor(ctx, s.projectId, s.userId, {
        mayRead: () => {
          asked += 1;
          return rows < 5;
        },
        read: () => {
          rows += 1;
        },
      })
    );
    expect(rows).toBe(5);
    expect(asked).toBeGreaterThan(rows);
    expect(listed.length).toBeLessThanOrEqual(5);
  });

  it("search reaches an older readable file when the newest 60 hand-added files have no text and the turn lists none", async () => {
    const s = await setup({ chat: true });
    const old = await addFile(s, "old-notes.txt", "The hafnium spring relaxed overnight.", { pieces: true });
    for (let index = 0; index < 60; index += 1) await addFile(s, `scan-${index}.txt`, "");
    const listed = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId));
    expect(listed).toEqual([]);
    const turn = newDocumentReadTurn({ documents: [], transcripts: [], companyFiles: listed }, s.userId);
    const sent: Array<Record<string, unknown>> = [];
    const ctx = {
      threadId: "thread-history",
      runQuery: (async (ref: unknown, args: Record<string, unknown>) => {
        void ref;
        sent.push(args);
        return "companyFileId" in args
          ? await s.t.query(internal.chatDocuments.readCompanyFileForChat, args as never)
          : await s.t.query(internal.chatDocuments.searchForChat, args as never);
      }) as never,
    };
    const receipt = await runSearchDocuments(ctx, { query: "hafnium spring" }, { toolCallId: "call-1" }, turn);
    expect(sent[0]?.userId).toBe(s.userId);
    expect(receipt).toContain("C1 part 1");
    expect(turn.companyFiles.map((file) => file.companyFileId)).toEqual([old]);
    const opened = await runReadDocument(ctx, { file: "C1" }, { toolCallId: "call-2" }, turn);
    expect(opened).toContain("Opened company file");
  });
});

/// <reference types="vite/client" />
/**
 * 2026-11-17 (company history, docs/product-domain.md): company files ready
 * for ten years of approved Import files. A draft reads the files added by
 * hand exactly as before, then, on top, pins the final PDs of the two fiscal
 * years before its own within the history cap; the rest of the history is
 * search-only.
 * An imported final PD never counts as this year's source (decision 42);
 * since 2026-11-18 (third) last year's final PD linked to the project counts
 * as its previous-year report. Chat lists final PDs and hand-added files
 * first and searches every file of the company, with a PD's versions
 * collapsed.
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
  FROZEN_TOTAL_BYTES,
  PINNED_FINAL_PDS,
  PINNED_FINAL_PD_CHARS,
  PREVIOUS_YEAR_PD_CHARS,
  companyDraftSubject,
  companyFileCategory,
  companyFileLabel,
  draftCompanyFiles,
  fairShares,
  hasOwnPreviousYearReport,
  pinnedFinalPdsOfYear,
  planDraftCompanyFiles,
  PREVIOUS_YEAR_LINK_WORDS,
  OWN_REPORT_READ_BYTES,
  previousYearPdLink,
  previousYearPdOf,
  previousYearTitleWords,
  projectHasOwnPreviousYearReport,
  selectCompanyFilesOf,
  selectFrozenEvidence,
  type CompanyDraftSubject,
} from "./lib/briefEvidence";
import {
  COMPANY_HISTORY_CATEGORIES,
  collapseVersionFamilies,
  isCompanyHistoryCategory,
  pdNumberKey,
  versionFamily,
} from "./lib/companyEvidence";
import { isPreviousYearDocument, PREVIOUS_YEAR_ONLY_MESSAGE, PREVIOUS_YEAR_ONLY_REASON } from "../shared/previousYear";
import { buildTrustedContext } from "./ai/trustedContext";
import { BRIEF_DERIVATION_VERSION } from "./lib/briefDerivationPolicy";
import { briefInputsHash } from "./lib/briefInputsHash";
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
  it("every Import category reads as background or other without the previous-year mark (decision 42)", () => {
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
    // 2026-11-18 (third): the matching PD is also last year's report.
    expect(rows.map((row) => row.label)).toEqual([
      "previous_pd:04 Quillmere 2024 T1.OV.PN Housing.docx (FY 2024)",
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

describe("last year's imported final PD as the project's previous-year report: the link test (2026-11-18, third)", () => {
  type Row = Parameters<typeof previousYearPdLink>[0];
  let next = 0;
  const row = (fileName: string, extra: Partial<Row> = {}): Row => {
    next += 1;
    return {
      _id: `py-${String(next).padStart(3, "0")}` as Id<"companyFiles">,
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

  const housing = row("Pump housing.docx");
  const valve = row("Valve body.docx");
  const cases: Array<[string, Row, Row[], CompanyDraftSubject, ReturnType<typeof previousYearPdLink>]> = [
    ["the year's only final PD", housing, [housing], subject, "only_final_pd"],
    ["the only final PD, beside other years and other categories", housing, [housing, row("a.docx", { fiscalYear: 2023 }), row("b.docx", { category: "draft" })], subject, "only_final_pd"],
    ["the only final PD once an archived one is set aside", housing, [housing, row("old.docx", { archived: true })], subject, "only_final_pd"],
    ["two final PDs and no link", housing, [housing, valve], subject, null],
    ["another final PD of the year without text still makes it not the only one", housing, [housing, row("empty.docx", { hasText: false })], subject, null],
    ["its PD number matches, leading zeros aside", row("x.docx", { pdNumber: "004" }), [housing, valve], subject, "pd_number"],
    ["its PD number matches, case aside", row("x.docx", { pdNumber: "4a" }), [housing, valve], { ...subject, projectNumber: "4A" }, "pd_number"],
    ["another PD number and no shared word", row("x.docx", { pdNumber: "07" }), [housing, valve], subject, null],
    ["its name shares two meaningful title words", row("Cryogenic seal trials.docx"), [housing, valve], subject, "title_words"],
    ["its label title shares two meaningful title words", row("x.docx", { labels: { title: "Cryogenic seal testing" } as Row["labels"] }), [housing, valve], subject, "title_words"],
    ["one shared title word is not a link", row("Seal trials.docx"), [housing, valve], subject, null],
    ["generic SR&ED words are not a link (review)", row("Development of a scheduling engine.docx"), [housing], { ...subject, titles: ["Development of a cryogenic seal"] }, null],
    ["generic words never make up the two", row("Improved process design seal.docx"), [housing], { ...subject, titles: ["Improved process design for a seal"] }, null],
    ["the company's own name is not a link", row("Quillmere seal.docx"), [housing], { ...subject, titles: ["Quillmere seal"], companyNames: ["Quillmere Pumps"] }, null],
    ["years, PD numbers, initials and the extension are not a link", row("04 Quillmere 2024 T1.OV.PN Seal.docx"), [housing], { ...subject, projectNumber: "9", titles: ["Seal 2024 T1.OV.PN docx"] }, null],
    ["two meaningful words beside the Import name parts link", row("04 Quillmere 2024 T1.OV.PN Seal housing.docx"), [housing], { ...subject, projectNumber: "9", titles: ["Seal housing 2024"], companyNames: ["Quillmere Pumps"] }, "title_words"],
    ["the project's own fiscal year", row("x.docx", { fiscalYear: 2025 }), [], subject, null],
    ["two years back", row("x.docx", { fiscalYear: 2023 }), [], subject, null],
    ["a final PD with no fiscal year", row("x.docx", { fiscalYear: undefined }), [], subject, null],
    ["an archived final PD", row("x.docx", { archived: true, pdNumber: "4" }), [], subject, null],
    ["a draft, not a final PD", row("x.docx", { category: "draft", pdNumber: "4" }), [], subject, null],
    ["a project with no fiscal year", housing, [housing], { fiscalYear: null, titles: ["Cryogenic seal"] }, null],
  ];
  it.each(cases)("%s", (_name, file, yearRows, forSubject, expected) => {
    expect(previousYearPdLink(file, yearRows.includes(file) ? yearRows : [file, ...yearRows], forSubject)).toBe(expected);
  });

  it("names the meaningful words a title link shares, and keeps the pin rule's looser count for pinning", () => {
    expect(
      previousYearTitleWords(row("04 Quillmere 2024 T1.OV.PN Cryogenic seal housing v2.docx"), {
        ...subject,
        titles: ["Development of a cryogenic seal housing"],
        companyNames: ["Quillmere Pumps"],
      })
    ).toEqual(["cryogenic", "housing", "seal"]);
    // Pinning is unchanged: one shared word still ranks a PD above the newest.
    const oneWord = row("Seal trials.docx");
    const newest = row("Valve body.docx");
    expect(pinnedFinalPdsOfYear([oneWord, newest], 2024, subject)[0]).toBe(oneWord);
    expect(PREVIOUS_YEAR_LINK_WORDS).toBe(2);
  });

  it("a read stopped early never makes a PD the year's only one; a number or title link still holds", () => {
    expect(previousYearPdLink(housing, [housing], subject, false)).toBeNull();
    expect(previousYearPdLink(row("x.docx", { pdNumber: "4" }), [], subject, false)).toBe("pd_number");
    expect(previousYearPdLink(row("Cryogenic seal.docx"), [], subject, false)).toBe("title_words");
    expect(previousYearPdOf([housing], [housing], subject, false, false)).toBeNull();
  });

  it("picks the first linked PD in pin order, none with the project's own report, and none when none is linked", () => {
    const numbered = row("x.docx", { pdNumber: "4" });
    const titled = row("Cryogenic seal trials.docx");
    expect(previousYearPdOf([numbered, titled], [numbered, titled, housing], subject, false)).toBe(numbered);
    expect(previousYearPdOf([valve, titled], [valve, titled, housing], subject, false)).toBe(titled);
    expect(previousYearPdOf([numbered, titled], [numbered, titled], subject, true)).toBeNull();
    expect(previousYearPdOf([housing, valve], [housing, valve], subject, false)).toBeNull();
  });

  it("the project's own previous-year file is one a draft could read: not archived, with text, among its first 50 file rows", () => {
    const document = (category: string | undefined, extra: Record<string, unknown> = {}) =>
      ({ category, archived: undefined, content: "Last year's report.", ...extra }) as unknown as Parameters<typeof hasOwnPreviousYearReport>[0][number];
    expect(hasOwnPreviousYearReport([document("other"), document("previous_pd")])).toBe(true);
    expect(hasOwnPreviousYearReport([document("previous_pd", { archived: true })])).toBe(false);
    expect(hasOwnPreviousYearReport([document("previous_pd", { content: "" })])).toBe(false);
    expect(hasOwnPreviousYearReport([document("background")])).toBe(false);
    expect(hasOwnPreviousYearReport([...Array.from({ length: 50 }, () => document("other")), document("previous_pd")])).toBe(false);
  });

  it("a counting PD reads as previous_pd with its year; the mark never turns another category into one", () => {
    expect(companyFileCategory("final_pd", true)).toBe("previous_pd");
    expect(companyFileCategory("draft", true)).toBe("other");
    expect(companyFileCategory("previous_pd", true)).toBe("background");
    expect(companyFileLabel({ category: "final_pd", fileName: "Pump PD.docx", fiscalYear: 2024 }, true)).toBe("previous_pd:Pump PD.docx (FY 2024)");
    expect(companyFileLabel({ category: "final_pd", fileName: "Pump PD.docx", fiscalYear: 2024 })).toBe("background:Pump PD.docx (FY 2024)");
  });

  it("a counting PD takes its share first, up to 16,000 characters, and the other pinned PDs share the rest of 32,000", () => {
    const counting = row("Cryogenic seal trials.docx", { textLength: 20_000 });
    const other2024 = row("Valve body.docx", { textLength: 20_000 });
    const pinned2023 = [row("a-2023.docx", { fiscalYear: 2023, textLength: 20_000 }), row("b-2023.docx", { fiscalYear: 2023, textLength: 20_000 })];
    const plan = (ownPreviousYearReport: boolean, rows2024 = [counting, other2024], hand: Row[] = []) =>
      planDraftCompanyFiles({
        finalPdsByYear: [
          { year: 2024, rows: rows2024 },
          { year: 2023, rows: pinned2023 },
        ],
        handNewestFirst: hand,
        subject,
        ownPreviousYearReport,
      }).map((item) => [item.file.fileName, item.limit, item.previousYear]);
    const shared = plan(false);
    expect(shared).toEqual([
      ["Cryogenic seal trials.docx", PREVIOUS_YEAR_PD_CHARS, true],
      ["Valve body.docx", 5_333, false],
      ["b-2023.docx", 5_333, false],
      ["a-2023.docx", 5_334, false],
    ]);
    expect(shared.reduce((sum, item) => sum + (item[1] as number), 0)).toBe(PINNED_FINAL_PD_CHARS);
    // A shorter counting PD leaves the rest to the others.
    const short = row("Cryogenic seal trials.docx", { textLength: 5_000 });
    expect(plan(false, [short, other2024]).map((item) => item[1])).toEqual([5_000, 9_000, 9_000, 9_000]);
    // With the project's own report, nothing is marked and all share fairly.
    expect(plan(true)).toEqual([
      ["Cryogenic seal trials.docx", 8_000, false],
      ["Valve body.docx", 8_000, false],
      ["b-2023.docx", 8_000, false],
      ["a-2023.docx", 8_000, false],
    ]);
    // Only 10,000 left by the hand-added files: the counting PD takes it all.
    const big = (name: string, textLength: number) => row(name, { category: "background", fiscalYear: undefined, textLength });
    expect(plan(false, [counting, other2024], [big("h1", 200_000), big("h2", 200_000), big("h3", 190_000)]).slice(3)).toEqual([
      ["Cryogenic seal trials.docx", 10_000, true],
    ]);
    // No link: fair shares as before.
    expect(plan(false, [housing, valve]).map((item) => [item[1], item[2]])).toEqual([
      [8_000, false],
      [8_000, false],
      [8_000, false],
      [8_000, false],
    ]);
  });
});

describe("last year's imported final PD as the project's previous-year report, through a draft (2026-11-18, third)", () => {
  const generationOf = (s: Setup, generationId: Id<"generations">) => s.t.run(async (ctx) => ctx.db.get(generationId));
  const ownReport = (s: Setup, extra: { archived?: boolean } = {}) =>
    s.t.run(async (ctx) =>
      ctx.db.insert("projectDocuments", {
        projectId: s.projectId, fileName: "fy2024-report.pdf", fileType: "txt", content: "Last year's report.", category: "previous_pd",
        source: "upload", uploadedBy: s.userId, uploaderRole: "writer", createdAt: Date.now(), ...(extra.archived ? { archived: true } : {}),
      })
    );

  /** Opens the reserved draft's Seed stage, as startup would, and reads Previous-year status. */
  async function openSeedStage(s: Setup, generationId: Id<"generations">) {
    await s.t.run(async (ctx) => {
      await ctx.db.patch(generationId, {
        status: "running", candidateMode: "iterative", gatedWorkflow: "seeds",
        writerSettings: { profileState: "missing", source: "none", matchesProfile: false, savedProfileSuperseded: false, waiverAnalysis: "none", truncated: false },
      });
      await ctx.db.insert("generationArtifacts", {
        generationId, kind: "analysis", content: JSON.stringify({ company_context: "Test company", project_status: "completed" }),
      });
      await ctx.db.insert("generationArtifacts", {
        generationId, kind: "brain_blocks",
        content: JSON.stringify({
          blocks: { analyzer: "", s242: "", s244: "", s246: "" }, styleGuidance: "", styleOverrides: {},
          orderedContext: { profileState: "missing", categoryOutcomes: [], buildOrder: ["242", "244", "246"], selfCheckRules: [] },
        }),
      });
      await ctx.db.insert("generationBriefs", {
        generationId, projectId: s.projectId, inputsHash: "frozen", version: 1, origin: "derived",
        storylineText: "The seal held.", derivationVersion: BRIEF_DERIVATION_VERSION, createdAt: 1,
      });
    });
    await s.t.mutation(internal.generations.pinSeedBrief, { generationId, inputsHash: "frozen" });
    await s.t.mutation(internal.generations.initializeSeedStage, { generationId });
    return await s.t.run(async (ctx) =>
      ctx.db
        .query("seedSubsections")
        .withIndex("by_generationId_and_roleId", (q) => q.eq("generationId", generationId).eq("roleId", "prior_year_status"))
        .unique()
    );
  }

  it("the year's only final PD counts: it reads as last year's report, sets previous-year material and opens Previous-year status", async () => {
    const s = await setup();
    const fileId = await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s);
    const rows = await companyRows(s, generationId);
    expect(rows.map((row) => [row.label, row.companyFileId, row.fiscalYear])).toEqual([
      ["previous_pd:Pump housing.docx (FY 2024)", fileId, 2024],
    ]);
    // Still a company file with client trust.
    expect(rows[0]?.uploaderRole).toBeUndefined();
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(true);
    // The analyzer reads it as a company file's previous-year report.
    const input = await s.t.query(internal.generations.getGenerationInput, { generationId });
    const doc = input?.contextDocs.find((item) => item.fileName === "Pump housing.docx (FY 2024)");
    expect(doc).toMatchObject({ category: "previous_pd", company: true });
    const message = buildTrustedContext({ documents: [doc as never] }).userMessage;
    expect(message).toContain("COMPANY FILE, PREVIOUS-YEAR REPORT] Pump housing.docx (FY 2024)");
    // The Seed stage opens Previous-year status untouched, and the step says nothing about a missing year.
    expect((await openSeedStage(s, generationId))?.state).toBe("untouched");
    const step = await s.authed.query(api.seeds.getSubsection, { generationId, roleId: "prior_year_status" });
    expect("noPreviousYearMaterial" in step).toBe(false);
  });

  it("without a counting PD the Seed stage still opens Previous-year status skipped", async () => {
    const s = await setup();
    await addFile(s, "Pump housing.docx", "Final PD A.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "Valve body.docx", "Final PD B.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(false);
    expect((await openSeedStage(s, generationId))?.state).toBe("skipped");
    const step = await s.authed.query(api.seeds.getSubsection, { generationId, roleId: "prior_year_status" });
    expect(step).toMatchObject({ noPreviousYearMaterial: true });
  });

  it("of three final PDs last year, only the one sharing title words counts; the other pinned one stays background", async () => {
    const s = await setup();
    await addFile(s, "Pump housing.docx", "Final PD A.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "Cryogenic seal trials.docx", "Final PD B.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "Valve body.docx", "Final PD C.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s);
    expect((await companyRows(s, generationId)).map((row) => row.label)).toEqual([
      "previous_pd:Cryogenic seal trials.docx (FY 2024)",
      "background:Valve body.docx (FY 2024)",
    ]);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(true);
  });

  it("of three final PDs last year with no link, none counts and both pinned read as background", async () => {
    const s = await setup({ projectNumber: "4" });
    await addFile(s, "Pump housing.docx", "Final PD A.", { category: "final_pd", fiscalYear: 2024, pdNumber: "01" });
    await addFile(s, "Gasket.docx", "Final PD B.", { category: "final_pd", fiscalYear: 2024, pdNumber: "02" });
    await addFile(s, "Valve body.docx", "Final PD C.", { category: "final_pd", fiscalYear: 2024, pdNumber: "03" });
    const generationId = await start(s);
    expect((await companyRows(s, generationId)).map((row) => row.label)).toEqual([
      "background:Valve body.docx (FY 2024)",
      "background:Gasket.docx (FY 2024)",
    ]);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(false);
  });

  it("a PD number with leading zeros links it among several", async () => {
    const s = await setup({ projectNumber: "4" });
    await addFile(s, "Pump housing.docx", "Final PD A.", { category: "final_pd", fiscalYear: 2024, pdNumber: "004" });
    await addFile(s, "Valve body.docx", "Final PD B.", { category: "final_pd", fiscalYear: 2024, pdNumber: "07" });
    const generationId = await start(s);
    expect((await companyRows(s, generationId)).map((row) => row.label)).toEqual([
      "previous_pd:Pump housing.docx (FY 2024)",
      "background:Valve body.docx (FY 2024)",
    ]);
  });

  it("left out by the writer, it is not read and opens nothing", async () => {
    const s = await setup();
    const fileId = await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s, { excludeCompanyFileIds: [fileId] });
    expect(await companyRows(s, generationId)).toEqual([]);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(false);
  });

  it("when the frozen total has no room for it, it is left out unread and carries no mark", async () => {
    const s = await setup();
    const fileId = await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const company = await s.t.run(async (ctx) =>
      selectCompanyFilesOf(
        ctx,
        await ctx.db.get(s.clientId),
        undefined,
        ["x".repeat(FROZEN_TOTAL_BYTES)],
        s.projectId,
        undefined,
        companyDraftSubject(await ctx.db.get(s.projectId))
      )
    );
    expect(company.frozenCompanyFiles).toEqual([]);
    expect(company.companyFilesLeftOut).toEqual([fileId]);
  });

  it("the project's own previous-year report wins: the import stays background, and the draft still has previous-year material", async () => {
    const s = await setup();
    await ownReport(s);
    await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s);
    expect((await companyRows(s, generationId)).map((row) => row.label)).toEqual(["background:Pump housing.docx (FY 2024)"]);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(true);
  });

  it("ticked or not: leaving the project's own report out does not make the import the report", async () => {
    const s = await setup();
    const documentId = await ownReport(s);
    await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s, { excludeDocumentIds: [documentId] });
    expect((await companyRows(s, generationId)).map((row) => row.label)).toEqual(["background:Pump housing.docx (FY 2024)"]);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(false);
  });

  it("an archived own report does not count, so the import counts", async () => {
    const s = await setup();
    await ownReport(s, { archived: true });
    await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s);
    expect((await companyRows(s, generationId)).map((row) => row.label)).toEqual(["previous_pd:Pump housing.docx (FY 2024)"]);
  });

  it("a final PD of the project's own year, of two years back, or with no year never counts", async () => {
    const s = await setup();
    await addFile(s, "This year.docx", "This year's final PD.", { category: "final_pd", fiscalYear: 2025 });
    await addFile(s, "Two years back.docx", "Final PD 2023.", { category: "final_pd", fiscalYear: 2023 });
    await addFile(s, "No year.docx", "Final PD with no year.", { category: "final_pd" });
    const generationId = await start(s);
    expect((await companyRows(s, generationId)).map((row) => row.label)).toEqual(["background:Two years back.docx (FY 2023)"]);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(false);
  });

  it("a first-year project with no final PD last year, or with no fiscal year, has nothing from a previous year", async () => {
    const first = await setup();
    await addFile(first, "notes.txt", "Hand notes.", { category: "background" });
    expect((await generationOf(first, await start(first)))?.previousYearMaterial).toBe(false);
    const noYear = await setup({ fiscalYear: null });
    await addFile(noYear, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(noYear);
    expect(await companyRows(noYear, generationId)).toEqual([]);
    expect((await generationOf(noYear, generationId))?.previousYearMaterial).toBe(false);
  });

  it("an archived final PD is not among the year's rows read; one without text still is", async () => {
    const s = await setup();
    await addFile(s, "Pump housing.docx", "Final PD A.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "Archived.docx", "Archived final PD.", { category: "final_pd", fiscalYear: 2024, archived: true });
    const generationId = await start(s);
    // The archived one is not among the rows read, so the other is the year's only final PD.
    expect((await companyRows(s, generationId)).map((row) => row.label)).toEqual(["previous_pd:Pump housing.docx (FY 2024)"]);
    const withEmpty = await setup();
    await addFile(withEmpty, "Pump housing.docx", "Final PD A.", { category: "final_pd", fiscalYear: 2024 });
    await withEmpty.t.run(async (ctx) => {
      const facts = await companyFileTextFacts("");
      await ctx.db.insert("companyFiles", {
        clientId: withEmpty.clientId, fileName: "Scanned.pdf", fileType: "pdf", category: "final_pd", fiscalYear: 2024,
        ...facts, hasText: false, textLength: 0, processingStatus: "ready", uploadedBy: withEmpty.userId, createdAt: Date.now(),
      });
    });
    // A final PD of the year without text is still another project's PD: no link, so none counts.
    expect((await companyRows(withEmpty, await start(withEmpty))).map((row) => row.label)).toEqual(["background:Pump housing.docx (FY 2024)"]);
  });

  it("a company file filed by hand as a previous-year report reads as before: background, and previous-year material", async () => {
    const s = await setup();
    await addFile(s, "old-report.txt", "A report filed by hand.", { category: "previous_pd" });
    const generationId = await start(s);
    expect((await companyRows(s, generationId)).map((row) => row.label)).toEqual(["background:old-report.txt"]);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(true);
  });
});

describe("decision 42 holds with a counting PD (2026-11-18, third)", () => {
  it("a project whose only evidence is company files, a counting PD among them, is refused with the same message", async () => {
    const s = await setup({ transcript: false });
    await addFile(s, "Pump housing.docx", "Last year's final PD, with plenty of detail.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "notes.txt", "Hand notes about the company.", { category: "background" });
    let message = "";
    try {
      await start(s);
    } catch (error) {
      message = (error as { data?: { message?: string } }).data?.message ?? (error as Error).message;
    }
    expect(message).toContain("Add an interview transcript or at least one context document with readable text");
  });

  it("next to last year's report, the import is still not this year's source", async () => {
    const s = await setup({ transcript: false });
    await s.t.run(async (ctx) =>
      ctx.db.insert("projectDocuments", {
        projectId: s.projectId, fileName: "fy2024-report.pdf", fileType: "txt", content: "Last year's report.", category: "previous_pd",
        source: "upload", uploadedBy: s.userId, uploaderRole: "writer", createdAt: Date.now(),
      })
    );
    await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    expect(await errorOf(() => start(s))).toEqual({ code: "INVALID_INPUT", reason: PREVIOUS_YEAR_ONLY_REASON });
    expect(PREVIOUS_YEAR_ONLY_MESSAGE).toBe("Add a transcript or a current file. Last year's report alone can't be the source for this year's report.");
  });

  it("with a transcript, a draft reading a counting PD starts", async () => {
    const s = await setup();
    await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    expect(await start(s)).toBeTruthy();
  });
});

describe("the start dialog and chat agree with drafts on last year's PD (2026-11-18, third)", () => {
  it("the start dialog marks the counting PD, and none when the project has its own report", async () => {
    const s = await setup();
    await addFile(s, "notes.txt", "Hand notes.");
    await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "Two years back.docx", "Final PD 2023.", { category: "final_pd", fiscalYear: 2023 });
    const listed = await s.authed.query(api.companyFiles.listForProject, { projectId: s.projectId });
    expect(listed.files.map((file) => [file.fileName, file.previousYear])).toEqual([
      ["notes.txt", false],
      ["Pump housing.docx", true],
      ["Two years back.docx", false],
    ]);
    await s.t.run(async (ctx) =>
      ctx.db.insert("projectDocuments", {
        projectId: s.projectId, fileName: "fy2024-report.pdf", fileType: "txt", content: "Last year's report.", category: "previous_pd",
        source: "upload", uploadedBy: s.userId, uploaderRole: "writer", createdAt: Date.now(),
      })
    );
    const withOwn = await s.authed.query(api.companyFiles.listForProject, { projectId: s.projectId });
    expect(withOwn.files.map((file) => file.previousYear)).toEqual([false, false, false]);
  });

  it("chat lists and opens the counting PD as the previous-year report, and as background once the project has its own", async () => {
    const s = await setup({ chat: true });
    const fileId = await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const listed = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId));
    expect(listed.map((file) => [file.companyFileId, file.category])).toEqual([[fileId, "previous_pd"]]);
    const read = await s.t.query(internal.chatDocuments.readCompanyFileForChat, {
      agentThreadId: "thread-history", companyFileId: fileId, userId: s.userId, start: 0, maxChars: 1_000,
    });
    expect(read).toMatchObject({ status: "ok", category: "previous_pd" });
    // A caller that knows the project has its own report.
    const known = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId, undefined, true));
    expect(known.map((file) => file.category)).toEqual(["background"]);
    await s.t.run(async (ctx) =>
      ctx.db.insert("projectDocuments", {
        projectId: s.projectId, fileName: "fy2024-report.pdf", fileType: "txt", content: "Last year's report.", category: "previous_pd",
        source: "upload", uploadedBy: s.userId, uploaderRole: "writer", createdAt: Date.now(),
      })
    );
    expect((await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId))).map((file) => file.category)).toEqual(["background"]);
    const readAgain = await s.t.query(internal.chatDocuments.readCompanyFileForChat, {
      agentThreadId: "thread-history", companyFileId: fileId, userId: s.userId, start: 0, maxChars: 1_000,
    });
    expect(readAgain).toMatchObject({ status: "ok", category: "background" });
  });
});

describe("chat during a merge's file move (final review of #48 to #51, P3-2)", () => {
  it("counts no PD as the previous-year report while files are still moving in, then does again", async () => {
    const s = await setup({ chat: true });
    const fileId = await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const merged = await s.t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("clients", {
        name: "Quillmere Old", nameKey: "quillmere old", status: "merged", mergedIntoClientId: s.clientId,
        companyFilesMovingTo: s.clientId, companyFilesMoveAt: now, nameHistoryComplete: true,
        createdBy: s.userId, createdAt: now, updatedAt: now,
      });
    });
    const read = () =>
      s.t.query(internal.chatDocuments.readCompanyFileForChat, {
        agentThreadId: "thread-history", companyFileId: fileId, userId: s.userId, start: 0, maxChars: 1_000,
      });
    const listed = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId));
    expect(listed.map((file) => [file.companyFileId, file.category])).toEqual([[fileId, "background"]]);
    expect(await read()).toMatchObject({ status: "ok", category: "background" });
    // The move ends: the PD counts again, as drafts will read it.
    await s.t.run((ctx) => ctx.db.patch(merged, { companyFilesMovingTo: undefined, companyFilesMoveAt: undefined }));
    expect((await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId))).map((file) => file.category)).toEqual(["previous_pd"]);
    expect(await read()).toMatchObject({ status: "ok", category: "previous_pd" });
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

  it("a company search that stops gathering early with fewer hits than asked is not complete", async () => {
    const s = await setup();
    // 20 versions of one PD: the search gathers 3 hits a place asked, then collapses them to 2.
    for (let index = 0; index < 20; index += 1) {
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

describe("review fixes for last year's PD (2026-11-18, third)", () => {
  const generationOf = (s: Setup, generationId: Id<"generations">) => s.t.run(async (ctx) => ctx.db.get(generationId));
  const openInChat = (s: Setup, companyFileId: Id<"companyFiles">) =>
    s.t.query(internal.chatDocuments.readCompanyFileForChat, {
      agentThreadId: "thread-history", companyFileId, userId: s.userId, start: 0, maxChars: 1_000,
    });

  it("two linked PDs last year: only the first in pin order reads as the report, in the draft, the dialog and chat", async () => {
    const s = await setup({ chat: true, projectNumber: "4" });
    const numbered = await addFile(s, "Gasket.docx", "Final PD with the project's number.", { category: "final_pd", fiscalYear: 2024, pdNumber: "04" });
    const titled = await addFile(s, "Cryogenic seal trials.docx", "Final PD sharing two title words.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s, { confirmRegeneration: true });
    expect((await companyRows(s, generationId)).map((row) => [row.companyFileId, row.label])).toEqual([
      [numbered, "previous_pd:Gasket.docx (FY 2024)"],
      [titled, "background:Cryogenic seal trials.docx (FY 2024)"],
    ]);
    const listed = await s.authed.query(api.companyFiles.listForProject, { projectId: s.projectId });
    expect(listed.files.map((file) => [file._id, file.previousYear])).toEqual([
      [numbered, true],
      [titled, false],
    ]);
    const chat = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId));
    expect(chat.map((file) => [file.companyFileId, file.category])).toEqual([
      [numbered, "previous_pd"],
      [titled, "background"],
    ]);
    // Opening the PD that does not count reads it as background.
    expect(await openInChat(s, titled)).toMatchObject({ status: "ok", category: "background" });
    expect(await openInChat(s, numbered)).toMatchObject({ status: "ok", category: "previous_pd" });
  });

  it("the review's case: a generic shared word links neither PD, so neither counts anywhere", async () => {
    const s = await setup({ chat: true });
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { title: "Development of a cryogenic seal" }));
    const scheduling = await addFile(s, "Development of a scheduling engine.docx", "Another project's PD.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "Pump housing.docx", "A third project's PD.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s, { confirmRegeneration: true });
    expect((await companyRows(s, generationId)).every((row) => row.label.startsWith("background:"))).toBe(true);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(false);
    expect(await openInChat(s, scheduling)).toMatchObject({ category: "background" });
  });

  it("a chat list whose budget stops last year's read early never counts a PD as the year's only one", async () => {
    const s = await setup({ chat: true });
    await addFile(s, "Pump housing.docx", "Final PD A.", { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "Valve body.docx", "Final PD B.", { category: "final_pd", fiscalYear: 2024 });
    // Read first: the year's rows are read newest first.
    const first = await addFile(s, "Gasket.docx", "Final PD C.", { category: "final_pd", fiscalYear: 2024 });
    let reads = 0;
    const listed = await s.t.run(async (ctx) =>
      chatCompanyFilesFor(ctx, s.projectId, s.userId, { mayRead: () => reads < 1, read: () => void (reads += 1) }, false)
    );
    // One row of three read: it is listed, as background, as drafts and chat open read it.
    expect(listed.map((file) => [file.companyFileId, file.category])).toEqual([[first, "background"]]);
    expect(await openInChat(s, first)).toMatchObject({ category: "background" });
    expect((await companyRows(s, await start(s, { confirmRegeneration: true }))).every((row) => row.label.startsWith("background:"))).toBe(true);
    // With the whole year read, three PDs and no link: still none counts.
    const whole = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.userId, undefined, false));
    expect(whole.filter((file) => file.category === "previous_pd")).toEqual([]);
  });

  it("the project's own file rows are read within a byte budget, stop at the first report, and a stopped read counts no PD", async () => {
    const s = await setup();
    await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const insertDocument = (fileName: string, content: string, category?: "previous_pd") =>
      s.t.run(async (ctx) =>
        ctx.db.insert("projectDocuments", {
          projectId: s.projectId, fileName, fileType: "txt", content, ...(category ? { category } : {}),
          source: "upload", uploadedBy: s.userId, uploaderRole: "writer", createdAt: Date.now(),
        })
      );
    // Six older rows holding 900,000 characters inline each, then last year's report.
    for (let index = 0; index < 6; index += 1) await insertDocument(`big-${index}.txt`, "b".repeat(900_000));
    await insertDocument("fy2024-report.pdf", "Last year's report.", "previous_pd");
    expect(await s.t.run(async (ctx) => projectHasOwnPreviousYearReport(ctx, s.projectId))).toBeNull();
    expect(OWN_REPORT_READ_BYTES).toBe(4 * 1024 * 1024);
    // The dialog then marks no PD.
    const listed = await s.authed.query(api.companyFiles.listForProject, { projectId: s.projectId });
    expect(listed.files.map((file) => file.previousYear)).toEqual([false]);
    // With the report first, one row is read.
    const t2 = await setup();
    await insertDocumentFor(t2, "fy2024-report.pdf", "Last year's report.", "previous_pd");
    for (let index = 0; index < 3; index += 1) await insertDocumentFor(t2, `notes-${index}.txt`, "Notes.");
    let reads = 0;
    expect(await t2.t.run(async (ctx) => projectHasOwnPreviousYearReport(ctx, t2.projectId, { read: () => void (reads += 1) }))).toBe(true);
    expect(reads).toBe(1);
    // A project with no previous-year file of its own reads false.
    const t3 = await setup();
    await insertDocumentFor(t3, "notes.txt", "Notes.");
    expect(await t3.t.run(async (ctx) => projectHasOwnPreviousYearReport(ctx, t3.projectId))).toBe(false);
  });

  it("the writer leaving the counting PD out: the other pinned PDs keep their shares, and nothing opens", async () => {
    const s = await setup();
    const counting = await addFile(s, "Cryogenic seal trials.docx", "c".repeat(20_000), { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "Valve body.docx", "v".repeat(20_000), { category: "final_pd", fiscalYear: 2024 });
    await addFile(s, "a-2023.docx", "a".repeat(20_000), { category: "final_pd", fiscalYear: 2023 });
    await addFile(s, "b-2023.docx", "b".repeat(20_000), { category: "final_pd", fiscalYear: 2023 });
    const generationId = await start(s, { excludeCompanyFileIds: [counting] });
    const rows = await companyRows(s, generationId);
    // Decided before the leave-out: the 16,000 it would have read is not given to the others.
    expect(rows.map((row) => [row.label, row.content.length])).toEqual([
      ["background:Valve body.docx (FY 2024)", 5_333],
      ["background:b-2023.docx (FY 2023)", 5_333],
      ["background:a-2023.docx (FY 2023)", 5_334],
    ]);
    expect((await generationOf(s, generationId))?.previousYearMaterial).toBe(false);
  });

  it("a retry of a draft made before this change freezes the PD again as last year's report", async () => {
    const s = await setup();
    await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const older = await start(s);
    // As a draft made before this change stored it, then failed.
    await s.t.run(async (ctx) => {
      for (const row of await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", older)).collect()) {
        if (row.kind === "company_file") await ctx.db.patch(row._id, { label: row.label.replace(/^previous_pd:/, "background:") });
      }
      await ctx.db.patch(older, { status: "failed", previousYearMaterial: false });
      await ctx.db.patch(s.projectId, { activeGenerationId: undefined });
    });
    const retryId = await s.authed.mutation(api.generations.retryGeneration, { generationId: older });
    expect(retryId).not.toBe(older);
    expect((await companyRows(s, retryId)).map((row) => row.label)).toEqual(["previous_pd:Pump housing.docx (FY 2024)"]);
    expect((await generationOf(s, retryId))?.previousYearMaterial).toBe(true);
    // The older draft keeps its own rows.
    expect((await companyRows(s, older)).map((row) => row.label)).toEqual(["background:Pump housing.docx (FY 2024)"]);
  });

  it("a Brief made while the PD read as background is not reused once it reads as last year's report", async () => {
    const s = await setup();
    await addFile(s, "Pump housing.docx", "Last year's final PD.", { category: "final_pd", fiscalYear: 2024 });
    const generationId = await start(s);
    const rows = await s.t.run(async (ctx) =>
      withSourceTexts(ctx, await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect())
    );
    const nowHash = await briefInputsHash(rows);
    const asBackground = rows.map((row) =>
      row.kind === "company_file" ? { ...row, label: row.label.replace(/^previous_pd:/, "background:") } : row
    );
    const beforeHash = await briefInputsHash(asBackground);
    expect(nowHash).not.toBe(beforeHash);
    // Without a counting row the hash is exactly what it was: labels never count.
    const relabelled = asBackground.map((row) => (row.kind === "company_file" ? { ...row, label: "other:renamed.docx" } : row));
    expect(await briefInputsHash(relabelled)).toBe(beforeHash);
    // A current Brief stored under the older inputs is found for them, and not for the new ones.
    await s.t.run(async (ctx) =>
      ctx.db.insert("generationBriefs", {
        generationId, projectId: s.projectId, inputsHash: beforeHash, version: 1, origin: "derived",
        storylineText: "The seal held.", derivationVersion: BRIEF_DERIVATION_VERSION, createdAt: 1,
      })
    );
    expect(await s.t.query(internal.generations.findReusableBrief, { generationId, inputsHash: beforeHash })).not.toBeNull();
    expect(await s.t.query(internal.generations.findReusableBrief, { generationId, inputsHash: nowHash })).toBeNull();
  });
});

async function insertDocumentFor(s: Setup, fileName: string, content: string, category?: "previous_pd") {
  return await s.t.run(async (ctx) =>
    ctx.db.insert("projectDocuments", {
      projectId: s.projectId, fileName, fileType: "txt", content, ...(category ? { category } : {}),
      source: "upload", uploadedBy: s.userId, uploaderRole: "writer", createdAt: Date.now(),
    })
  );
}

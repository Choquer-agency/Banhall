/// <reference types="vite/client" />
/**
 * 2026-10-26 (Phase C, step 3; decision "2026-10-26", part 1): a draft
 * freezes its project's company's files as their own kind, after the
 * project's own files, within caps; the AI is told what they are; they
 * never count as this year's source; the Inputs band names them; and a
 * project with no company, or a draft of one, is exactly as before.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { companyFileTextFacts, insertCompanyFileTextPieces } from "./lib/companyFileText";
import {
  FROZEN_COMPANY_FILES,
  FROZEN_TOTAL_BYTES,
  frozenPlaceholders,
  frozenSourceFields,
  selectCompanyFilesOf,
  selectFrozenEvidence,
} from "./lib/briefEvidence";
import { selectDraftEvidence } from "./lib/intakeDrafts";
import { buildBriefUserMessage } from "./lib/briefRequest";
import { buildSeedTrustedContext, buildTrustedContext } from "./ai/trustedContext";
import { COMPANY_FILE_LABEL_PREFIX, COMPANY_FILES_NOTE, visibleSourceLabel } from "./lib/companyEvidence";
import { assembleContextInclusion } from "./lib/contextInclusion";
import { verifiedSourceMapping } from "./lib/generations/briefAdoption";
import { factsSourceDocumentOf } from "./lib/generations/seedStage";

const modules = import.meta.glob("./**/*.ts");
const authId = "company-drafts-writer";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) return String((data as { code: unknown }).code);
    return `UNTYPED: ${(error as Error).message}`;
  }
  return "NO_ERROR";
}

async function setup(options: { company?: boolean; transcript?: string | null; documents?: string[] } = {}) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const clientId = await ctx.db.insert("clients", {
      name: "Acme Seals", nameKey: "acme seals", status: "active", formerNames: ["Northgate Gaskets"], nameHistoryComplete: true,
      createdBy: userId, createdAt: now, updatedAt: now,
    });
    const otherClientId = await ctx.db.insert("clients", {
      name: "Borealis", nameKey: "borealis", status: "active", createdBy: userId, createdAt: now, updatedAt: now,
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Cold seal", clientName: "Acme Seals", ...(options.company === false ? {} : { clientId }),
      status: "draft", createdBy: userId, ownerId: userId, shareToken: `cd-${Math.random()}`, createdAt: now, updatedAt: now,
    });
    if (options.transcript !== null) {
      await ctx.db.insert("transcripts", { projectId, content: options.transcript ?? "Dana: The seal held at 4.2 bar.", createdAt: now });
    }
    for (const [index, content] of (options.documents ?? []).entries()) {
      await ctx.db.insert("projectDocuments", {
        projectId, fileName: `doc-${index}.txt`, fileType: "txt", content, source: "upload", uploadedBy: userId,
        uploaderRole: "writer", createdAt: now,
      });
    }
    return { userId, clientId, otherClientId, projectId };
  });
  return { t, authed: t.withIdentity({ subject: authId }), ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function addCompanyFile(
  s: Setup,
  fileName: string,
  text: string,
  extra: { clientId?: Id<"clients">; archived?: boolean; category?: "background"; textFormat?: "markdown"; createdAt?: number } = {}
) {
  return await s.t.run(async (ctx) => {
    const id = await ctx.db.insert("companyFiles", {
      clientId: extra.clientId ?? s.clientId,
      fileName,
      fileType: "txt",
      ...(extra.category ? { category: extra.category } : {}),
      ...(extra.textFormat ? { textFormat: extra.textFormat } : {}),
      ...(await companyFileTextFacts(text)),
      processingStatus: "ready",
      ...(extra.archived ? { archived: true } : {}),
      uploadedBy: s.userId,
      createdAt: extra.createdAt ?? Date.now(),
    });
    await insertCompanyFileTextPieces(ctx, id, text);
    return id;
  });
}

async function sourcesOf(s: Setup, generationId: Id<"generations">) {
  return await s.t.run(async (ctx) =>
    ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
  );
}

const start = (s: Setup, extra: Record<string, unknown> = {}) =>
  s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId, candidateMode: "single", ...extra });

describe("freezing a project's company files", () => {
  it("freezes them after the project's own files, as company files with client trust and their company", async () => {
    const s = await setup({ documents: ["Project notes."] });
    const fileId = await addCompanyFile(s, "history.docx", "# History\n\nAcme **sealed** pumps.", {
      category: "background",
      textFormat: "markdown",
    });
    const sources = await sourcesOf(s, await start(s));
    expect(sources.map((row) => row.kind)).toEqual(["transcript", "project_document", "company_file"]);
    const company = sources[2]!;
    expect(company).toMatchObject({
      companyFileId: fileId,
      clientId: s.clientId,
      label: "background:history.docx",
      // Word Markdown frozen without its bold marks, as project files.
      content: "# History\n\nAcme sealed pumps.",
      truncated: false,
    });
    expect(company.uploaderRole).toBeUndefined();
  });

  it("freezes nothing more for a project with no company, or a company that was merged", async () => {
    const plain = await setup({ company: false });
    await addCompanyFile(plain, "history.txt", "Acme history.");
    expect((await sourcesOf(plain, await start(plain))).map((row) => row.kind)).toEqual(["transcript"]);

    const merged = await setup();
    await addCompanyFile(merged, "history.txt", "Acme history.");
    await merged.t.run(async (ctx) => ctx.db.patch(merged.clientId, { status: "merged", mergedIntoClientId: merged.otherClientId }));
    expect((await sourcesOf(merged, await start(merged))).map((row) => row.kind)).toEqual(["transcript"]);
  });

  it("never freezes archived, empty or another company's files, and keeps the newest within the caps", async () => {
    const s = await setup();
    await addCompanyFile(s, "archived.txt", "Archived.", { archived: true });
    await addCompanyFile(s, "empty.txt", "");
    await addCompanyFile(s, "theirs.txt", "Borealis file.", { clientId: s.otherClientId });
    for (let i = 0; i < FROZEN_COMPANY_FILES + 2; i++) await addCompanyFile(s, `file-${i}.txt`, `Company file ${i}.`, { createdAt: i });
    const names = (await sourcesOf(s, await start(s))).filter((row) => row.kind === "company_file").map((row) => row.label);
    expect(names).toHaveLength(FROZEN_COMPANY_FILES);
    expect(names[0]).toBe(`other:file-${FROZEN_COMPANY_FILES + 1}.txt`);
    expect(names).not.toContain("other:archived.txt");
    expect(names).not.toContain("other:empty.txt");
    expect(names).not.toContain("other:theirs.txt");
  });

  it("caps company text at 600,000 characters in all, cutting the last file to fit", async () => {
    const s = await setup();
    for (let i = 0; i < 4; i++) await addCompanyFile(s, `big-${i}.txt`, "x".repeat(250_000), { createdAt: 4 - i });
    const rows = (await sourcesOf(s, await start(s))).filter((row) => row.kind === "company_file");
    expect(rows.map((row) => row.content.length)).toEqual([200_000, 200_000, 200_000]);
    expect(rows.every((row) => row.truncated)).toBe(true);
  });

  it("leaves out a company file the writer unticked, and refuses another company's", async () => {
    const s = await setup();
    const kept = await addCompanyFile(s, "kept.txt", "Kept.");
    const leftOut = await addCompanyFile(s, "left.txt", "Left out.");
    const theirs = await addCompanyFile(s, "theirs.txt", "Theirs.", { clientId: s.otherClientId });
    const generationId = await start(s, { excludeCompanyFileIds: [leftOut] });
    const company = (await sourcesOf(s, generationId)).filter((row) => row.kind === "company_file");
    expect(company.map((row) => row.companyFileId)).toEqual([kept]);
    expect((await s.t.run(async (ctx) => ctx.db.get(generationId)))?.excludedSources).toEqual({
      documentIds: [],
      transcriptIds: [],
      companyFileIds: [leftOut],
    });
    expect(await errorCode(() => start(s, { excludeCompanyFileIds: [theirs] }))).toBe("INVALID_INPUT");
  });

  it("company files never count as this year's source (decision 42)", async () => {
    const s = await setup({ transcript: null });
    await addCompanyFile(s, "history.txt", "Acme history with plenty of detail.");
    expect(await errorCode(() => start(s))).toBe("INVALID_INPUT");
  });

  it("hides the company's former names only when its files are sent", async () => {
    const s = await setup();
    const placeholders = async () =>
      await s.t.run(async (ctx) => {
        const project = (await ctx.db.get(s.projectId))!;
        return (await frozenPlaceholders(ctx, project, await selectFrozenEvidence(ctx, s.projectId))).map((entry) => entry.value);
      });
    expect(await placeholders()).not.toContain("Northgate Gaskets");
    await addCompanyFile(s, "history.txt", "Northgate Gaskets became Acme Seals.");
    expect(await placeholders()).toContain("Northgate Gaskets");
  });

  it("leaves a project without company files exactly as before: the same frozen fields", async () => {
    const s = await setup({ documents: ["Project notes."] });
    const before = await s.t.run(async (ctx) => frozenSourceFields(await selectFrozenEvidence(ctx, s.projectId)));
    expect(before.map((row) => row.kind)).toEqual(["transcript", "project_document"]);
    for (const row of before) {
      expect(row).not.toHaveProperty("companyFileId");
      expect(row).not.toHaveProperty("clientId");
    }
  });

  it("the generation input hands company files to the analyzer, marked as company files, after project files", async () => {
    const s = await setup({ documents: ["Project notes."] });
    await addCompanyFile(s, "history.txt", "Acme history.");
    const generationId = await start(s);
    const input = await s.t.query(internal.generations.getGenerationInput, { generationId });
    expect(input?.contextDocs.map((doc) => [doc.fileName, "company" in doc ? doc.company : undefined])).toEqual([
      ["doc-0.txt", undefined],
      ["history.txt", true],
    ]);
  });
});

describe("how the AI is told about company files", () => {
  const projectDoc = { category: "background" as const, fileName: "notes.txt", content: "Project notes." };
  const companyDoc = { category: "background" as const, fileName: "history.txt", content: "Company history.", company: true as const };

  it("the analyzer puts company files last, labelled, after one note; without one nothing changes", () => {
    const withCompany = buildTrustedContext({ documents: [companyDoc, projectDoc] }).userMessage;
    expect(withCompany.indexOf("notes.txt")).toBeLessThan(withCompany.indexOf("history.txt"));
    expect(withCompany).toContain(`${COMPANY_FILE_LABEL_PREFIX}BACKGROUND`);
    expect(withCompany.split(COMPANY_FILES_NOTE)).toHaveLength(2);
    expect(withCompany.indexOf(COMPANY_FILES_NOTE)).toBeLessThan(withCompany.indexOf("history.txt"));
    const without = buildTrustedContext({ documents: [projectDoc] }).userMessage;
    expect(without).not.toContain(COMPANY_FILES_NOTE);
    expect(without).not.toContain(COMPANY_FILE_LABEL_PREFIX);
  });

  it("the Brief request notes company files once, before the first, only when there is one", () => {
    const row = (kind: string, label: string, content: string) => ({ kind, label, content }) as Parameters<
      typeof buildBriefUserMessage
    >[0][number];
    const withCompany = buildBriefUserMessage([
      row("transcript", "Interview", "Dana: held."),
      row("company_file", "other:a.txt", "First company file."),
      row("company_file", "other:b.txt", "Second company file."),
    ]);
    expect(withCompany.split(COMPANY_FILES_NOTE)).toHaveLength(2);
    expect(withCompany.indexOf(COMPANY_FILES_NOTE)).toBeLessThan(withCompany.indexOf("[SOURCE_KIND=company_file]"));
    expect(buildBriefUserMessage([row("transcript", "Interview", "Dana: held.")])).not.toContain(COMPANY_FILES_NOTE);
  });

  it("Seed prompts carry the note only when a company file is among the sources", () => {
    const fixed = {
      mode: "batch" as const,
      objective: "Identify the uncertainty.",
      brief: { storyline: "Storyline.", entries: ["Item."] },
      projection: { decisions: '{"items":[],"v":1}', feedback: '{"items":[],"v":1}' },
      writerSettings: {},
      lengthTarget: "standard",
    };
    const source = (kind: string) => ({ sourceId: `s-${kind}`, label: "x", kind, content: "Text.", contentHash: "h" });
    expect(buildSeedTrustedContext({ ...fixed, sources: [source("company_file")] }).userMessage).toContain(COMPANY_FILES_NOTE);
    expect(buildSeedTrustedContext({ ...fixed, sources: [source("project_document")] }).userMessage).not.toContain(COMPANY_FILES_NOTE);
  });

  it("the facts check names a company file as one", () => {
    const document = factsSourceDocumentOf({ kind: "company_file", label: "background:history.txt", content: "Text." });
    expect(document.label).toBe(`${COMPANY_FILE_LABEL_PREFIX}BACKGROUND RESEARCH / LINKS: history.txt`);
  });
});

describe("the Inputs band and adoption", () => {
  const row = (id: string, kind: string, label: string) =>
    ({ _id: id, kind, label, inclusion: "included" }) as Parameters<typeof assembleContextInclusion>[0]["sources"][number];

  it("names the company files a draft used, after its documents, counted with them, and hides them from viewers who may not read them", () => {
    const sources = [row("t", "transcript", "Interview"), row("d", "project_document", "other:notes.txt"), row("c", "company_file", "background:history.txt")];
    const shown = assembleContextInclusion({ sources, unfrozenDocuments: [], fallbackCap: 10 });
    expect(shown.rows.map((item) => [item.kind, item.label])).toEqual([
      ["transcript", "Interview"],
      ["document", "notes.txt"],
      ["company", "history.txt"],
    ]);
    expect(shown.documentsTotal).toBe(2);
    const hidden = assembleContextInclusion({ sources, unfrozenDocuments: [], fallbackCap: 10, showCompanyFiles: false });
    expect(hidden.rows.map((item) => item.kind)).toEqual(["transcript", "document"]);
  });

  it("a prepared Brief maps onto a run only when every company file is the same file", () => {
    const base = {
      kind: "company_file", label: "other:a.txt", truncated: false, originalLength: 5, contentHash: "h", content: "Text.",
    };
    const prepared = [{ ...base, _id: "p1", companyFileId: "cf-1" }] as unknown as Doc<"briefPreparationSources">[];
    const same = [{ ...base, _id: "g1", companyFileId: "cf-1" }] as unknown as Doc<"generationSources">[];
    const other = [{ ...base, _id: "g1", companyFileId: "cf-2" }] as unknown as Doc<"generationSources">[];
    expect(verifiedSourceMapping(prepared, same)).not.toBeNull();
    expect(verifiedSourceMapping(prepared, other)).toBeNull();
  });
});

describe("the start dialog's company files (Phase C)", () => {
  it("lists the project's company's readable files newest first, and nothing for a project without a company", async () => {
    const s = await setup();
    await addCompanyFile(s, "older.txt", "Older.", { createdAt: 1 });
    await addCompanyFile(s, "newer.txt", "Newer.", { createdAt: 2 });
    await addCompanyFile(s, "archived.txt", "Archived.", { archived: true });
    await addCompanyFile(s, "empty.txt", "");
    const listed = await s.authed.query(api.companyFiles.listForProject, { projectId: s.projectId });
    expect(listed.files.map((file) => file.fileName)).toEqual(["newer.txt", "older.txt"]);
    expect(listed.usedAtMost).toBe(FROZEN_COMPANY_FILES);

    const plain = await setup({ company: false });
    await addCompanyFile(plain, "history.txt", "History.");
    expect((await plain.authed.query(api.companyFiles.listForProject, { projectId: plain.projectId })).files).toEqual([]);
  });

  it("a head start for the ticked files keeps the company files left out", async () => {
    const s = await setup();
    const leftOut = await addCompanyFile(s, "left.txt", "Left out.");
    await s.authed.mutation(api.briefPreparations.setProjectStartSelection, {
      projectId: s.projectId,
      excludedTranscriptIds: [],
      excludedDocumentIds: [],
      excludedCompanyFileIds: [leftOut],
    });
    const preparations = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparations").withIndex("by_projectId", (q) => q.eq("projectId", s.projectId)).collect()
    );
    expect(preparations.at(-1)?.excludedCompanyFileIds).toEqual([leftOut]);
  });
});

describe("review fixes, 2026-10-26", () => {
  it("cuts the last file to fit the 600,000 character total", async () => {
    const s = await setup();
    for (let i = 0; i < 4; i++) await addCompanyFile(s, `mid-${i}.txt`, "y".repeat(180_000));
    const rows = (await sourcesOf(s, await start(s))).filter((row) => row.kind === "company_file");
    expect(rows.map((row) => row.content.length)).toEqual([180_000, 180_000, 180_000, 60_000]);
    expect(rows.map((row) => row.truncated)).toEqual([false, false, false, true]);
  });

  it("reads no company file once the draft's own rows fill the byte ceiling", async () => {
    const s = await setup();
    await addCompanyFile(s, "history.txt", "Acme history.");
    const picked = await s.t.run(async (ctx) =>
      selectCompanyFilesOf(ctx, await ctx.db.get(s.clientId), undefined, ["z".repeat(FROZEN_TOTAL_BYTES)])
    );
    expect(picked.frozenCompanyFiles).toEqual([]);
  });

  it("a company file never stands in for this year's source next to last year's report (decision 42)", async () => {
    const s = await setup({ transcript: null });
    await s.t.run(async (ctx) =>
      ctx.db.insert("projectDocuments", {
        projectId: s.projectId, fileName: "fy2024-report.pdf", fileType: "txt", content: "Last year's report.", category: "previous_pd",
        source: "upload", uploadedBy: s.userId, uploaderRole: "writer", createdAt: Date.now(),
      })
    );
    await addCompanyFile(s, "history.txt", "Acme history.");
    let reason: unknown = null;
    try {
      await start(s);
    } catch (error) {
      reason = (error as { data?: { reason?: string } }).data?.reason;
    }
    expect(reason).toBe("PREVIOUS_YEAR_ONLY_SOURCES");
  });

  it("a company whose names cannot all be read lends no files to a draft", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.clientId, { nameHistoryComplete: undefined });
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("clients", {
          name: `Merged ${i}`, nameKey: `merged ${i}`, status: "merged", mergedIntoClientId: s.clientId,
          createdBy: s.userId, createdAt: 1, updatedAt: 1,
        });
      }
    });
    await addCompanyFile(s, "history.txt", "Acme history.");
    expect((await sourcesOf(s, await start(s))).map((row) => row.kind)).toEqual(["transcript"]);
  });

  it("a company file filed as last year's report or scoping notes reads as background", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("companyFiles", {
        clientId: s.clientId, fileName: "old-pd.txt", fileType: "txt", category: "previous_pd",
        ...(await companyFileTextFacts("Another project's report.")), processingStatus: "ready", uploadedBy: s.userId, createdAt: 1,
      });
      await insertCompanyFileTextPieces(ctx, id, "Another project's report.");
    });
    const row = (await sourcesOf(s, await start(s))).find((source) => source.kind === "company_file");
    expect(row?.label).toBe("background:old-pd.txt");
  });

  it("a New project head start freezes the files of the company the draft names, as its first run will", async () => {
    const s = await setup();
    await addCompanyFile(s, "history.txt", "Acme history.");
    const fields = await s.t.run(async (ctx) => {
      const draftId = await ctx.db.insert("intakeDrafts", {
        ownerId: s.userId, status: "open", createdAt: Date.now(), lastEditedAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000, transcriptCount: 0, clientName: "ACME SEALS",
      });
      return (await selectDraftEvidence(ctx, (await ctx.db.get(draftId))!)).fields;
    });
    expect(fields.map((field) => [field.kind, field.label])).toEqual([["company_file", "other:history.txt"]]);
    const run = (await sourcesOf(s, await start(s))).find((row) => row.kind === "company_file")!;
    expect({ content: run.content, contentHash: run.contentHash, label: run.label }).toEqual({
      content: fields[0]!.content,
      contentHash: fields[0]!.contentHash,
      label: fields[0]!.label,
    });
  });

  it("the promoted project's first run reads the same company names as its head start, whatever case the draft typed (review 2)", async () => {
    const s = await setup();
    await addCompanyFile(s, "history.txt", "Acme history.");
    const names = await s.t.run(async (ctx) => {
      // Another of the company's projects, whose people the names hide.
      await ctx.db.insert("projects", {
        title: "Warm seal", clientName: "Acme Seals Inc", clientId: s.clientId, interviewer: "Priya Natarajan",
        status: "draft", createdBy: s.userId, ownerId: s.userId, shareToken: "cd-other", createdAt: 1, updatedAt: 1,
      });
      const draftId = await ctx.db.insert("intakeDrafts", {
        ownerId: s.userId, status: "open", createdAt: Date.now(), lastEditedAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000, transcriptCount: 0, clientName: "ACME SEALS",
      });
      const headStart = (await selectDraftEvidence(ctx, (await ctx.db.get(draftId))!)).companyNames;
      // Promoted: the project carries the draft's spelling and is the company's newest.
      await ctx.db.patch(s.projectId, { clientName: "ACME SEALS", createdAt: Date.now() });
      const firstRun = (await selectFrozenEvidence(ctx, s.projectId)).companyNames;
      return { headStart, firstRun };
    });
    expect(names.firstRun).toEqual(names.headStart);
    expect(names.headStart.organizations).toEqual(["Northgate Gaskets", "Acme Seals Inc", "Acme Seals"]);
    expect(names.headStart.people).toEqual(["Priya Natarajan"]);
  });

  it("a project relinked to another company stops sending the first company's files; a merge into the new one keeps them", async () => {
    const s = await setup();
    await addCompanyFile(s, "history.txt", "Acme history.");
    const generationId = await start(s);
    const contextDocs = async () =>
      (await s.t.query(internal.generations.getGenerationInput, { generationId }))?.contextDocs.map((doc) => doc.fileName);
    expect(await contextDocs()).toEqual(["history.txt"]);
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { clientId: s.otherClientId }));
    expect(await contextDocs()).toEqual([]);
    // Acme merged into Borealis: its files belong to the project's company again.
    await s.t.run(async (ctx) => ctx.db.patch(s.clientId, { status: "merged", mergedIntoClientId: s.otherClientId }));
    expect(await contextDocs()).toEqual(["history.txt"]);
  });

  it("the start dialog lists nothing for a viewer with no role, and the chips and labels hide nothing from one who may read", async () => {
    const s = await setup();
    await addCompanyFile(s, "history.txt", "Acme history.");
    await s.t.run(async (ctx) => ctx.db.insert("users", { authId: "company-drafts-roleless" }));
    const roleless = s.t.withIdentity({ subject: "company-drafts-roleless" });
    expect((await roleless.query(api.companyFiles.listForProject, { projectId: s.projectId })).files).toEqual([]);
    expect(visibleSourceLabel("company_file", "other:history.txt", false)).toBe("company file");
    expect(visibleSourceLabel("company_file", "other:history.txt", true)).toBe("other:history.txt");
    expect(visibleSourceLabel("project_document", "other:notes.txt", false)).toBe("other:notes.txt");
  });
});

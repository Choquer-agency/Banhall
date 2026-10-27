/// <reference types="vite/client" />
/**
 * 2026-10-26 (Phase C, step C1; decision "2026-10-26", part 1): company
 * files. Who may read, add, archive, restore and remove them; the log of
 * each change; duplicates; the server's reading; search pieces filed under
 * the company and searched only there; labels with the company's names
 * hidden; merging companies moves their files; removal and project erasure.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { getEffectiveCapabilityLevel } from "../shared/capabilities";
import { readCompanyFileText } from "./lib/companyFileText";
import { searchCompanyPieces } from "./lib/searchPieces";
import { MAX_FORMER_NAMES, MERGE_COMPANY_FILE_LIMIT } from "./clients";
import { DASHBOARD_UNNAMED_COMPANY_KEY } from "../shared/dashboardProjection";
import { SERVER_READER_VERSION } from "./lib/serverReading";
import { textPdf } from "./ai/testFiles.fixture";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const PAGES = ["Trial one held at 4.2 bar.", "Trial two failed at 3.1 bar."];

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: "cf-writer", role: "writer", email: "wendy@firm.com", name: "Wendy" });
    const managerId = await ctx.db.insert("users", { authId: "cf-manager", role: "manager", email: "mina@firm.com" });
    await ctx.db.insert("users", { authId: "cf-admin", role: "admin", email: "ada@firm.com" });
    await ctx.db.insert("users", { authId: "cf-roleless" });
    const client = (name: string) =>
      ctx.db.insert("clients", { name, nameKey: dashboardCompanyKey(name), status: "active", createdBy: managerId, createdAt: now, updatedAt: now });
    const acmeId = await client("Acme");
    const otherId = await client("Borealis");
    const project = (title: string, clientName: string, clientId?: Id<"clients">) =>
      ctx.db.insert("projects", {
        title,
        clientName,
        ...(clientId ? { clientId } : {}),
        dashboardCompanyKey: dashboardCompanyKey(clientName),
        interviewer: "Ivy Interviewer",
        interviewees: ["Quentin Quill"],
        status: "draft",
        createdBy: writerId,
        ownerId: writerId,
        shareToken: `${title}-token`,
        createdAt: now,
        updatedAt: now,
      });
    return {
      writerId,
      managerId,
      acmeId,
      otherId,
      acmeProjectId: await project("Seal", "Acme", acmeId),
      otherProjectId: await project("Valve", "Borealis", otherId),
    };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "cf-writer" }),
    manager: t.withIdentity({ subject: "cf-manager" }),
    admin: t.withIdentity({ subject: "cf-admin" }),
    roleless: t.withIdentity({ subject: "cf-roleless" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function add(
  s: Setup,
  clientId: Id<"clients">,
  fileName: string,
  content: string,
  extra: { storageId?: Id<"_storage">; fileType?: "txt" | "pdf" } = {}
) {
  return await s.writer.mutation(api.companyFiles.addCompanyFile, {
    clientId,
    fileName,
    fileType: extra.fileType ?? "txt",
    content,
    ...(extra.storageId ? { storageId: extra.storageId } : {}),
  });
}

async function events(s: Setup, clientId: Id<"clients">) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.query("companyFileEvents").withIndex("by_clientId_and_at", (q) => q.eq("clientId", clientId)).collect()).map(
      (event) => ({ action: event.action, fileName: event.fileName, ...(event.otherClientId ? { otherClientId: event.otherClientId } : {}) })
    )
  );
}

async function sweep(s: Setup) {
  await s.t.mutation(internal.searchPieces.sweepDueSearchPieces, {});
  await s.t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function search(s: Setup, clientId: Id<"clients">, query: string) {
  return await s.t.run(async (ctx) => await searchCompanyPieces(ctx, { clientId, query }));
}

describe("who may use company files", () => {
  test("the matrix: Consultants read and add, Managers and Admins also archive, restore and remove, Financial nothing", () => {
    expect(getEffectiveCapabilityLevel("writer", "companyFiles.read")).toBe("all");
    expect(getEffectiveCapabilityLevel("writer", "companyFiles.add")).toBe("all");
    expect(getEffectiveCapabilityLevel("writer", "companyFiles.manage")).toBe("none");
    for (const role of ["manager", "admin"] as const) {
      for (const capability of ["companyFiles.read", "companyFiles.add", "companyFiles.manage"] as const) {
        expect(getEffectiveCapabilityLevel(role, capability)).toBe("all");
      }
    }
    for (const capability of ["companyFiles.read", "companyFiles.add", "companyFiles.manage"] as const) {
      expect(getEffectiveCapabilityLevel("financial", capability)).toBe("none");
    }
  });

  test("a user with no role can do nothing; a Consultant cannot archive or remove", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme has sealed pumps since 2010.");
    const refusals = [
      s.roleless.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId }),
      s.roleless.query(api.companyFiles.getCompanyFileContent, { companyFileId: fileId }),
      s.roleless.query(api.companyFiles.companyForKey, { key: "acme" }),
      s.roleless.mutation(api.companyFiles.ensureCompanyForKey, { key: "acme" }),
      s.roleless.mutation(api.companyFiles.generateCompanyUploadUrl, {}),
      s.roleless.mutation(api.companyFiles.addCompanyFile, { clientId: s.acmeId, fileName: "a.txt", fileType: "txt", content: "x" }),
      s.roleless.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true }),
      s.roleless.mutation(api.companyFiles.removeCompanyFile, { companyFileId: fileId }),
      s.writer.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true }),
      s.writer.mutation(api.companyFiles.removeCompanyFile, { companyFileId: fileId }),
    ];
    for (const refusal of refusals) await expect(refusal).rejects.toThrow(/role is required|permission/);
    expect((await s.t.run(async (ctx) => ctx.db.get(fileId)))?.archived).toBeUndefined();
  });
});

describe("adding company files", () => {
  test("the text goes to pieces, the facts to the row, the add to the log, and the file is due for search pieces", async () => {
    const s = await setup();
    const text = "Acme has sealed pumps since 2010. ".repeat(2_000);
    const fileId = await add(s, s.acmeId, "history.txt", text);
    const file = (await s.t.run(async (ctx) => ctx.db.get(fileId)))!;
    expect(file).toMatchObject({
      clientId: s.acmeId,
      textLength: text.length,
      hasText: true,
      processingStatus: "ready",
      uploadedBy: s.writerId,
      uploaderRole: "writer",
      searchPiecesDue: true,
    });
    expect(await s.t.run(async (ctx) => readCompanyFileText(ctx, file))).toBe(text);
    expect((await s.writer.query(api.companyFiles.getCompanyFileContent, { companyFileId: fileId }))?.content).toBe(text);
    expect(await events(s, s.acmeId)).toEqual([{ action: "add", fileName: "history.txt" }]);
    const listed = await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId });
    expect(listed.files).toEqual([expect.objectContaining({ _id: fileId, fileName: "history.txt", addedBy: "Wendy", archived: false })]);
  });

  test("the same name with the same text is one file; unreadable files are never merged", async () => {
    const s = await setup();
    const first = await add(s, s.acmeId, "history.txt", "Acme history.");
    expect(await add(s, s.acmeId, "history.txt", "Acme history.")).toBe(first);
    expect(await add(s, s.acmeId, "notes.txt", "Acme history.")).not.toBe(first);
    const blankA = await add(s, s.acmeId, "scan.pdf", "", { fileType: "pdf" });
    const blankB = await add(s, s.acmeId, "scan.pdf", "", { fileType: "pdf" });
    expect(blankA).not.toBe(blankB);
    // Another company's identical file is its own.
    expect(await add(s, s.otherId, "history.txt", "Acme history.")).not.toBe(first);
  });

  test("a merged company refuses new files and names the company it joined", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.patch(s.otherId, { status: "merged", mergedIntoClientId: s.acmeId }));
    await expect(add(s, s.otherId, "late.txt", "Late file.")).rejects.toThrow(/merged into Acme/);
  });

  test("an original another row already holds cannot be attached", async () => {
    const s = await setup();
    const storageId = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["bytes"])));
    await add(s, s.acmeId, "one.txt", "One.", { storageId });
    await expect(add(s, s.acmeId, "two.txt", "Two.", { storageId })).rejects.toThrow(/already in use/);
  });

  test("a company page with no company row makes one from its projects and links them", async () => {
    const s = await setup();
    const projectId = await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("dashboardCompanies", { companyKey: "cedar", clientName: "Cedar", projectCount: 1, updatedAt: now });
      return await ctx.db.insert("projects", {
        title: "Cedar project", clientName: "Cedar", dashboardCompanyKey: "cedar", status: "draft",
        createdBy: s.writerId, ownerId: s.writerId, shareToken: "cedar-token", createdAt: now, updatedAt: now,
      });
    });
    expect(await s.writer.query(api.companyFiles.companyForKey, { key: "cedar" })).toBeNull();
    const made = await s.writer.mutation(api.companyFiles.ensureCompanyForKey, { key: "cedar" });
    expect(made.name).toBe("Cedar");
    expect((await s.t.run(async (ctx) => ctx.db.get(projectId)))?.clientId).toBe(made.clientId);
    expect(await s.writer.mutation(api.companyFiles.ensureCompanyForKey, { key: "cedar" })).toEqual(made);
    await expect(s.writer.mutation(api.companyFiles.ensureCompanyForKey, { key: "nobody" })).rejects.toThrow(/no projects/);
  });
});

describe("company rows, duplicates and retries (review, 2026-10-26)", () => {
  test("projects with no company name never get a company row", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.insert("dashboardCompanies", { companyKey: DASHBOARD_UNNAMED_COMPANY_KEY, clientName: "", projectCount: 2, updatedAt: Date.now() });
    });
    await expect(s.writer.mutation(api.companyFiles.ensureCompanyForKey, { key: DASHBOARD_UNNAMED_COMPANY_KEY })).rejects.toThrow(
      /no company name/
    );
    const rows = await s.t.run(async (ctx) => ctx.db.query("clients").withIndex("by_nameKey", (q) => q.eq("nameKey", DASHBOARD_UNNAMED_COMPANY_KEY)).collect());
    expect(rows).toEqual([]);
  });

  test("a company with more than one page of projects links them all", async () => {
    const s = await setup();
    const count = 230;
    await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("dashboardCompanies", { companyKey: "cedar", clientName: "Cedar", projectCount: count, updatedAt: now });
      for (let i = 0; i < count; i++) {
        await ctx.db.insert("projects", {
          title: `Cedar ${i}`, clientName: "Cedar", dashboardCompanyKey: "cedar", status: "draft",
          createdBy: s.writerId, ownerId: s.writerId, shareToken: `cedar-${i}`, createdAt: now, updatedAt: now,
          ...(i < 5 ? { deletionStartedAt: now } : {}),
        });
      }
    });
    const made = await s.writer.mutation(api.companyFiles.ensureCompanyForKey, { key: "cedar" });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const projects = await s.t.run(async (ctx) =>
      ctx.db.query("projects").withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", "cedar")).collect()
    );
    expect(projects.filter((project) => project.deletionStartedAt === undefined && project.clientId !== made.clientId)).toEqual([]);
    expect(projects.filter((project) => project.clientId === made.clientId)).toHaveLength(count - 5);
  });

  test("an archived copy never hides the active file with the same name and text", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const { companyFileTextFacts } = await import("./lib/companyFileText");
      const facts = await companyFileTextFacts("Acme history.");
      for (let i = 0; i < 25; i++) {
        await ctx.db.insert("companyFiles", {
          clientId: s.acmeId, fileName: "history.txt", fileType: "txt", ...facts, processingStatus: "ready",
          archived: true, uploadedBy: s.writerId, createdAt: Date.now(),
        });
      }
    });
    const active = await add(s, s.acmeId, "history.txt", "Acme history.");
    expect(await add(s, s.acmeId, "history.txt", "Acme history.")).toBe(active);
  });

  test("a retried save of an unreadable file finds the row the first save made", async () => {
    const s = await setup();
    const attemptKey = "33333333-3333-4333-8333-333333333333";
    const save = () =>
      s.writer.mutation(api.companyFiles.addCompanyFile, { clientId: s.acmeId, fileName: "scan.pdf", fileType: "pdf", content: "", attemptKey });
    const first = await save();
    expect(await save()).toBe(first);
    // Another file under the same key is a new file.
    const other = await s.writer.mutation(api.companyFiles.addCompanyFile, {
      clientId: s.acmeId, fileName: "other.pdf", fileType: "pdf", content: "", attemptKey,
    });
    expect(other).not.toBe(first);
    expect((await events(s, s.acmeId)).filter((event) => event.action === "add")).toHaveLength(2);
  });

  test("a retry after the server has read the file still finds the first row (review round 2)", async () => {
    const s = await setup();
    const attemptKey = "44444444-4444-4444-8444-444444444444";
    const storageId = await s.t.run(async (ctx) =>
      ctx.storage.store(new Blob([textPdf(PAGES) as BlobPart], { type: "application/pdf" }))
    );
    const save = () =>
      s.writer.mutation(api.companyFiles.addCompanyFile, {
        clientId: s.acmeId, fileName: "trials.pdf", fileType: "pdf", content: "", attemptKey, storageId,
      });
    const first = await save();
    await s.t.action(internal.ai.fileReading.readStoredCompanyFile, { companyFileId: first });
    expect((await s.t.run(async (ctx) => ctx.db.get(first)))?.hasText).toBe(true);
    expect(await save()).toBe(first);
    const rows = await s.t.run(async (ctx) =>
      ctx.db.query("companyFiles").withIndex("by_clientId_and_archived", (q) => q.eq("clientId", s.acmeId)).collect()
    );
    expect(rows).toHaveLength(1);
  });

  test("a repeat brings only an original the first lacked, and a second original is thrown away", async () => {
    const s = await setup();
    const store = () => s.t.run(async (ctx) => ctx.storage.store(new Blob(["bytes"])));
    const textOnly = await add(s, s.acmeId, "history.txt", "Acme history.");
    const first = await store();
    expect(await add(s, s.acmeId, "history.txt", "Acme history.", { storageId: first })).toBe(textOnly);
    expect((await s.t.run(async (ctx) => ctx.db.get(textOnly)))?.storageId).toBe(first);
    const second = await store();
    expect(await add(s, s.acmeId, "history.txt", "Acme history.", { storageId: second })).toBe(textOnly);
    expect(await s.t.run(async (ctx) => (await ctx.db.system.get(second)) !== null)).toBe(false);
    expect(await s.t.run(async (ctx) => (await ctx.db.system.get(first)) !== null)).toBe(true);
  });

  test("another user's claimed upload cannot be attached", async () => {
    const s = await setup();
    const storageId = await s.t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob(["bytes"]));
      await ctx.db.insert("uploadClaims", { storageId: id, userId: s.managerId, claimedAt: Date.now() });
      return id;
    });
    await expect(add(s, s.acmeId, "history.txt", "Acme history.", { storageId })).rejects.toThrow(/already in use/);
  });

  test("a company merged into one that was merged again points to the company it ended up in", async () => {
    const s = await setup();
    const thirdId = await s.t.run(async (ctx) =>
      ctx.db.insert("clients", { name: "Cascade", nameKey: "cascade", status: "active", createdBy: s.managerId, createdAt: 1, updatedAt: 1 })
    );
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.otherId, { status: "merged", mergedIntoClientId: s.acmeId });
      await ctx.db.patch(s.acmeId, { status: "merged", mergedIntoClientId: thirdId });
    });
    await expect(add(s, s.otherId, "late.txt", "Late.")).rejects.toThrow(/merged into Cascade/);
  });
});

describe("archiving, restoring and removing", () => {
  test("a Manager archives and restores; each change is logged; archived files list apart", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme history.");
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true });
    expect((await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId })).files).toEqual([]);
    expect((await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId, archived: true })).files).toHaveLength(1);
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: false });
    expect((await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId })).files).toHaveLength(1);
    expect((await events(s, s.acmeId)).map((event) => event.action)).toEqual(["add", "archive", "restore"]);
  });

  test("removal deletes the row, its text, its search pieces and its original, and is logged", async () => {
    const s = await setup();
    const storageId = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["bytes"])));
    const fileId = await add(s, s.acmeId, "history.txt", "Acme sealed pumps with graphite.", { storageId });
    await sweep(s);
    expect((await search(s, s.acmeId, "graphite")).hits).toHaveLength(1);
    await s.manager.mutation(api.companyFiles.removeCompanyFile, { companyFileId: fileId });
    const left = await s.t.run(async (ctx) => ({
      row: await ctx.db.get(fileId),
      texts: await ctx.db.query("companyFileTexts").withIndex("by_companyFileId_and_start", (q) => q.eq("companyFileId", fileId)).collect(),
      pieces: await ctx.db.query("documentSearchPieces").withIndex("by_companyFileId_and_order", (q) => q.eq("companyFileId", fileId)).collect(),
      original: await ctx.storage.get(storageId),
    }));
    expect(left).toEqual({ row: null, texts: [], pieces: [], original: null });
    expect((await events(s, s.acmeId)).map((event) => event.action)).toEqual(["add", "remove"]);
  });

  test("erasing a company's last project leaves its company files, their text and pieces", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme sealed pumps with graphite.");
    await sweep(s);
    await s.admin.mutation(api.projects.deleteProject, { projectId: s.acmeProjectId });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await s.t.run(async (ctx) => ({
      project: await ctx.db.get(s.acmeProjectId),
      file: await ctx.db.get(fileId),
      texts: (await ctx.db.query("companyFileTexts").withIndex("by_companyFileId_and_start", (q) => q.eq("companyFileId", fileId)).collect()).length,
      pieces: (await ctx.db.query("documentSearchPieces").withIndex("by_companyFileId_and_order", (q) => q.eq("companyFileId", fileId)).collect()).length,
    }));
    expect(left.project).toBeNull();
    expect(left.file?.clientId).toBe(s.acmeId);
    expect(left.texts).toBeGreaterThan(0);
    expect(left.pieces).toBeGreaterThan(0);
    expect((await search(s, s.acmeId, "graphite")).hits).toHaveLength(1);
  });

  test("restoring a file resumes the work skipped while it was archived", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme graphite.");
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true });
    await sweep(s);
    // Cut while archived; the label sweep retires an archived file.
    await s.t.mutation(internal.fileLabels.sweepDueFileLabels, {});
    expect((await s.t.run(async (ctx) => ctx.db.get(fileId)))?.labelsDue).toBeUndefined();
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: false });
    expect((await s.t.run(async (ctx) => ctx.db.get(fileId)))?.labelsDue).toBe(true);
  });

  test("restoring a file that still needs reading queues the reading, not labels from the old text", async () => {
    const s = await setup();
    const storageId = await s.t.run(async (ctx) =>
      ctx.storage.store(new Blob([textPdf(PAGES) as BlobPart], { type: "application/pdf" }))
    );
    const fileId = await add(s, s.acmeId, "trials.pdf", "[Stopped reading at page 1]", { storageId, fileType: "pdf" });
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true });
    await s.t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
      }
      await ctx.db.patch(fileId, { labelsDue: undefined });
    });
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: false });
    const file = await s.t.run(async (ctx) => ctx.db.get(fileId));
    expect(file?.labelsDue).toBeUndefined();
    const jobs = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.state.kind === "pending" && job.name.includes("readStoredCompanyFile"))).toHaveLength(1);
  });

  test("a scan archived while it was being read is read once it is restored", async () => {
    const s = await setup();
    const storageId = await s.t.run(async (ctx) =>
      ctx.storage.store(new Blob([textPdf(PAGES) as BlobPart], { type: "application/pdf" }))
    );
    const fileId = await add(s, s.acmeId, "trials.pdf", "", { storageId, fileType: "pdf" });
    const claim = await s.t.mutation(internal.companyFileWork.startCompanyFileReading, { companyFileId: fileId });
    expect(claim).not.toBeNull();
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true });
    expect(
      await s.t.mutation(internal.companyFileWork.saveCompanyFileReading, {
        companyFileId: fileId, expectedTextHash: claim!.textHash, text: PAGES.join("\n"), reader: SERVER_READER_VERSION,
      })
    ).toBe("changed");
    await s.t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
      }
    });
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: false });
    const jobs = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.state.kind === "pending" && job.name.includes("readStoredCompanyFile"))).toHaveLength(1);
  });
});

describe("search pieces and labels", () => {
  test("pieces are filed under the company and found only there, never for an archived file", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme sealed pumps with graphite packing in 2019.");
    await add(s, s.otherId, "valves.txt", "Borealis tested graphite valves.");
    await sweep(s);
    const pieces = await s.t.run(async (ctx) =>
      ctx.db.query("documentSearchPieces").withIndex("by_companyFileId_and_order", (q) => q.eq("companyFileId", fileId)).collect()
    );
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(piece.clientId).toBe(s.acmeId);
      expect(piece.projectId).toBeUndefined();
      expect(piece.documentId).toBeUndefined();
    }
    const found = await search(s, s.acmeId, "graphite packing");
    expect(found).toMatchObject({ complete: true, hits: [expect.objectContaining({ companyFileId: fileId, fileName: "history.txt" })] });
    // A project's own search never sees company pieces.
    const projectSearch = await s.t.query(internal.searchPieces.searchProject, { projectId: s.acmeProjectId, query: "graphite" });
    expect(projectSearch.hits).toEqual([]);
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true });
    expect((await search(s, s.acmeId, "graphite")).hits).toEqual([]);
  });

  test("a file moved to another company while it is being cut files its pieces under the new company", async () => {
    const s = await setup();
    const fileId = await add(s, s.otherId, "valves.txt", "Borealis tested graphite valves.");
    const target = (await s.t.query(internal.companyFileWork.companyFileToIndex, { companyFileId: fileId }))!;
    await s.t.run(async (ctx) => ctx.db.patch(fileId, { clientId: s.acmeId }));
    await s.t.mutation(internal.companyFileWork.writeCompanyFileSearchPieces, { companyFileId: fileId, textHash: target.textHash });
    expect((await search(s, s.acmeId, "graphite")).hits).toEqual([expect.objectContaining({ companyFileId: fileId })]);
    expect((await search(s, s.otherId, "graphite")).hits).toEqual([]);
  });

  test("the sweeps give company files the places project files leave", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme graphite.");
    expect(await s.t.mutation(internal.searchPieces.sweepDueSearchPieces, {})).toBe(1);
    const jobs = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.name.includes("indexCompanyFile"))).toEqual([
      expect.objectContaining({ args: [{ companyFileId: fileId }] }),
    ]);
  });

  test("a file not cut yet makes the search incomplete; cutting marks labels due", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme graphite.");
    expect((await search(s, s.acmeId, "graphite")).complete).toBe(false);
    await sweep(s);
    expect((await search(s, s.acmeId, "graphite")).complete).toBe(true);
    expect((await s.t.run(async (ctx) => ctx.db.get(fileId)))?.labelsDue).toBe(true);
  });

  test("a label call hides the company's names, its old names and its projects' people", async () => {
    const s = await setup();
    await s.t.run(async (ctx) =>
      ctx.db.insert("clients", {
        name: "Acme Holdings", nameKey: "acme holdings", status: "merged", mergedIntoClientId: s.acmeId,
        createdBy: s.managerId, createdAt: Date.now(), updatedAt: Date.now(),
      })
    );
    const fileId = await add(s, s.acmeId, "history.txt", "Acme Holdings hired Quentin Quill; Ivy Interviewer met him.");
    const input = (await s.t.query(internal.companyFileWork.companyLabelInput, { companyFileId: fileId }))!;
    const hidden = input.placeholders.map((entry) => entry.value);
    for (const name of ["Acme", "Acme Holdings", "Quentin Quill", "Ivy Interviewer"]) expect(hidden).toContain(name);
    // The other company's names are not in this company's map.
    expect(hidden).not.toContain("Borealis");
  });

  test("a label call reads past projects being erased to the newest live ones (review round 2)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 230; i++) {
        await ctx.db.insert("projects", {
          title: `Erasing ${i}`, clientName: "Acme", clientId: s.acmeId, status: "draft", interviewees: [`Gone Person ${i}`],
          createdBy: s.writerId, ownerId: s.writerId, shareToken: `erasing-${i}`, createdAt: now, updatedAt: now, deletionStartedAt: now,
        });
      }
    });
    const fileId = await add(s, s.acmeId, "history.txt", "Quentin Quill and Ivy Interviewer met.");
    const hidden = (await s.t.query(internal.companyFileWork.companyLabelInput, { companyFileId: fileId }))!.placeholders.map(
      (entry) => entry.value
    );
    expect(hidden).toContain("Quentin Quill");
    expect(hidden).toContain("Ivy Interviewer");
  });

  test("a company whose history is complete skips its merge tombstones", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.acmeId, { formerNames: ["Acme Elder"], nameHistoryComplete: true });
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("clients", {
          name: `Merged ${i}`, nameKey: `merged ${i}`, status: "merged", mergedIntoClientId: s.acmeId,
          createdBy: s.managerId, createdAt: 1, updatedAt: 1,
        });
      }
    });
    const fileId = await add(s, s.acmeId, "history.txt", "Acme Elder history.");
    const input = await s.t.query(internal.companyFileWork.companyLabelInput, { companyFileId: fileId });
    expect(input!.placeholders.map((entry) => entry.value)).toContain("Acme Elder");
  });

  test("a label call hides names from merges of merges and renames, and waits when the history is too long", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const old = await ctx.db.insert("clients", {
        name: "Acme Old Works", nameKey: "acme old works", status: "merged", mergedIntoClientId: s.otherId,
        createdBy: s.managerId, createdAt: 1, updatedAt: 1,
      });
      void old;
      await ctx.db.patch(s.otherId, { status: "merged", mergedIntoClientId: s.acmeId });
      await ctx.db.patch(s.acmeId, { formerNames: ["Acme Pumps Incorporated"] });
    });
    const fileId = await add(s, s.acmeId, "history.txt", "Acme Old Works, Borealis and Acme Pumps Incorporated.");
    const hidden = (await s.t.query(internal.companyFileWork.companyLabelInput, { companyFileId: fileId }))!.placeholders.map(
      (entry) => entry.value
    );
    for (const name of ["Acme Old Works", "Borealis", "Acme Pumps Incorporated"]) expect(hidden).toContain(name);

    await s.t.run(async (ctx) => {
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("clients", {
          name: `Merged ${i}`, nameKey: `merged ${i}`, status: "merged", mergedIntoClientId: s.acmeId,
          createdBy: s.managerId, createdAt: 1, updatedAt: 1,
        });
      }
    });
    await expect(s.t.query(internal.companyFileWork.companyLabelInput, { companyFileId: fileId })).rejects.toThrow(/More than 100 companies were merged/);
  });

  test("labels are kept only for the text and name they were made from", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme graphite.");
    const file = (await s.t.run(async (ctx) => ctx.db.get(fileId)))!;
    const save = (textHash: string) =>
      s.t.mutation(internal.companyFileWork.saveCompanyFileLabels, {
        companyFileId: fileId, textHash, fileName: "history.txt", model: "claude-haiku-5-5", promptVersion: "file-labels-2",
        labels: { documentType: "other", fiscalYear: null, title: "Acme history", summary: "How Acme seals pumps." },
      });
    expect(await save("not-the-hash")).toBe("changed");
    expect(await save(file.textHash)).toBe("kept");
    expect((await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId })).files[0]?.labels).toMatchObject({
      title: "Acme history",
    });
  });
});

describe("the server's reading", () => {
  test("a PDF the browser could not read is queued, read on the server, and kept", async () => {
    const s = await setup();
    const storageId = await s.t.run(async (ctx) =>
      ctx.storage.store(new Blob([textPdf(PAGES) as BlobPart], { type: "application/pdf" }))
    );
    const fileId = await add(s, s.acmeId, "trials.pdf", "", { storageId, fileType: "pdf" });
    const jobs = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.name.includes("readStoredCompanyFile"))).toEqual([
      expect.objectContaining({ args: [{ companyFileId: fileId }] }),
    ]);
    await s.t.action(internal.ai.fileReading.readStoredCompanyFile, { companyFileId: fileId });
    const file = (await s.t.run(async (ctx) => ctx.db.get(fileId)))!;
    expect(file).toMatchObject({ processingStatus: "ready", pageCount: 2, serverReader: SERVER_READER_VERSION, searchPiecesDue: true });
    const text = await s.t.run(async (ctx) => readCompanyFileText(ctx, file));
    for (const page of PAGES) expect(text).toContain(page);
    // Read once: not read again.
    expect(await s.t.mutation(internal.companyFileWork.startCompanyFileReading, { companyFileId: fileId })).toBeNull();
  });
});

describe("merging companies", () => {
  async function companyKeys(s: Setup) {
    await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("dashboardCompanies", { companyKey: "acme", clientName: "Acme", projectCount: 1, updatedAt: now });
      await ctx.db.insert("dashboardCompanies", { companyKey: "borealis", clientName: "Borealis", projectCount: 1, updatedAt: now });
    });
  }

  test("the merged company's files move to the kept company in the same step, logged on both, and are cut again", async () => {
    const s = await setup();
    await companyKeys(s);
    const moved = await add(s, s.otherId, "valves.txt", "Borealis tested graphite valves.");
    const archived = await add(s, s.otherId, "old.txt", "An old Borealis file.");
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: archived, archived: true });
    await sweep(s);
    expect((await search(s, s.otherId, "graphite")).hits).toHaveLength(1);

    const preview = await s.manager.query(api.clients.previewClientMerge, { keepKey: "acme", mergeKeys: ["borealis"] });
    expect(preview).toMatchObject({ companyFileCount: 2, tooManyCompanyFiles: false });
    await s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"] });

    for (const fileId of [moved, archived]) {
      expect((await s.t.run(async (ctx) => ctx.db.get(fileId)))?.clientId).toBe(s.acmeId);
    }
    expect((await s.t.run(async (ctx) => ctx.db.get(moved)))?.searchPiecesDue).toBe(true);
    // Until cut again, its old pieces count for neither company.
    expect((await search(s, s.otherId, "graphite")).hits).toEqual([]);
    expect((await search(s, s.acmeId, "graphite")).hits).toEqual([]);
    await sweep(s);
    expect((await search(s, s.acmeId, "graphite")).hits).toEqual([expect.objectContaining({ companyFileId: moved })]);

    expect((await events(s, s.otherId)).filter((event) => event.action === "merge_out")).toEqual([
      { action: "merge_out", fileName: "valves.txt", otherClientId: s.acmeId },
      { action: "merge_out", fileName: "old.txt", otherClientId: s.acmeId },
    ]);
    expect((await events(s, s.acmeId)).filter((event) => event.action === "merge_in")).toHaveLength(2);
    // The merged company takes no new files.
    await expect(add(s, s.otherId, "late.txt", "Late.")).rejects.toThrow(/merged into Acme/);
  });

  test("a merge that would leave more than the former name limit is refused whole", async () => {
    const s = await setup();
    await companyKeys(s);
    await s.t.run(async (ctx) =>
      ctx.db.patch(s.otherId, {
        formerNames: Array.from({ length: MAX_FORMER_NAMES }, (_, i) => `Borealis ${i}`),
        nameHistoryComplete: true,
      })
    );
    await expect(s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"] })).rejects.toThrow(
      /former names/
    );
    expect((await s.t.run(async (ctx) => ctx.db.get(s.otherId)))?.status).toBe("active");
  });

  test("linking a new company's projects stops when the company is merged meanwhile", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("dashboardCompanies", { companyKey: "cedar", clientName: "Cedar", projectCount: 230, updatedAt: now });
      for (let i = 0; i < 230; i++) {
        await ctx.db.insert("projects", {
          title: `Cedar ${i}`, clientName: "Cedar", dashboardCompanyKey: "cedar", status: "draft",
          createdBy: s.writerId, ownerId: s.writerId, shareToken: `cedar-m-${i}`, createdAt: now, updatedAt: now,
        });
      }
    });
    const made = await s.writer.mutation(api.companyFiles.ensureCompanyForKey, { key: "cedar" });
    await s.t.run(async (ctx) => ctx.db.patch(made.clientId, { status: "merged", mergedIntoClientId: s.acmeId }));
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const linked = await s.t.run(async (ctx) =>
      (await ctx.db.query("projects").withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", "cedar")).collect()).filter(
        (project) => project.clientId === made.clientId
      ).length
    );
    expect(linked).toBe(200);
  });

  test("the kept company keeps every former name: its own before a rename and the merged companies'", async () => {
    const s = await setup();
    await companyKeys(s);
    await s.t.run(async (ctx) => ctx.db.patch(s.otherId, { formerNames: ["Borealis Old"] }));
    const result = await s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"], name: "Acme Group" });
    const kept = await s.t.run(async (ctx) => ctx.db.get(result.clientId));
    expect(kept?.name).toBe("Acme Group");
    expect([...(kept?.formerNames ?? [])].sort()).toEqual(["Acme", "Borealis", "Borealis Old"]);
  });

  test("a merge that would move more than the file limit is refused whole", async () => {
    const s = await setup();
    await companyKeys(s);
    await s.t.run(async (ctx) => {
      for (let i = 0; i <= MERGE_COMPANY_FILE_LIMIT; i++) {
        await ctx.db.insert("companyFiles", {
          clientId: s.otherId, fileName: `f${i}.txt`, fileType: "txt", textLength: 0, hasText: false, textHash: "empty",
          textPreview: "", wordCount: 0, processingStatus: "could_not_read", uploadedBy: s.writerId, createdAt: Date.now(),
        });
      }
    });
    const preview = await s.manager.query(api.clients.previewClientMerge, { keepKey: "acme", mergeKeys: ["borealis"] });
    expect(preview.tooManyCompanyFiles).toBe(true);
    await expect(s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"] })).rejects.toThrow(
      /company files/
    );
    expect((await s.t.run(async (ctx) => ctx.db.get(s.otherId)))?.status).toBe("active");
  });
});

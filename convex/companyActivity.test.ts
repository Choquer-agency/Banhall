/// <reference types="vite/client" />
/**
 * 2026-11-04 (the company profile: Activity): one list, newest first, of
 * company file changes, website reads (logged when a read finishes),
 * projects started, drafts started (a move into Drafting) and stage moves.
 * Bounded reads (the 50 newest live projects, 25 rows a page with an exact
 * cursor, so rows logged at one time are never skipped), the person and kind
 * filters, and which rows each role reads.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { activitySources, COMPANY_ACTIVITY_PAGE_SIZE, MAX_ACTIVITY_PROJECTS } from "./companyActivity";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse("2026-10-01T12:00:00Z");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const wendyId = await ctx.db.insert("users", { authId: "ca-writer", role: "writer", firstName: "Wendy", lastName: "Writer" });
    const minaId = await ctx.db.insert("users", { authId: "ca-manager", role: "manager", firstName: "Mina", lastName: "Manager" });
    await ctx.db.insert("users", { authId: "ca-roleless" });
    const acmeId = await ctx.db.insert("clients", {
      name: "Acme",
      nameKey: "acme",
      status: "active",
      createdBy: minaId,
      createdAt: BASE,
      updatedAt: BASE,
    });
    return { wendyId, minaId, acmeId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "ca-writer" }),
    manager: t.withIdentity({ subject: "ca-manager" }),
    roleless: t.withIdentity({ subject: "ca-roleless" }),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function project(s: Setup, title: string, extra: { clientName?: string; deleting?: boolean; fiscalYearEnd?: number } = {}) {
  const clientName = extra.clientName ?? "Acme";
  return await s.t.run(async (ctx) =>
    ctx.db.insert("projects", {
      title,
      clientName,
      ...(clientName === "Acme" ? { clientId: s.acmeId } : {}),
      dashboardCompanyKey: dashboardCompanyKey(clientName),
      status: "draft",
      createdBy: s.wendyId,
      ownerId: s.wendyId,
      shareToken: `${title}-token`,
      createdAt: BASE,
      updatedAt: BASE,
      ...(extra.fiscalYearEnd !== undefined ? { fiscalYearEnd: extra.fiscalYearEnd } : {}),
      ...(extra.deleting ? { deletionStartedAt: BASE } : {}),
    })
  );
}

type Stage = "intake" | "drafting" | "internal_review";
async function stage(s: Setup, projectId: Id<"projects">, at: number, actorId: Id<"users">, to: Stage, from?: Stage) {
  await s.t.run(async (ctx) =>
    ctx.db.insert("projectEvents", {
      projectId,
      type: "stage_changed",
      actorId,
      at,
      to,
      ...(from ? { from } : { note: "creation:initial-stage" }),
    })
  );
}

async function fileEvent(s: Setup, at: number, action: "add" | "archive" | "restore" | "remove" | "merge_in", fileName: string, userId: Id<"users">) {
  await s.t.run(async (ctx) => {
    const companyFileId = await ctx.db.insert("companyFiles", {
      clientId: s.acmeId,
      fileName,
      fileType: "txt",
      textLength: 1,
      hasText: true,
      textHash: fileName,
      textPreview: "x",
      wordCount: 1,
      processingStatus: "ready",
      uploadedBy: userId,
      createdAt: at,
    } as never);
    await ctx.db.insert("companyFileEvents", { clientId: s.acmeId, companyFileId, fileName, action, userId, at });
  });
}

async function websiteRead(s: Setup, at: number, outcome: "saved" | "unchanged" | "failed", userId: Id<"users">) {
  await s.t.run(async (ctx) =>
    ctx.db.insert("companyWebsiteReads", {
      clientId: s.acmeId,
      url: "https://acme.example",
      host: "acme.example",
      outcome,
      ...(outcome === "failed" ? { reason: "the site did not answer." } : {}),
      userId,
      at,
    })
  );
}

type Args = { cursor?: string | null; personId?: Id<"users">; kind?: "files" | "projects" | "stages" | "drafts" | "website" };

async function page(s: Setup, args: Args = {}, viewer = s.writer) {
  return await viewer.query(api.companyActivity.listCompanyActivity, { companyKey: "acme", ...args });
}

/** Every entry, page after page, until the cursor runs out. */
async function all(s: Setup, args: Args = {}) {
  const entries: Awaited<ReturnType<typeof page>>["entries"] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const result = await page(s, { ...args, cursor });
    expect(result.entries.length).toBeLessThanOrEqual(COMPANY_ACTIVITY_PAGE_SIZE + 2);
    entries.push(...result.entries);
    cursor = result.continueCursor;
    if (cursor === null) return entries;
  }
  throw new Error("Activity never ran out");
}

describe("the company's activity", () => {
  test("merges every source newest first, naming who, what and the project or file", async () => {
    const s = await setup();
    const seal = await project(s, "Seal", { fiscalYearEnd: Date.parse("2026-09-30T00:00:00Z") });
    await stage(s, seal, BASE + 1 * DAY, s.wendyId, "intake");
    await fileEvent(s, BASE + 2 * DAY, "add", "org chart.pdf", s.wendyId);
    await stage(s, seal, BASE + 3 * DAY, s.minaId, "drafting", "intake");
    await websiteRead(s, BASE + 4 * DAY, "saved", s.minaId);
    await fileEvent(s, BASE + 5 * DAY, "archive", "org chart.pdf", s.minaId);
    await fileEvent(s, BASE + 6 * DAY, "merge_in", "moved.txt", s.minaId);
    await stage(s, seal, BASE + 7 * DAY, s.wendyId, "internal_review", "drafting");
    // Back into Drafting from review is a stage move, not a new draft.
    await stage(s, seal, BASE + 8 * DAY, s.wendyId, "drafting", "internal_review");
    await websiteRead(s, BASE + 9 * DAY, "failed", s.minaId);

    const result = await page(s);
    expect(result.continueCursor).toBeNull();
    expect(result.projectsTruncated).toBe(false);
    expect(result.entries.map((entry) => entry.kind)).toEqual([
      "website",
      "stage_moved",
      "stage_moved",
      "file",
      "website",
      "draft_started",
      "file",
      "project_started",
    ]);
    const [failed, back, review, archived, read, draft, added, started] = result.entries;
    expect(failed).toMatchObject({ host: "acme.example", outcome: "failed", reason: "the site did not answer." });
    expect(back).toMatchObject({ fromStage: "internal_review", toStage: "drafting" });
    expect(review).toMatchObject({ fromStage: "drafting", toStage: "internal_review", project: { title: "Seal" } });
    expect(archived).toMatchObject({ action: "archived", fileName: "org chart.pdf", actor: { label: "Mina Manager" } });
    expect(read).toMatchObject({ host: "acme.example", outcome: "read", reason: null, actor: { userId: s.minaId } });
    expect(draft).toMatchObject({ project: { id: seal, title: "Seal" }, actor: { label: "Mina Manager", initials: "MM" } });
    expect(added).toMatchObject({ action: "added", fileName: "org chart.pdf" });
    expect(started).toMatchObject({ fiscalYear: 2026, project: { title: "Seal" }, actor: { userId: s.wendyId } });
  });

  test("filters by kind and by person", async () => {
    const s = await setup();
    const seal = await project(s, "Seal");
    await stage(s, seal, BASE + 1 * DAY, s.wendyId, "intake");
    await stage(s, seal, BASE + 2 * DAY, s.minaId, "drafting", "intake");
    await fileEvent(s, BASE + 3 * DAY, "add", "a.txt", s.wendyId);
    await fileEvent(s, BASE + 4 * DAY, "remove", "a.txt", s.minaId);
    await websiteRead(s, BASE + 5 * DAY, "unchanged", s.minaId);
    await stage(s, seal, BASE + 6 * DAY, s.minaId, "internal_review", "drafting");

    const kinds = async (args: Args) => (await page(s, args)).entries.map((entry) => entry.kind);
    expect(await kinds({ kind: "files" })).toEqual(["file", "file"]);
    expect(await kinds({ kind: "website" })).toEqual(["website"]);
    expect(await kinds({ kind: "projects" })).toEqual(["project_started"]);
    expect(await kinds({ kind: "stages" })).toEqual(["stage_moved"]);
    expect(await kinds({ kind: "drafts" })).toEqual(["draft_started"]);
    const wendy = (await page(s, { personId: s.wendyId })).entries;
    expect(wendy.map((entry) => entry.kind)).toEqual(["file", "project_started"]);
    expect(wendy.every((entry) => entry.actor?.userId === s.wendyId)).toBe(true);
    expect(await kinds({ personId: s.minaId, kind: "files" })).toEqual(["file"]);
  });

  test("a saved read's file add stays folded into its website row across a page boundary and under Files", async () => {
    const s = await setup();
    // As finishWebsiteRead logs them: the file's add, then the read, at one time.
    const fileId = await s.t.run(async (ctx) => {
      const companyFileId = await ctx.db.insert("companyFiles", {
        clientId: s.acmeId,
        fileName: "Website: acme.example",
        fileType: "txt",
        textLength: 1,
        hasText: true,
        textHash: "site",
        textPreview: "x",
        wordCount: 1,
        processingStatus: "ready",
        uploadedBy: s.minaId,
        createdAt: BASE,
      });
      await ctx.db.insert("companyFileEvents", { clientId: s.acmeId, companyFileId, fileName: "Website: acme.example", action: "add", userId: s.minaId, at: BASE });
      await ctx.db.insert("companyWebsiteReads", {
        clientId: s.acmeId,
        url: "https://acme.example",
        host: "acme.example",
        outcome: "saved",
        companyFileId,
        userId: s.minaId,
        at: BASE,
      });
      return companyFileId;
    });
    // An older row, so a second page exists, and 24 newer rows, so the first
    // page ends on the website row.
    await fileEvent(s, BASE - 1, "add", "older.txt", s.wendyId);
    for (let index = 1; index <= COMPANY_ACTIVITY_PAGE_SIZE - 1; index++) {
      await fileEvent(s, BASE + index, "add", `newer${index}.txt`, s.wendyId);
    }
    const first = await page(s);
    expect(first.entries).toHaveLength(COMPANY_ACTIVITY_PAGE_SIZE);
    expect(first.entries.at(-1)).toMatchObject({ kind: "website", outcome: "read" });
    expect(first.continueCursor).not.toBeNull();
    const second = await page(s, { cursor: first.continueCursor });
    expect(second.entries).toMatchObject([{ kind: "file", fileName: "older.txt" }]);
    expect(second.continueCursor).toBeNull();

    const files = await all(s, { kind: "files" });
    expect(files).toHaveLength(COMPANY_ACTIVITY_PAGE_SIZE);
    expect(files.some((entry) => entry.kind === "file" && entry.fileId === fileId)).toBe(false);
    // A later change of that file still shows under Files.
    await s.t.run(async (ctx) =>
      ctx.db.insert("companyFileEvents", { clientId: s.acmeId, companyFileId: fileId, fileName: "Website: acme.example", action: "archive", userId: s.minaId, at: BASE + 100 })
    );
    expect((await page(s, { kind: "files" })).entries[0]).toMatchObject({ action: "archived", fileId });
  });

  test("a file uploaded with a website-like name is a file, not a website read", async () => {
    const s = await setup();
    await fileEvent(s, BASE, "add", "Website: fake.example", s.wendyId);
    expect((await page(s)).entries).toMatchObject([{ kind: "file", action: "added", fileName: "Website: fake.example" }]);
  });

  test("every finished website read is logged: saved, unchanged and failed, with the saved file's add folded in", async () => {
    vi.useFakeTimers({ now: BASE });
    try {
      const s = await setup();
      const url = "https://www.acme.example";
      const start = async (requestedAt: number) =>
        s.t.run(async (ctx) => ctx.db.patch(s.acmeId, { website: url, websiteRead: { url, status: "reading", requestedAt } }));
      const finish = (requestedAt: number, result: { ok: true; text: string; title: null; pages: string[] } | { ok: false; reason: string }) =>
        s.t.mutation(internal.companyWebsite.finishWebsiteRead, { clientId: s.acmeId, url, requestedAt, userId: s.minaId, result });
      const page1 = { ok: true as const, text: "Acme makes pumps.", title: null, pages: [url] };
      await start(1);
      await finish(1, page1);
      vi.setSystemTime(BASE + DAY);
      await start(2);
      await finish(2, page1);
      vi.setSystemTime(BASE + 2 * DAY);
      await start(3);
      await finish(3, { ok: false, reason: "the site did not answer." });
      const reads = await s.t.run(async (ctx) =>
        (await ctx.db.query("companyWebsiteReads").withIndex("by_clientId_and_at", (q) => q.eq("clientId", s.acmeId)).collect()).map(
          (read) => [read.outcome, read.host, read.reason ?? null, Boolean(read.companyFileId)]
        )
      );
      expect(reads).toEqual([
        ["saved", "acme.example", null, true],
        ["unchanged", "acme.example", null, true],
        ["failed", "acme.example", "the site did not answer.", false],
      ]);
      const entries = (await page(s)).entries;
      // A failed read archives the file the last one saved; the saved file's
      // own `add` is folded into its website row.
      expect(entries.map((entry) => (entry.kind === "website" ? entry.outcome : entry.kind === "file" ? entry.action : entry.kind))).toEqual([
        "archived",
        "failed",
        "read",
        "read",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("reads every row logged at one time, page after page (a bulk change)", async () => {
    const s = await setup();
    const seal = await project(s, "Seal");
    await s.t.run(async (ctx) => {
      for (let index = 0; index < 120; index++) {
        const companyFileId = await ctx.db.insert("companyFiles", {
          clientId: s.acmeId,
          fileName: `bulk${index}.txt`,
          fileType: "txt",
          textLength: 1,
          hasText: true,
          textHash: `bulk${index}`,
          textPreview: "x",
          wordCount: 1,
          processingStatus: "ready",
          uploadedBy: s.minaId,
          createdAt: BASE,
        });
        await ctx.db.insert("companyFileEvents", { clientId: s.acmeId, companyFileId, fileName: `bulk${index}.txt`, action: "archive", userId: s.minaId, at: BASE });
      }
    });
    for (let index = 0; index < 15; index++) await stage(s, seal, BASE, s.wendyId, "drafting", "intake");
    await stage(s, seal, BASE + 1, s.wendyId, "internal_review", "drafting");
    await stage(s, seal, BASE - 1, s.wendyId, "intake");
    const entries = await all(s);
    expect(entries).toHaveLength(137);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(137);
    expect(entries[0].kind).toBe("stage_moved");
    expect(entries.at(-1)?.kind).toBe("project_started");
    expect(entries.filter((entry) => entry.kind === "file")).toHaveLength(120);
  });

  test("pages 25 rows at a time with a cursor, skipping and repeating nothing", async () => {
    const s = await setup();
    const seal = await project(s, "Seal");
    const expected: number[] = [];
    for (let index = 0; index < 40; index++) {
      await fileEvent(s, BASE + index * 1000, "add", `f${index}.txt`, s.wendyId);
      expected.push(BASE + index * 1000);
    }
    for (let index = 0; index < 30; index++) {
      await stage(s, seal, BASE + index * 1000 + 500, s.minaId, "drafting", "intake");
      expected.push(BASE + index * 1000 + 500);
    }
    const first = await page(s);
    expect(first.entries).toHaveLength(COMPANY_ACTIVITY_PAGE_SIZE);
    expect(first.continueCursor).not.toBeNull();
    const entries = await all(s);
    expect(entries.map((entry) => entry.at)).toEqual(expected.sort((a, b) => b - a));
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(70);
  });

  test("a person filter pages through every one of that person's rows", async () => {
    const s = await setup();
    const seal = await project(s, "Seal");
    for (let index = 0; index < 120; index++) {
      await fileEvent(s, BASE + index * 1000, "add", `other${index}.txt`, s.minaId);
    }
    for (let index = 0; index < 7; index++) {
      await stage(s, seal, BASE + index * 17_000 + 1, s.wendyId, "drafting", "intake");
      await fileEvent(s, BASE + index * 17_000 + 2, "add", `mine${index}.txt`, s.wendyId);
    }
    const entries = await all(s, { personId: s.wendyId });
    expect(entries).toHaveLength(14);
    expect(entries.every((entry) => entry.actor?.userId === s.wendyId)).toBe(true);
    expect(entries.map((entry) => entry.at)).toEqual([...entries.map((entry) => entry.at)].sort((a, b) => b - a));
  });

  test(`reads only the ${MAX_ACTIVITY_PROJECTS} newest live projects and says so`, async () => {
    const s = await setup();
    const oldest = await project(s, "Oldest");
    await stage(s, oldest, BASE, s.wendyId, "intake");
    for (let index = 0; index < MAX_ACTIVITY_PROJECTS; index++) {
      const id = await project(s, `P${index}`);
      if (index === 0) await stage(s, id, BASE + 1, s.wendyId, "intake");
    }
    const deleting = await project(s, "Deleting", { deleting: true });
    await stage(s, deleting, BASE + 2, s.wendyId, "intake");
    const result = await page(s, { kind: "projects" });
    expect(result.projectsTruncated).toBe(true);
    expect(result.entries.map((entry) => entry.kind === "project_started" && entry.project.title)).toEqual(["P0"]);
  });

  test("a company known only by its projects lists its project rows", async () => {
    const s = await setup();
    const pump = await project(s, "Pump", { clientName: "Cedar" });
    await stage(s, pump, BASE, s.wendyId, "intake");
    const result = await s.writer.query(api.companyActivity.listCompanyActivity, { companyKey: "cedar" });
    expect(result.entries.map((entry) => entry.kind)).toEqual(["project_started"]);
  });

  test("refuses a viewer with no role or no sign-in", async () => {
    const s = await setup();
    await expect(page(s, {}, s.roleless)).rejects.toThrow();
    await expect(s.t.query(api.companyActivity.listCompanyActivity, { companyKey: "acme" })).rejects.toThrow();
  });

  test("which rows each role reads: Financial reads project rows, no file or website rows", () => {
    // No stored role is Financial yet (users.role is writer, manager or
    // admin), so the rule is checked through the real capability matrix.
    expect(activitySources("financial")).toEqual({ projects: true, files: false });
    for (const role of ["writer", "manager", "admin"] as const) expect(activitySources(role)).toEqual({ projects: true, files: true });
    expect(activitySources(undefined)).toEqual({ projects: false, files: false });
  });
});

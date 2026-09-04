/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { fiscalYearEndFromLabel } from "./lib/ingestionClassify";
import { dashboardCompanyKey } from "../shared/dashboardProjection";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      authId: "port-admin",
      role: "admin",
      firstName: "Admin",
    });
    await ctx.db.insert("users", {
      authId: "port-writer",
      role: "writer",
      firstName: "Writer",
    });
  });
  return {
    t,
    admin: t.withIdentity({ subject: "port-admin" }),
    writer: t.withIdentity({ subject: "port-writer" }),
  };
}

async function insertApprovedPd(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {}
) {
  return await t.run((ctx) =>
    ctx.db.insert("ingestionItems", {
      driveItemId: `drive-${crypto.randomUUID()}`,
      path: "Acme/2025 - Dec 31/Submitted/PD1 - Widget.docx",
      name: "PD1 - Widget.docx",
      clientName: "Acme",
      fiscalYearLabel: "2025 - Dec 31",
      fiscalYear: 2025,
      docKind: "pd",
      size: 1024,
      lastModifiedAt: Date.now(),
      contentHash: crypto.randomUUID(),
      text: "Historical PD body text",
      status: "approved",
      pairGroupKey: "Acme::2025 - Dec 31",
      updatedAt: Date.now(),
      ...overrides,
    } as never)
  );
}

describe("fiscalYearEndFromLabel", () => {
  it("parses a month-day suffix and falls back to Dec 31", () => {
    expect(fiscalYearEndFromLabel("2025 - Dec 31", 2025)).toBe(Date.UTC(2025, 11, 31));
    expect(fiscalYearEndFromLabel("2024 - Jun 30", 2024)).toBe(Date.UTC(2024, 5, 30));
    expect(fiscalYearEndFromLabel("2024 - September 5", 2024)).toBe(Date.UTC(2024, 8, 5));
    expect(fiscalYearEndFromLabel("FY2024", 2024)).toBe(Date.UTC(2024, 11, 31));
    expect(fiscalYearEndFromLabel(undefined, 2023)).toBe(Date.UTC(2023, 11, 31));
  });
});

describe("ingestion port to project", () => {
  it("creates a historical project with wizard insert conventions", async () => {
    const f = await setup();
    const itemId = await insertApprovedPd(f.t);

    const result = await f.admin.action(api.ingestionPort.portItemToProject, { itemId });
    expect(result.created).toBe(true);

    const project = await f.t.run((ctx) => ctx.db.get(result.projectId));
    expect(project).toMatchObject({
      clientName: "Acme",
      title: "Acme — Fiscal 2025 (historical)",
      workflowStage: "intake",
      projectType: "writing",
      status: "draft",
      dashboardCompanyKey: dashboardCompanyKey("Acme"),
      dashboardFiscalYearRank: -2025,
      fiscalYearEnd: Date.UTC(2025, 11, 31),
    });
    expect(project!.ownerId).toBe(project!.createdBy);

    const events = await f.t.run((ctx) =>
      ctx.db
        .query("projectEvents")
        .withIndex("by_projectId", (q) => q.eq("projectId", result.projectId))
        .collect()
    );
    expect(events.map((e) => e.note).sort()).toEqual([
      "creation:ingestion-port",
      "creation:initial-owner",
    ]);

    const transcript = await f.t.run((ctx) =>
      ctx.db
        .query("transcripts")
        .withIndex("by_projectId", (q) => q.eq("projectId", result.projectId))
        .first()
    );
    expect(transcript?.content).toBe("");

    const docs = await f.t.run((ctx) =>
      ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", result.projectId))
        .collect()
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      fileName: "PD1 - Widget.docx",
      fileType: "docx",
      content: "Historical PD body text",
      source: "ingestion_port",
      category: "previous_pd",
      // CAP-3: the porting admin is the internal author of this row.
      uploaderRole: "admin",
    });

    const item = await f.t.run((ctx) => ctx.db.get(itemId));
    expect(item?.portedProjectId).toBe(result.projectId);
    expect(item?.portedDocumentId).toBe(docs[0]._id);
  });

  it("attaches to the one existing matching project instead of creating", async () => {
    const f = await setup();
    const first = await insertApprovedPd(f.t);
    const firstResult = await f.admin.action(api.ingestionPort.portItemToProject, {
      itemId: first,
    });

    const second = await insertApprovedPd(f.t, {
      name: "PD2 - Gadget.docx",
      path: "Acme/2025 - Dec 31/Submitted/PD2 - Gadget.docx",
    });
    const secondResult = await f.admin.action(api.ingestionPort.portItemToProject, {
      itemId: second,
    });
    expect(secondResult.created).toBe(false);
    expect(secondResult.projectId).toBe(firstResult.projectId);

    const docs = await f.t.run((ctx) =>
      ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", firstResult.projectId))
        .collect()
    );
    expect(docs).toHaveLength(2);
  });

  it("fails closed when more than one project matches", async () => {
    const f = await setup();
    const itemId = await insertApprovedPd(f.t);
    // Two pre-existing projects for the same normalized client + fiscal year.
    await f.t.run(async (ctx) => {
      const creator = (await ctx.db.query("users").take(1))[0];
      for (const title of ["Acme A", "Acme B"]) {
        await ctx.db.insert("projects", {
          title,
          clientName: "Acme",
          dashboardCompanyKey: dashboardCompanyKey("Acme"),
          dashboardFiscalYearRank: -2025,
          fiscalYearEnd: Date.UTC(2025, 11, 31),
          workflowStage: "intake",
          workflowVersion: 0,
          status: "draft",
          createdBy: creator._id,
          shareToken: `test-token-${title}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as never);
      }
    });
    await expect(
      f.admin.action(api.ingestionPort.portItemToProject, { itemId })
    ).rejects.toThrow(/More than one project matches/);
  });

  it("re-porting is an idempotent no-op returning the same project", async () => {
    const f = await setup();
    const itemId = await insertApprovedPd(f.t);
    const first = await f.admin.action(api.ingestionPort.portItemToProject, { itemId });
    const second = await f.admin.action(api.ingestionPort.portItemToProject, { itemId });
    expect(second.created).toBe(false);
    expect(second.projectId).toBe(first.projectId);
    const docs = await f.t.run((ctx) =>
      ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", first.projectId))
        .collect()
    );
    expect(docs).toHaveLength(1);
  });

  it("rejects non-admins, non-PDs, and unapproved items", async () => {
    const f = await setup();
    const itemId = await insertApprovedPd(f.t);
    await expect(
      f.writer.action(api.ingestionPort.portItemToProject, { itemId })
    ).rejects.toThrow(/Admin only/);

    const transcript = await insertApprovedPd(f.t, { docKind: "transcript" });
    await expect(
      f.admin.action(api.ingestionPort.portItemToProject, { itemId: transcript })
    ).rejects.toThrow(/Only PDs/);

    const pending = await insertApprovedPd(f.t, { status: "pending_review" });
    await expect(
      f.admin.action(api.ingestionPort.portItemToProject, { itemId: pending })
    ).rejects.toThrow(/Only approved/);
  });
});

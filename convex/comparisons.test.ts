/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// AD-29 (story 6, CAP-16): the Paired Comparison record is the Success
// signal's only durable home. Every judgement field is human-entered; the
// server resolves only the pin, `recordedAt` and `draftTextMatches`.

const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [
        { type: "text", text: "Line 242 — Scientific/Technological Uncertainty" },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "The team could not predict the fatigue limit of the alloy.",
        },
      ],
    },
    { type: "horizontalRule" },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Line 244 — Work Performed" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "The team ran a coupon fatigue series." }],
    },
    { type: "horizontalRule" },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [
        { type: "text", text: "Line 246 — Scientific/Technological Advancement" },
      ],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "A revised fatigue model resulted." }],
    },
  ],
});

/** The blinded strip a third person hands the judge: reformatted, headings dropped. */
const BLINDED_STRIP = [
  "   The team could not   predict the fatigue limit of the alloy.",
  "",
  "\tThe team ran a coupon fatigue series.",
  "",
  "A revised fatigue model resulted.   ",
].join("\r\n");

const OTHER_DRAFT = "A wholly different draft about thermal cycling of ceramics.";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", {
      authId: "cmp-admin",
      role: "admin",
      firstName: "Johnny",
    });
    const judgeId = await ctx.db.insert("users", {
      authId: "cmp-writer",
      role: "writer",
      firstName: "Larry",
      lastName: "Hall",
    });
    await ctx.db.insert("users", {
      authId: "cmp-manager",
      role: "manager",
      firstName: "Michael",
    });
    // Mapped and signed in, but holds no internal role.
    await ctx.db.insert("users", { authId: "cmp-roleless", firstName: "Rory" });
    const strangerId = await ctx.db.insert("users", {
      authId: "cmp-stranger",
      firstName: "Nobody",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      createdBy: adminId,
      shareToken: "cmp-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: REPORT_DOC,
      version: 1,
      revisionNumber: 3,
      generatedAt: now,
      updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Thermal cycling PD",
      clientName: "Beta Ceramics",
      status: "review",
      createdBy: adminId,
      shareToken: "cmp-token-2",
      createdAt: now,
      updatedAt: now,
    });
    const otherReportId = await ctx.db.insert("reports", {
      projectId: otherProjectId,
      content: REPORT_DOC,
      version: 1,
      revisionNumber: 0,
      generatedAt: now,
      updatedAt: now,
    });
    return {
      adminId,
      judgeId,
      strangerId,
      projectId,
      reportId,
      otherProjectId,
      otherReportId,
    };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "cmp-admin" }),
    writer: t.withIdentity({ subject: "cmp-writer" }),
    manager: t.withIdentity({ subject: "cmp-manager" }),
    roleless: t.withIdentity({ subject: "cmp-roleless" }),
    anonymous: t,
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/** Typed domain-error code of a rejected call, or a marker for other outcomes. */
async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) {
      return String((data as { code: unknown }).code);
    }
    return `UNTYPED: ${(error as Error).message}`;
  }
  return "NO_ERROR";
}

function recordArgs(f: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    reportId: f.reportId,
    expectedRevisionNumber: 3,
    banhallModel: "Sonnet 5",
    baselineProduct: "ChatGPT",
    baselineModel: "GPT-5.6 Sol",
    modelCaveat:
      "Q15 unresolved: openai/gpt-5.6-sol via OpenRouter may not match Sol inside ChatGPT.",
    judgeUserId: f.judgeId,
    preference: "banhall" as const,
    deviationsBanhall: 2,
    deviationsBaseline: 9,
    countingMethod: "Manual count against the writer's own settings, same pass for both drafts.",
    correctionsBanhall: 1,
    correctionsBaseline: 4,
    usedInDevelopment: false,
    banhallDraftText: BLINDED_STRIP,
    baselineDraftText: OTHER_DRAFT,
    ...overrides,
  };
}

async function allRows(f: Fixture) {
  return await f.t.run((ctx) => ctx.db.query("comparisons").take(50));
}

describe("comparisons.record — the pin and the judgement", () => {
  test("writes one row whose pin comes from the report and whose judgement fields are the caller's verbatim", async () => {
    const f = await setup();
    const before = Date.now();
    const comparisonId = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f)
    );

    const rows = await allRows(f);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row._id).toBe(comparisonId);
    // The pin is read from the report, never from the caller.
    expect(row.projectId).toBe(f.projectId);
    expect(row.reportId).toBe(f.reportId);
    expect(row.revisionNumber).toBe(3);
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.generationId).toBeUndefined();
    expect(row.recordedAt).toBeGreaterThanOrEqual(before);
    // Every judgement field holds the caller's value.
    expect(row).toMatchObject({
      banhallModel: "Sonnet 5",
      baselineProduct: "ChatGPT",
      baselineModel: "GPT-5.6 Sol",
      judgeUserId: f.judgeId,
      preference: "banhall",
      deviationsBanhall: 2,
      deviationsBaseline: 9,
      correctionsBanhall: 1,
      correctionsBaseline: 4,
      usedInDevelopment: false,
      baselineDraftText: OTHER_DRAFT,
    });
    expect(row.modelCaveat).toContain("Q15");
    expect(row.countingMethod).toContain("Manual count");
    expect(row.voidsComparisonId).toBeUndefined();
  });

  test("pins the generation when the report has one", async () => {
    const f = await setup();
    const generationId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        candidateMode: "single",
        singleModelId: "claude-opus-4-8",
        startedAt: Date.now(),
      });
      await ctx.db.patch(f.reportId, { generationId: id });
      return id;
    });
    await f.admin.mutation(api.comparisons.record, recordArgs(f));
    const rows = await allRows(f);
    expect(rows[0].generationId).toBe(generationId);
  });

  test("a blinded reformat of the pinned revision matches", async () => {
    const f = await setup();
    await f.admin.mutation(api.comparisons.record, recordArgs(f));
    const rows = await allRows(f);
    expect(rows[0].draftTextMatches).toBe(true);
    // The strip the judge read is stored verbatim (trimmed only at the ends).
    expect(rows[0].banhallDraftText).toContain("coupon fatigue series");
  });

  test("a wrong draft is recorded, not refused, with draftTextMatches false", async () => {
    const f = await setup();
    await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, { banhallDraftText: OTHER_DRAFT })
    );
    const rows = await allRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0].draftTextMatches).toBe(false);
  });
});

describe("comparisons.record — one live record per project", () => {
  test("refuses a second live record and names the void-and-re-enter path", async () => {
    const f = await setup();
    const firstId = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f)
    );
    let thrown: unknown;
    try {
      await f.admin.mutation(api.comparisons.record, recordArgs(f));
    } catch (error) {
      thrown = error;
    }
    const data = (thrown as { data?: Record<string, unknown> }).data ?? {};
    expect(data.code).toBe("INVALID_STATE");
    expect(String(data.message)).toMatch(/void/i);
    expect(data.liveComparisonId).toBe(firstId);
    expect(await allRows(f)).toHaveLength(1);
  });

  test("a correction leaves both rows unmodified and moves liveness to the new row", async () => {
    const f = await setup();
    const firstId = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f)
    );
    const firstBefore = await f.t.run((ctx) => ctx.db.get(firstId));
    const secondId = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, {
        voidsComparisonId: firstId,
        preference: "baseline",
        deviationsBanhall: 7,
      })
    );

    // Neither row is patched or deleted.
    expect(await f.t.run((ctx) => ctx.db.get(firstId))).toEqual(firstBefore);
    expect(await allRows(f)).toHaveLength(2);

    const listed = await f.admin.query(api.comparisons.listForProject, {
      projectId: f.projectId,
    });
    expect(listed.map((r) => [r._id, r.voided])).toEqual([
      [secondId, false],
      [firstId, true],
    ]);
    expect(listed[0].judgeLabel).toBe("Larry Hall");
    expect(listed[0].voidsComparisonId).toBe(firstId);

    // Only the new row reaches SM-1/SM-2.
    const metrics = await f.admin.query(api.comparisons.successMetrics, {});
    expect(metrics.projects.map((p) => p.comparisonId)).toEqual([secondId]);
    expect(metrics.excluded.voided).toBe(1);
  });

  test("refuses to void a row of another project or an already-voided row", async () => {
    const f = await setup();
    const mine = await f.admin.mutation(api.comparisons.record, recordArgs(f));
    const theirs = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, { reportId: f.otherReportId, expectedRevisionNumber: 0 })
    );

    // A row that belongs to a different project.
    expect(
      await errorCode(() =>
        f.admin.mutation(
          api.comparisons.record,
          recordArgs(f, { voidsComparisonId: theirs })
        )
      )
    ).toBe("INVALID_INPUT");

    // Void once legitimately, then try to void the same row again.
    await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, { voidsComparisonId: mine })
    );
    expect(
      await errorCode(() =>
        f.admin.mutation(
          api.comparisons.record,
          recordArgs(f, { voidsComparisonId: mine })
        )
      )
    ).toBe("INVALID_INPUT");
    expect(await allRows(f)).toHaveLength(3);
  });
});

describe("comparisons.record — fences and input validation", () => {
  test("fails STALE_REVISION when the report moved on, and writes nothing", async () => {
    const f = await setup();
    expect(
      await errorCode(() =>
        f.admin.mutation(
          api.comparisons.record,
          recordArgs(f, { expectedRevisionNumber: 2 })
        )
      )
    ).toBe("STALE_REVISION");
    expect(await allRows(f)).toHaveLength(0);
  });

  test("fails NOT_FOUND when the report does not exist", async () => {
    const f = await setup();
    const missingReportId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("reports", {
        projectId: f.projectId,
        content: REPORT_DOC,
        version: 9,
        generatedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    expect(
      await errorCode(() =>
        f.admin.mutation(
          api.comparisons.record,
          recordArgs(f, { reportId: missingReportId })
        )
      )
    ).toBe("NOT_FOUND");
  });

  test("refuses blank, oversized, negative and fractional inputs", async () => {
    const f = await setup();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["blank Banhall draft", { banhallDraftText: "   \n\t " }],
      ["blank baseline draft", { baselineDraftText: "" }],
      ["oversized Banhall draft", { banhallDraftText: "a".repeat(120_001) }],
      ["oversized baseline draft", { baselineDraftText: "b".repeat(120_001) }],
      ["negative Deviations", { deviationsBanhall: -1 }],
      ["negative baseline Deviations", { deviationsBaseline: -3 }],
      ["fractional Corrections", { correctionsBanhall: 1.5 }],
      ["negative baseline Corrections", { correctionsBaseline: -2 }],
      ["blank counting method", { countingMethod: "  " }],
      ["blank model caveat", { modelCaveat: "" }],
      ["blank Banhall model", { banhallModel: " " }],
      ["blank baseline product", { baselineProduct: "" }],
      ["blank baseline model", { baselineModel: "" }],
    ];
    for (const [name, overrides] of cases) {
      expect(
        await errorCode(() =>
          f.admin.mutation(api.comparisons.record, recordArgs(f, overrides))
        ),
        name
      ).toBe("INVALID_INPUT");
    }
    expect(await allRows(f)).toHaveLength(0);
  });

  test("refuses a judge who is not an active team member", async () => {
    const f = await setup();
    expect(
      await errorCode(() =>
        f.admin.mutation(
          api.comparisons.record,
          recordArgs(f, { judgeUserId: f.strangerId })
        )
      )
    ).toBe("INVALID_INPUT");
    expect(await allRows(f)).toHaveLength(0);
  });
});

describe("comparisons — admin-only on every function", () => {
  test("refuses writers, managers, roleless and anonymous callers, reading and writing nothing", async () => {
    const f = await setup();
    const callers: Array<[string, Fixture["admin"]]> = [
      ["writer", f.writer],
      ["manager", f.manager],
      ["roleless", f.roleless],
      ["anonymous", f.anonymous],
    ];
    for (const [name, caller] of callers) {
      expect(
        await errorCode(() =>
          caller.mutation(api.comparisons.record, recordArgs(f))
        ),
        `${name} record`
      ).toMatch(/NOT_AUTHORIZED|NOT_AUTHENTICATED/);
      expect(
        await errorCode(() => caller.query(api.comparisons.listRecordTargets, {})),
        `${name} listRecordTargets`
      ).toMatch(/NOT_AUTHORIZED|NOT_AUTHENTICATED/);
      expect(
        await errorCode(() =>
          caller.query(api.comparisons.getRecordContext, {
            projectId: f.projectId,
          })
        ),
        `${name} getRecordContext`
      ).toMatch(/NOT_AUTHORIZED|NOT_AUTHENTICATED/);
      expect(
        await errorCode(() =>
          caller.query(api.comparisons.listForProject, {
            projectId: f.projectId,
          })
        ),
        `${name} listForProject`
      ).toMatch(/NOT_AUTHORIZED|NOT_AUTHENTICATED/);
      expect(
        await errorCode(() => caller.query(api.comparisons.successMetrics, {})),
        `${name} successMetrics`
      ).toMatch(/NOT_AUTHORIZED|NOT_AUTHENTICATED/);
    }
    expect(await allRows(f)).toHaveLength(0);

    // A writer is refused even when the role check is the only thing standing
    // between them and an otherwise valid call.
    expect(
      await errorCode(() =>
        f.writer.mutation(api.comparisons.record, recordArgs(f))
      )
    ).toBe("NOT_AUTHORIZED");
  });
});

describe("comparisons — the record form's reads", () => {
  test("listRecordTargets labels projects and flags live comparisons", async () => {
    const f = await setup();
    const before = await f.admin.query(api.comparisons.listRecordTargets, {});
    expect(before).toEqual(
      expect.arrayContaining([
        {
          projectId: f.projectId,
          label: "Acme Metals — Alloy fatigue PD",
          hasLiveComparison: false,
        },
        {
          projectId: f.otherProjectId,
          label: "Beta Ceramics — Thermal cycling PD",
          hasLiveComparison: false,
        },
      ])
    );

    const firstId = await f.admin.mutation(api.comparisons.record, recordArgs(f));
    const after = await f.admin.query(api.comparisons.listRecordTargets, {});
    expect(after.find((t) => t.projectId === f.projectId)?.hasLiveComparison).toBe(
      true
    );

    // Voiding the only record makes the project recordable again.
    await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, { voidsComparisonId: firstId })
    );
    const stillLive = await f.admin.query(api.comparisons.listRecordTargets, {});
    expect(
      stillLive.find((t) => t.projectId === f.projectId)?.hasLiveComparison
    ).toBe(true);
  });

  test("getRecordContext returns the pin and never the revision's canonical text", async () => {
    const f = await setup();
    const context = await f.admin.query(api.comparisons.getRecordContext, {
      projectId: f.projectId,
    });
    expect(context).toMatchObject({
      reportId: f.reportId,
      revisionNumber: 3,
      generationId: null,
      suggestedBanhallModel: null,
      liveComparisonId: null,
    });
    // A recorder who could read the canonical text could manufacture a match.
    expect(JSON.stringify(context)).not.toContain("fatigue limit");

    const comparisonId = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f)
    );
    const after = await f.admin.query(api.comparisons.getRecordContext, {
      projectId: f.projectId,
    });
    expect(after?.liveComparisonId).toBe(comparisonId);
  });

  test("getRecordContext suggests the generation's own model and returns null with no report", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        candidateMode: "single",
        singleModelId: "claude-opus-4-8",
        startedAt: Date.now(),
      });
      await ctx.db.patch(f.reportId, { generationId });
      await ctx.db.insert("modelSelections", {
        projectId: f.projectId,
        generationId,
        userId: String(f.adminId),
        model: "claude-opus-4-8",
        label: "Opus 4.8",
        createdAt: Date.now(),
      });
    });
    const context = await f.admin.query(api.comparisons.getRecordContext, {
      projectId: f.projectId,
    });
    expect(context?.suggestedBanhallModel).toBe("Opus 4.8");

    const reportlessProjectId = await f.t.run((ctx) =>
      ctx.db.insert("projects", {
        title: "No report yet",
        clientName: "Gamma Co",
        status: "draft",
        createdBy: f.adminId,
        shareToken: "cmp-token-3",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    expect(
      await f.admin.query(api.comparisons.getRecordContext, {
        projectId: reportlessProjectId as Id<"projects">,
      })
    ).toBeNull();
  });
});

describe("comparisons.successMetrics", () => {
  /**
   * Seed one live comparison per project through the public mutation — the
   * only path that ever writes a `comparisons` row — from judge-entered counts
   * only.
   */
  async function seedProjects(
    f: Fixture,
    specs: Array<{
      key: string;
      preference: "banhall" | "baseline" | "tie";
      deviationsBanhall: number;
      deviationsBaseline: number;
      correctionsBanhall: number;
      usedInDevelopment?: boolean;
      totalHours?: number;
      sredHours?: number;
    }>
  ) {
    const created: Array<{ key: string; projectId: Id<"projects"> }> = [];
    for (const spec of specs) {
      const { projectId, reportId } = await f.t.run(async (ctx) => {
        const now = Date.now();
        const project = await ctx.db.insert("projects", {
          title: `PD ${spec.key}`,
          clientName: `Client ${spec.key}`,
          status: "review",
          createdBy: f.adminId,
          shareToken: `cmp-seed-${spec.key}`,
          createdAt: now,
          updatedAt: now,
        });
        const report = await ctx.db.insert("reports", {
          projectId: project,
          content: REPORT_DOC,
          version: 1,
          revisionNumber: 0,
          generatedAt: now,
          updatedAt: now,
        });
        if (spec.totalHours !== undefined) {
          await ctx.db.insert("financialSummaries", {
            projectId: project,
            totalHours: spec.totalHours,
            sredHours: spec.sredHours ?? spec.totalHours,
            nonSredHours: 0,
            personnelBreakdown: "",
            generatedAt: now,
          });
        }
        return { projectId: project, reportId: report };
      });
      await f.admin.mutation(
        api.comparisons.record,
        recordArgs(f, {
          reportId,
          expectedRevisionNumber: 0,
          preference: spec.preference,
          deviationsBanhall: spec.deviationsBanhall,
          deviationsBaseline: spec.deviationsBaseline,
          correctionsBanhall: spec.correctionsBanhall,
          correctionsBaseline: 4,
          usedInDevelopment: spec.usedInDevelopment ?? false,
        })
      );
      created.push({ key: spec.key, projectId });
    }
    return created;
  }

  test("reports zero eligible projects and computedMet false with no live rows", async () => {
    const f = await setup();
    const metrics = await f.admin.query(api.comparisons.successMetrics, {});
    expect(metrics.sm1.eligibleProjects).toBe(0);
    expect(metrics.sm1.computedMet).toBe(false);
    expect(metrics.sm2.eligibleProjects).toBe(0);
    expect(metrics.sm2.computedMet).toBe(false);
    expect(metrics.projects).toEqual([]);
    expect(metrics.excluded).toEqual({ development: [], voided: 0 });
  });

  test("meets SM-1 on five eligible projects and excludes the development project", async () => {
    const f = await setup();
    const seeded = await seedProjects(f, [
      { key: "a", preference: "banhall", deviationsBanhall: 1, deviationsBaseline: 8, correctionsBanhall: 1, totalHours: 150, sredHours: 120 },
      { key: "b", preference: "banhall", deviationsBanhall: 2, deviationsBaseline: 9, correctionsBanhall: 0 },
      { key: "c", preference: "banhall", deviationsBanhall: 4, deviationsBaseline: 8, correctionsBanhall: 1 },
      { key: "d", preference: "banhall", deviationsBanhall: 5, deviationsBaseline: 8, correctionsBanhall: 3 },
      { key: "e", preference: "baseline", deviationsBanhall: 6, deviationsBaseline: 2, correctionsBanhall: 5 },
      { key: "dev", preference: "banhall", deviationsBanhall: 0, deviationsBaseline: 9, correctionsBanhall: 0, usedInDevelopment: true },
    ]);
    const devProjectId = seeded.find((s) => s.key === "dev")!.projectId;

    const metrics = await f.admin.query(api.comparisons.successMetrics, {});
    expect(metrics.sm1.eligibleProjects).toBe(5);
    expect(metrics.sm1.preferredProjects).toBe(4);
    expect(metrics.sm1.satisfyingProjects).toBe(3);
    expect(metrics.sm1.computedMet).toBe(true);
    // The clause no query can check is still named.
    expect(metrics.sm1.manualConditions).toContain(
      "at least one 100–200-hour project among the four"
    );
    expect(metrics.sm2.manualConditions).toContain(
      "the 16-item harness fixture reports 16/16 on every run"
    );

    // The development project appears only in excluded.development.
    expect(metrics.projects.map((p) => String(p.projectId))).not.toContain(
      String(devProjectId)
    );
    expect(metrics.excluded.development.map((d) => String(d.projectId))).toEqual([
      String(devProjectId),
    ]);

    // financialSummaries is attached where an upload ran, and null elsewhere.
    const withHours = metrics.projects.find((p) => p.label === "Client a — PD a");
    expect(withHours?.financials).toEqual({ totalHours: 150, sredHours: 120 });
    expect(
      metrics.projects.find((p) => p.label === "Client b — PD b")?.financials
    ).toBeNull();
  });

  test("counts SM-2 from Corrections-to-acceptable on the same eligible set", async () => {
    const f = await setup();
    await seedProjects(f, [
      { key: "a", preference: "baseline", deviationsBanhall: 9, deviationsBaseline: 1, correctionsBanhall: 0 },
      { key: "b", preference: "tie", deviationsBanhall: 4, deviationsBaseline: 4, correctionsBanhall: 1 },
      { key: "c", preference: "banhall", deviationsBanhall: 1, deviationsBaseline: 9, correctionsBanhall: 1 },
      { key: "d", preference: "banhall", deviationsBanhall: 1, deviationsBaseline: 9, correctionsBanhall: 4 },
    ]);
    const metrics = await f.admin.query(api.comparisons.successMetrics, {});
    expect(metrics.sm2.eligibleProjects).toBe(4);
    expect(metrics.sm2.satisfyingProjects).toBe(3);
    expect(metrics.sm2.computedMet).toBe(true);
    expect(metrics.sm1.computedMet).toBe(false);
    expect(
      metrics.projects.filter((p) => p.sm2Satisfied).map((p) => p.label).sort()
    ).toEqual(["Client a — PD a", "Client b — PD b", "Client c — PD c"]);
  });
});

describe("comparisons — source contract", () => {
  test("never reads tool output and never patches or deletes a record", async () => {
    const { readFileSync } = await import("node:fs");
    const server = readFileSync(
      new URL("./comparisons.ts", import.meta.url),
      "utf8"
    );
    const metrics = readFileSync(
      new URL("./lib/successMetrics.ts", import.meta.url),
      "utf8"
    );
    for (const source of [server, metrics]) {
      // Deviation and Corrections counts are the judge's manual counts.
      expect(source).not.toMatch(
        /\.query\(\s*"(?:chatProposalItems|complianceNotes|writerReviews|qaItemFeedback)"/
      );
      expect(source).not.toMatch(/db\.patch\(|db\.delete\(/);
    }
    // Exactly one insert, inside `record`.
    expect(server.match(/insert\("comparisons"/g)).toHaveLength(1);
    // Every read is bounded.
    expect(server).not.toMatch(/[)\]]\s*\.collect\(\)/);
    expect(server).not.toMatch(/[)\]]\s*\.filter\(/);
  });
});

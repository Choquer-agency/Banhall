/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { QueryCtx } from "./_generated/server";
import {
  successMetrics,
  listForProject,
  listRecordTargets,
} from "./comparisons";

// Convex hides this runtime test hook from its published declarations.
function queryHandler(registered: object) {
  if (
    !("_handler" in registered) ||
    typeof registered._handler !== "function"
  ) {
    throw new Error("Expected registered Convex query handler");
  }
  return registered._handler;
}

/** Observe actual database returns, including auth, without replacing data. */
async function measureReads<T>(
  f: Fixture,
  handler: (ctx: QueryCtx) => Promise<T>
) {
  let bytes = 0;
  let documents = 0;
  const charge = (value: unknown) => {
    if (value === null) return;
    documents += 1;
    bytes += new TextEncoder().encode(JSON.stringify(value)).byteLength + 1_024;
  };
  const observe = <O extends object>(target: O): O =>
    new Proxy(target, {
      get(object, property, receiver) {
        const value: unknown = Reflect.get(object, property, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(value, object, args);
          if (
            ["get", "unique", "first", "take", "paginate"].includes(
              String(property)
            )
          ) {
            return Promise.resolve(result).then((returned: unknown) => {
              if (Array.isArray(returned)) returned.forEach(charge);
              else if (
                returned !== null &&
                typeof returned === "object" &&
                "page" in returned &&
                Array.isArray(returned.page)
              )
                returned.page.forEach(charge);
              else charge(returned);
              return returned;
            });
          }
          return result !== null && typeof result === "object"
            ? observe(result)
            : result;
        };
      },
    });
  const result = await f.admin.run(async (ctx) =>
    handler({ ...ctx, db: observe(ctx.db) })
  );
  return { result, bytes, documents };
}

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
    // The strip the judge read is stored exactly as it was pasted.
    expect(rows[0].banhallDraftText).toBe(BLINDED_STRIP);
  });

  test("accepts the unchanged original report pin after a newer report replaces it", async () => {
    const f = await setup();
    const original = await f.t.run((ctx) => ctx.db.get(f.reportId));
    expect(original).not.toBeNull();
    const hashBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(REPORT_DOC)
    );
    const originalHash = Array.from(new Uint8Array(hashBytes), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    const replacementId = await f.t.run(async (ctx) => {
      const now = Date.now();
      const generationId = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        startedAt: now,
      });
      return await ctx.db.insert("reports", {
        projectId: f.projectId,
        content: OTHER_DRAFT,
        version: 2,
        revisionNumber: 3,
        generationId,
        generatedAt: now,
        updatedAt: now,
      });
    });
    const current = await f.admin.query(api.comparisons.getRecordContext, {
      projectId: f.projectId,
    });
    expect(current?.reportId).toBe(replacementId);
    expect(current?.generationId).not.toBeNull();

    const comparisonId = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f)
    );

    const rows = await allRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: comparisonId,
      projectId: f.projectId,
      reportId: f.reportId,
      revisionNumber: 3,
      contentHash: originalHash,
      draftTextMatches: true,
    });
    expect(rows[0].generationId).toBeUndefined();
    expect(await f.t.run((ctx) => ctx.db.get(f.reportId))).toEqual(original);
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
    expect(listed.records.map((r) => [r._id, r.voided])).toEqual([
      [secondId, false],
      [firstId, true],
    ]);
    expect(listed.hasMore).toBe(false);
    expect(listed.records[0].judgeLabel).toBe("Larry Hall");
    expect(listed.records[0].voidsComparisonId).toBe(firstId);

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
      // R14: an "integer" beyond MAX_SAFE_INTEGER cannot be stored and read
      // back as the number the judge counted, so it is refused, not rounded.
      ["unsafe Deviations", { deviationsBanhall: 2 ** 53 + 2 }],
      ["unsafe Corrections", { correctionsBaseline: 2 ** 53 + 2 }],
      ["Infinity Deviations", { deviationsBaseline: Number.MAX_VALUE * 2 }],
      ["NaN Corrections", { correctionsBanhall: Number.NaN }],
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
    // R20: the mandated auth helper distinguishes the two refusals, so assert
    // each caller's exact code -- an authenticated non-admin is NOT_AUTHORIZED,
    // and an absent identity is NOT_AUTHENTICATED. An alternation would let
    // either code pass for either caller and hide a regression in that split.
    const callers: Array<[string, Fixture["admin"], string]> = [
      ["writer", f.writer, "NOT_AUTHORIZED"],
      ["manager", f.manager, "NOT_AUTHORIZED"],
      ["roleless", f.roleless, "NOT_AUTHORIZED"],
      ["anonymous", f.anonymous, "NOT_AUTHENTICATED"],
    ];
    for (const [name, caller, expected] of callers) {
      expect(
        await errorCode(() =>
          caller.mutation(api.comparisons.record, recordArgs(f))
        ),
        `${name} record`
      ).toBe(expected);
      expect(
        await errorCode(() => caller.query(api.comparisons.listRecordTargets, {})),
        `${name} listRecordTargets`
      ).toBe(expected);
      expect(
        await errorCode(() =>
          caller.query(api.comparisons.getRecordContext, {
            projectId: f.projectId,
          })
        ),
        `${name} getRecordContext`
      ).toBe(expected);
      expect(
        await errorCode(() =>
          caller.query(api.comparisons.listForProject, {
            projectId: f.projectId,
          })
        ),
        `${name} listForProject`
      ).toBe(expected);
      expect(
        await errorCode(() => caller.query(api.comparisons.successMetrics, {})),
        `${name} successMetrics`
      ).toBe(expected);
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
    expect(before.isDone).toBe(true);
    expect(before.targets).toEqual(
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
    expect(
      after.targets.find((t) => t.projectId === f.projectId)?.hasLiveComparison
    ).toBe(true);

    // Voiding the only record makes the project recordable again.
    await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, { voidsComparisonId: firstId })
    );
    const stillLive = await f.admin.query(api.comparisons.listRecordTargets, {});
    expect(
      stillLive.targets.find((t) => t.projectId === f.projectId)
        ?.hasLiveComparison
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
    expect(metrics.excluded).toEqual({
      development: [],
      developmentCount: 0,
      developmentTruncated: false,
      voided: 0,
    });
    expect(metrics.projectCount).toBe(0);
    expect(metrics.projectsTruncated).toBe(false);
    // No rows at all is still a COMPLETE corpus: the walk reached the start.
    expect(metrics.corpusComplete).toBe(true);
    expect(metrics.scannedRows).toBe(0);
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
    expect(metrics.corpusComplete).toBe(true);
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
    expect(metrics.excluded.developmentCount).toBe(1);
    expect(metrics.excluded.developmentTruncated).toBe(false);
    expect(metrics.projectCount).toBe(5);
    expect(metrics.projectsTruncated).toBe(false);

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

describe("comparisons — evidence fidelity", () => {
  // R18: the record is evidence. What the human typed is what is stored;
  // validation looks at the trimmed value but never reshapes it.
  test("stores every human-entered string exactly as it was entered", async () => {
    const f = await setup();
    const paddedDraft = `\n\n   ${BLINDED_STRIP}   \n`;
    const paddedBaseline = `  ${OTHER_DRAFT}\t`;
    await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, {
        banhallDraftText: paddedDraft,
        baselineDraftText: paddedBaseline,
        banhallModel: "  Sonnet 5  ",
        baselineProduct: " ChatGPT ",
        baselineModel: "\tGPT-5.6 Sol ",
        modelCaveat: "  Q15 unresolved.  ",
        countingMethod: " Manual count, both drafts. ",
      })
    );
    const row = (await allRows(f))[0];
    expect(row.banhallDraftText).toBe(paddedDraft);
    expect(row.baselineDraftText).toBe(paddedBaseline);
    expect(row.banhallModel).toBe("  Sonnet 5  ");
    expect(row.baselineProduct).toBe(" ChatGPT ");
    expect(row.baselineModel).toBe("\tGPT-5.6 Sol ");
    expect(row.modelCaveat).toBe("  Q15 unresolved.  ");
    expect(row.countingMethod).toBe(" Manual count, both drafts. ");
    // Match normalization is a separate rule, so the padding is invisible to it.
    expect(row.draftTextMatches).toBe(true);
  });

  // R15: two inputs that carry no prose are not evidence that the judge read
  // this revision. The record still lands — a match is never a gate.
  test("does not call two prose-free drafts a match", async () => {
    const f = await setup();
    const emptyDoc = JSON.stringify({ type: "doc", content: [] });
    const reportId = await f.t.run(async (ctx) => {
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        title: "Empty PD",
        clientName: "Delta Co",
        status: "review",
        createdBy: f.adminId,
        shareToken: "cmp-empty",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("reports", {
        projectId,
        content: emptyDoc,
        version: 1,
        revisionNumber: 0,
        generatedAt: now,
        updatedAt: now,
      });
    });
    await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, {
        reportId,
        expectedRevisionNumber: 0,
        banhallDraftText: emptyDoc,
      })
    );
    const rows = await allRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0].draftTextMatches).toBe(false);
  });

  // R10: the registry default is today's configuration, not evidence of what a
  // historical generation ran.
  test("offers no Banhall-model suggestion when the generation's model is unknown", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        startedAt: Date.now(),
      });
      await ctx.db.patch(f.reportId, { generationId });
    });
    const context = await f.admin.query(api.comparisons.getRecordContext, {
      projectId: f.projectId,
    });
    expect(context?.generationId).not.toBeNull();
    expect(context?.suggestedBanhallModel).toBeNull();
  });
});

describe("comparisons — bounded reads", () => {
  const MAX_DRAFT = "Alpha beta gamma. ".repeat(6_667).slice(0, 120_000);

  // R6: a row holds both permitted 120,000-character drafts, so the write path
  // and the picker must both survive rows at the limit.
  test("records and lists projects whose drafts are at the size limit", async () => {
    const f = await setup();
    await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, {
        banhallDraftText: MAX_DRAFT,
        baselineDraftText: MAX_DRAFT,
      })
    );
    const row = (await allRows(f))[0];
    expect(row.banhallDraftText).toHaveLength(120_000);
    expect(row.draftTextMatches).toBe(false);

    const page = await f.admin.query(api.comparisons.listRecordTargets, {});
    expect(
      page.targets.find((t) => t.projectId === f.projectId)?.hasLiveComparison
    ).toBe(true);
    const listed = await f.admin.query(api.comparisons.listForProject, {
      projectId: f.projectId,
    });
    expect(listed.records).toHaveLength(1);
  });

  // R7: a project older than the first picker page must still be selectable
  // and correctable.
  test("pages the project picker so older projects stay reachable", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      for (let index = 0; index < 30; index += 1) {
        const now = Date.now();
        await ctx.db.insert("projects", {
          title: `Filler ${index}`,
          clientName: "Filler Co",
          status: "draft",
          createdBy: f.adminId,
          shareToken: `cmp-filler-${index}`,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const first = await f.admin.query(api.comparisons.listRecordTargets, {});
    expect(first.targets).toHaveLength(25);
    expect(first.isDone).toBe(false);
    expect(
      first.targets.some((t) => t.projectId === f.projectId),
      "the oldest project is not on the first page"
    ).toBe(false);

    const second = await f.admin.query(api.comparisons.listRecordTargets, {
      cursor: first.cursor,
    });
    const target = second.targets.find((t) => t.projectId === f.projectId);
    expect(target).toMatchObject({
      label: "Acme Metals — Alloy fatigue PD",
      hasLiveComparison: false,
    });

    // Reachable means recordable — and correctable.
    const firstId = await f.admin.mutation(api.comparisons.record, recordArgs(f));
    const correctionId = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, { voidsComparisonId: firstId, preference: "tie" })
    );
    const listed = await f.admin.query(api.comparisons.listForProject, {
      projectId: f.projectId,
    });
    expect(listed.records.map((r) => [r._id, r.voided])).toEqual([
      [correctionId, false],
      [firstId, true],
    ]);
  });

  // R8: a truncated window must never read as a complete corpus.
  test("withholds a conclusive metric when the corpus walk is truncated", async () => {
    const f = await setup();
    // Every row goes in through `record`, the only path that writes a
    // `comparisons` row, so the corpus is shaped exactly as production would
    // shape it — 35 projects, each at the permitted draft size.
    for (let index = 0; index < 35; index += 1) {
      const reportId = await f.t.run(async (ctx) => {
        const now = Date.now();
        const projectId = await ctx.db.insert("projects", {
          title: `Heavy ${index}`,
          clientName: "Heavy Co",
          status: "review",
          createdBy: f.adminId,
          shareToken: `cmp-heavy-${index}`,
          createdAt: now,
          updatedAt: now,
        });
        return await ctx.db.insert("reports", {
          projectId,
          content: REPORT_DOC,
          version: 1,
          revisionNumber: 0,
          generatedAt: now,
          updatedAt: now,
        });
      });
      await f.admin.mutation(
        api.comparisons.record,
        recordArgs(f, {
          reportId,
          expectedRevisionNumber: 0,
          preference: "banhall",
          deviationsBanhall: 1,
          deviationsBaseline: 9,
          correctionsBanhall: 0,
          banhallDraftText: MAX_DRAFT,
          baselineDraftText: MAX_DRAFT,
        })
      );
    }

    const metrics = await f.admin.query(api.comparisons.successMetrics, {});
    // Every scanned row satisfies SM-1 and SM-2, so the arithmetic alone would
    // report both met — completeness is what withholds the conclusion.
    expect(metrics.corpusComplete).toBe(false);
    expect(metrics.sm1.satisfyingProjects).toBeGreaterThanOrEqual(4);
    expect(metrics.sm1.computedMet).toBe(false);
    expect(metrics.sm2.computedMet).toBe(false);
    expect(metrics.scannedRows).toBeLessThan(35);
  });
});

/**
 * P1/P10/P11: the corpus walk and the picker are the only reads that can grow
 * with the table, so their bounds are pinned here at the real limits — encoded
 * bytes, not UTF-16 code units; progress across a millisecond tie; and a
 * complete result across more than one batch.
 */
describe("comparisons — corpus walk bounds", () => {
  /** A helper that seeds one project + report and records against it. */
  async function seedRecord(
    f: Fixture,
    key: string,
    overrides: Record<string, unknown> = {}
  ) {
    const reportId = await f.t.run(async (ctx) => {
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        title: `PD ${key}`,
        clientName: `Client ${key}`,
        status: "review",
        createdBy: f.adminId,
        shareToken: `cmp-walk-${key}`,
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("reports", {
        projectId,
        content: REPORT_DOC,
        version: 1,
        revisionNumber: 0,
        generatedAt: now,
        updatedAt: now,
      });
    });
    return {
      reportId,
      comparisonId: await f.admin.mutation(
        api.comparisons.record,
        recordArgs(f, { reportId, expectedRevisionNumber: 0, ...overrides })
      ),
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  // P10: more than one batch, well inside every budget, and a correction pair
  // that straddles the batch boundary — the voided row is only recognised if
  // both halves of the pair are actually walked.
  test("counts a complete corpus that spans more than one batch", async () => {
    const f = await setup();
    // Insertion order is the reverse of the newest-first walk, so the pair
    // seeded here lands either side of the first batch's last row.
    for (const key of ["f0", "f1", "f2"]) await seedRecord(f, key);
    const pair = await seedRecord(f, "paired");
    const correctionId = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, {
        reportId: pair.reportId,
        expectedRevisionNumber: 0,
        voidsComparisonId: pair.comparisonId,
        preference: "banhall",
        deviationsBanhall: 1,
        deviationsBaseline: 9,
      })
    );
    for (let index = 0; index < 9; index += 1) await seedRecord(f, `t${index}`);

    const metrics = await f.admin.query(api.comparisons.successMetrics, {});
    expect(metrics.corpusComplete).toBe(true);
    // Every row was read: 13 originals + 1 correction.
    expect(metrics.scannedRows).toBe(14);
    // The straddling pair resolved to exactly one live row for its project.
    expect(metrics.excluded.voided).toBe(1);
    expect(metrics.sm1.eligibleProjects).toBe(13);
    expect(metrics.projects.map((p) => String(p.comparisonId))).toContain(
      String(correctionId)
    );
    expect(metrics.projects.map((p) => String(p.comparisonId))).not.toContain(
      String(pair.comparisonId)
    );
  });

  // P11: a cursor on `recordedAt` alone cannot step past a millisecond that
  // holds a whole batch — the walk would strand and the metric would be
  // withheld forever. The clock is frozen so every row shares one stamp.
  test("walks a corpus whose rows all share one millisecond", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-12T12:00:00.000Z"));
    const f = await setup();
    for (let index = 0; index < 12; index += 1) await seedRecord(f, `tie${index}`);

    const stamps = await f.t.run((ctx) => ctx.db.query("comparisons").take(50));
    expect(new Set(stamps.map((row) => row.recordedAt)).size).toBe(1);

    const metrics = await f.admin.query(api.comparisons.successMetrics, {});
    expect(metrics.corpusComplete).toBe(true);
    expect(metrics.scannedRows).toBe(12);
    expect(metrics.sm1.eligibleProjects).toBe(12);
  });

  // P1: the budget is charged in ENCODED bytes. A maximum-length draft of
  // three-byte characters costs three times what its `String.length` suggests,
  // so the walk must stop after far fewer rows than an ASCII corpus.
  test.each([
    ["three-byte characters", "あ".repeat(120_000)],
    [
      "unpaired surrogates followed by three-byte characters",
      "\ud800界".repeat(60_000),
    ],
  ])(
    "charges the byte budget for encoded UTF-8: %s",
    async (_label, wideDraft) => {
      const f = await setup();
      const wideNote = "壱".repeat(2_000);
      expect(wideDraft.length).toBe(120_000);

      for (let index = 0; index < 12; index += 1) {
        await seedRecord(f, `wide${index}`, {
          banhallDraftText: wideDraft,
          baselineDraftText: wideDraft,
          banhallModel: wideNote,
          baselineProduct: wideNote,
          baselineModel: wideNote,
          modelCaveat: wideNote,
          countingMethod: wideNote,
        });
      }

      const metrics = await f.admin.query(api.comparisons.successMetrics, {});
      // Each row is the worst case the budget reserves for, so exactly one batch
      // fits and the walk honestly reports that it did not finish.
      expect(metrics.scannedRows).toBe(10);
      expect(metrics.corpusComplete).toBe(false);
      expect(metrics.sm1.computedMet).toBe(false);

      // The same reads still work per project and per picker page.
      const targets = await f.admin.query(
        api.comparisons.listRecordTargets,
        {}
      );
      expect(targets.targets.length).toBeGreaterThan(0);
      // Liveness is reserved at the worst case, so a page of maximum-size rows
      // reports the rest as unknown rather than blowing the transaction.
      expect(
        targets.targets.filter((t) => t.hasLiveComparison === null).length
      ).toBeGreaterThan(0);
    }
  );
});

describe("comparisons — list and readout completeness", () => {
  async function seedProjectAndReport(f: Fixture, key: string) {
    return await f.t.run(async (ctx) => {
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        title: `PD ${key}`,
        clientName: `Client ${key}`,
        status: "review",
        createdBy: f.adminId,
        shareToken: `cmp-page-${key}`,
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("reports", {
        projectId,
        content: REPORT_DOC,
        version: 1,
        revisionNumber: 0,
        generatedAt: now,
        updatedAt: now,
      });
    });
  }

  /** A chain of `count` records on one project: one original, then corrections. */
  async function seedChain(f: Fixture, count: number) {
    const reportId = await seedProjectAndReport(f, `chain-${count}`);
    let previous = await f.admin.mutation(
      api.comparisons.record,
      recordArgs(f, { reportId, expectedRevisionNumber: 0 })
    );
    for (let index = 1; index < count; index += 1) {
      previous = await f.admin.mutation(
        api.comparisons.record,
        recordArgs(f, {
          reportId,
          expectedRevisionNumber: 0,
          voidsComparisonId: previous,
        })
      );
    }
    const project = await f.t.run(async (ctx) => {
      const report = await ctx.db.get(reportId);
      return report!.projectId;
    });
    return project;
  }

  // P2: `hasMore` must mean "a record exists past this window", never "the
  // window happens to be full".
  test("reports hasMore from a lookahead, not from a full window", async () => {
    const f = await setup();
    const exactly = await seedChain(f, 12);
    const listedExactly = await f.admin.query(api.comparisons.listForProject, {
      projectId: exactly,
    });
    expect(listedExactly.records).toHaveLength(12);
    expect(listedExactly.hasMore).toBe(false);

    const overflowing = await seedChain(f, 13);
    const listedOverflowing = await f.admin.query(
      api.comparisons.listForProject,
      { projectId: overflowing }
    );
    expect(listedOverflowing.records).toHaveLength(12);
    expect(listedOverflowing.hasMore).toBe(true);
  });

  // P3: the detail lists are capped; the counts and the truncation flags say
  // so out loud. An exclusion the readout quietly dropped would misstate the
  // measurement it exists to record.
  test("never omits eligible or excluded projects silently", async () => {
    const f = await setup();
    for (let index = 0; index < 101; index += 1) {
      const reportId = await seedProjectAndReport(f, `cap-e${index}`);
      await f.admin.mutation(
        api.comparisons.record,
        recordArgs(f, { reportId, expectedRevisionNumber: 0 })
      );
    }
    for (let index = 0; index < 101; index += 1) {
      const reportId = await seedProjectAndReport(f, `cap-d${index}`);
      await f.admin.mutation(
        api.comparisons.record,
        recordArgs(f, {
          reportId,
          expectedRevisionNumber: 0,
          usedInDevelopment: true,
        })
      );
    }

    const metrics = await f.admin.query(api.comparisons.successMetrics, {});
    expect(metrics.corpusComplete).toBe(true);
    expect(metrics.projects).toHaveLength(100);
    expect(metrics.projectCount).toBe(101);
    expect(metrics.projectsTruncated).toBe(true);
    expect(metrics.excluded.development).toHaveLength(100);
    expect(metrics.excluded.developmentCount).toBe(101);
    expect(metrics.excluded.developmentTruncated).toBe(true);
    // The arithmetic counts every eligible project, capped list or not.
    expect(metrics.sm1.eligibleProjects).toBe(101);
  });

  test("a corpus of exactly 500 rows is complete; 501 requires withholding", async () => {
    const f = await setup();
    await seedChain(f, 500);
    const exact = await f.admin.query(api.comparisons.successMetrics, {});
    expect(exact.scannedRows).toBe(500);
    expect(exact.corpusComplete).toBe(true);
    await f.admin.mutation(api.comparisons.record, recordArgs(f));
    const overflow = await f.admin.query(api.comparisons.successMetrics, {});
    expect(overflow.scannedRows).toBe(500);
    expect(overflow.corpusComplete).toBe(false);
    expect(overflow.sm1.computedMet).toBe(false);
    expect(overflow.sm2.computedMet).toBe(false);
  });

  test("large project and financial documents truncate details before their reads exhaust the budget", async () => {
    const f = await setup();
    const largeText = "界".repeat(250_000);
    for (let index = 0; index < 16; index += 1) {
      const reportId = await seedProjectAndReport(f, `large-${index}`);
      await f.admin.mutation(
        api.comparisons.record,
        recordArgs(f, {
          reportId,
          expectedRevisionNumber: 0,
          usedInDevelopment: index < 8,
        })
      );
      await f.t.run(async (ctx) => {
        const report = await ctx.db.get(reportId);
        if (!report) throw new Error("Missing fixture report");
        await ctx.db.patch(report.projectId, { industry: largeText });
        await ctx.db.insert("financialSummaries", {
          projectId: report.projectId,
          totalHours: 150,
          sredHours: 120,
          nonSredHours: 30,
          personnelBreakdown: largeText,
          generatedAt: Date.now(),
        });
      });
    }
    const measured = await measureReads<
      FunctionReturnType<typeof api.comparisons.successMetrics>
    >(f, (ctx) => queryHandler(successMetrics)(ctx, {}));
    expect(measured.result.corpusComplete).toBe(true);
    expect(measured.result.projectCount).toBe(8);
    expect(measured.result.projects.length).toBeGreaterThan(0);
    expect(measured.result.projectsTruncated).toBe(true);
    expect(measured.result.excluded.developmentTruncated).toBe(true);
    expect(measured.result.sm1.eligibleProjects).toBe(8);
    expect(measured.bytes).toBeLessThan(6_000_000);
    // 16 corpus rows + auth + at most six ancillary reads, not all 24.
    expect(measured.documents).toBeLessThanOrEqual(23);

    const picker = await measureReads<
      FunctionReturnType<typeof api.comparisons.listRecordTargets>
    >(f, (ctx) => queryHandler(listRecordTargets)(ctx, {}));
    expect(picker.result.targets.length).toBeLessThan(16);
    expect(picker.result.targets.length).toBeGreaterThan(0);
    expect(picker.result.isDone).toBe(false);
    expect(picker.bytes).toBeLessThan(4_000_000);
    const next = await f.admin.query(api.comparisons.listRecordTargets, {
      cursor: picker.result.cursor,
    });
    expect(next.targets.length).toBeGreaterThan(0);
    expect(
      new Set(
        [...picker.result.targets, ...next.targets].map((row) => row.projectId)
      ).size
    ).toBe(picker.result.targets.length + next.targets.length);
  });

  test("large distinct judge documents stop label reads and preserve history", async () => {
    const f = await setup();
    let previous: Id<"comparisons"> | undefined;
    for (let index = 0; index < 12; index += 1) {
      const judgeUserId = await f.t.run(async (ctx) =>
        ctx.db.insert("users", {
          authId: `large-judge-${index}`,
          role: "writer",
          firstName: `Judge ${index}`,
          image: "界".repeat(250_000),
        })
      );
      previous = await f.admin.mutation(
        api.comparisons.record,
        recordArgs(f, {
          judgeUserId,
          voidsComparisonId: previous,
        })
      );
    }
    const measured = await measureReads<
      FunctionReturnType<typeof api.comparisons.listForProject>
    >(f, (ctx) =>
      queryHandler(listForProject)(ctx, { projectId: f.projectId })
    );
    expect(measured.result.records).toHaveLength(12);
    expect(
      measured.result.records.some(
        (row) => row.judgeLabel === "Judge label unavailable (read limit)"
      )
    ).toBe(true);
    expect(measured.result.records[0].judgeLabel).toBe("Judge 11");
    expect(measured.bytes).toBeLessThan(5_000_000);
    expect(measured.documents).toBeLessThanOrEqual(19);
  });
});

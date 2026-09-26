/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  ERROR_REPORT_BUDGET,
  ERROR_REPORT_LIMITS,
  ERROR_REPORT_RETENTION_MS,
} from "./errorReports";

const modules = import.meta.glob("./**/*.ts");

// Security wave 1 (audit 2026-09-25, a2 P1-3): error reports stay open to
// signed-out reviewers, but each field is capped, each sender has a
// per-minute budget, and reading, resolving or deleting reports is the
// matrix's ops.viewAlerts (Admin only).

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "er-writer", role: "writer", email: "w@example.com" });
    await ctx.db.insert("users", { authId: "er-manager", role: "manager" });
    await ctx.db.insert("users", { authId: "er-admin", role: "admin" });
  });
  return {
    t,
    writer: t.withIdentity({ subject: "er-writer" }),
    manager: t.withIdentity({ subject: "er-manager" }),
    admin: t.withIdentity({ subject: "er-admin" }),
  };
}

function report(overrides: Partial<Parameters<typeof base>[0]> = {}) {
  return base(overrides);
}

function base(overrides: {
  message?: string;
  stack?: string;
  url?: string;
  userNote?: string;
  sessionId?: string;
  breadcrumbs?: Array<{ type: string; label: string; detail?: string; at: number }>;
}) {
  return {
    kind: "auto" as const,
    message: overrides.message ?? "Something broke",
    url: overrides.url ?? "/project/1",
    breadcrumbs: overrides.breadcrumbs ?? [],
    ...(overrides.stack !== undefined ? { stack: overrides.stack } : {}),
    ...(overrides.userNote !== undefined ? { userNote: overrides.userNote } : {}),
    ...(overrides.sessionId !== undefined ? { sessionId: overrides.sessionId } : {}),
  };
}

async function rows(t: Awaited<ReturnType<typeof setup>>["t"]) {
  return await t.run((ctx) => ctx.db.query("errorReports").collect());
}

describe("reportError", () => {
  it("cuts oversized fields and keeps the newest breadcrumbs", async () => {
    const { t, writer } = await setup();
    const crumbs = Array.from({ length: ERROR_REPORT_LIMITS.breadcrumbs + 20 }, (_, i) => ({
      type: "nav".repeat(100),
      label: `crumb ${i} `.repeat(100),
      detail: "d".repeat(ERROR_REPORT_LIMITS.breadcrumbDetail + 5),
      at: i,
    }));
    await writer.mutation(
      api.errorReports.reportError,
      report({
        message: "m".repeat(1_000_000 - 1_000),
        stack: "s".repeat(100_000),
        url: "u".repeat(10_000),
        userNote: "n".repeat(10_000),
        breadcrumbs: crumbs,
      })
    );
    const [row] = await rows(t);
    expect(row.message).toHaveLength(ERROR_REPORT_LIMITS.message);
    expect(row.stack).toHaveLength(ERROR_REPORT_LIMITS.stack);
    expect(row.url).toHaveLength(ERROR_REPORT_LIMITS.url);
    expect(row.userNote).toHaveLength(ERROR_REPORT_LIMITS.userNote);
    expect(row.breadcrumbs).toHaveLength(ERROR_REPORT_LIMITS.breadcrumbs);
    expect(row.breadcrumbs[0].at).toBe(20);
    expect(row.breadcrumbs[0].type.length).toBeLessThanOrEqual(ERROR_REPORT_LIMITS.breadcrumbType);
    expect(row.breadcrumbs[0].label.length).toBeLessThanOrEqual(ERROR_REPORT_LIMITS.breadcrumbLabel);
    expect(row.breadcrumbs[0].detail).toHaveLength(ERROR_REPORT_LIMITS.breadcrumbDetail);
  });

  it("drops a signed-in user's reports past the per-minute budget", async () => {
    const { t, writer } = await setup();
    for (let i = 0; i < ERROR_REPORT_BUDGET.perUser; i += 1) {
      expect(await writer.mutation(api.errorReports.reportError, report())).not.toBeNull();
    }
    expect(await writer.mutation(api.errorReports.reportError, report())).toBeNull();
    expect(await rows(t)).toHaveLength(ERROR_REPORT_BUDGET.perUser);
  });

  it("gives each signed-out session its own budget and caps signed-out reports overall", async () => {
    const { t } = await setup();
    for (let i = 0; i < ERROR_REPORT_BUDGET.perSession; i += 1) {
      expect(await t.mutation(api.errorReports.reportError, report({ sessionId: "s-1" }))).not.toBeNull();
    }
    expect(await t.mutation(api.errorReports.reportError, report({ sessionId: "s-1" }))).toBeNull();
    expect(await t.mutation(api.errorReports.reportError, report({ sessionId: "s-2" }))).not.toBeNull();

    // A new session id per call gets past the per-session budget but not the
    // signed-out total.
    let accepted = ERROR_REPORT_BUDGET.perSession + 1;
    for (let i = 0; i < ERROR_REPORT_BUDGET.signedOutTotal; i += 1) {
      const id = await t.mutation(api.errorReports.reportError, report({ sessionId: `fresh-${i}` }));
      if (id !== null) accepted += 1;
    }
    expect(accepted).toBe(ERROR_REPORT_BUDGET.signedOutTotal);
    expect(await rows(t)).toHaveLength(ERROR_REPORT_BUDGET.signedOutTotal);
  });

  // Review r1 P2-2 (2026-09-25): a signed-out script could still write about
  // 3 GB a day.
  it("holds all signed-out reports to about ten a minute, with a shorter stack", async () => {
    const { t, writer } = await setup();
    expect(ERROR_REPORT_BUDGET.signedOutTotal).toBeLessThanOrEqual(10);
    expect(ERROR_REPORT_LIMITS.signedOutStack).toBeLessThan(ERROR_REPORT_LIMITS.stack);
    let accepted = 0;
    for (let i = 0; i < 40; i += 1) {
      const id = await t.mutation(
        api.errorReports.reportError,
        report({ sessionId: `script-${i}`, stack: "s".repeat(100_000) })
      );
      if (id !== null) accepted += 1;
    }
    expect(accepted).toBe(ERROR_REPORT_BUDGET.signedOutTotal);
    const signedOut = await rows(t);
    expect(signedOut.every((row) => row.stack?.length === ERROR_REPORT_LIMITS.signedOutStack)).toBe(true);
    // A signed-in report keeps the longer stack.
    await writer.mutation(api.errorReports.reportError, report({ stack: "s".repeat(100_000) }));
    const mine = (await rows(t)).find((row) => row.userId !== undefined);
    expect(mine?.stack).toHaveLength(ERROR_REPORT_LIMITS.stack);
  });

  it("lets the budget refill after the window", async () => {
    const { t, writer } = await setup();
    for (let i = 0; i < ERROR_REPORT_BUDGET.perUser; i += 1) {
      await writer.mutation(api.errorReports.reportError, report());
    }
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("errorReports").collect()) {
        await ctx.db.patch(row._id, { createdAt: row.createdAt - ERROR_REPORT_BUDGET.windowMs - 1 });
      }
    });
    expect(await writer.mutation(api.errorReports.reportError, report())).not.toBeNull();
  });
});

describe("reading and changing reports is ops.viewAlerts (Admin only)", () => {
  it("shows reports and the open count to an Admin only", async () => {
    const { t, writer, manager, admin } = await setup();
    await t.mutation(api.errorReports.reportError, report());
    for (const actor of [t, writer, manager]) {
      expect(await actor.query(api.errorReports.listErrors, {})).toEqual([]);
      expect(await actor.query(api.errorReports.openCount, {})).toBe(0);
    }
    expect(await admin.query(api.errorReports.listErrors, {})).toHaveLength(1);
    expect(await admin.query(api.errorReports.openCount, {})).toBe(1);
  });

  it("refuses setStatus and deleteError below Admin", async () => {
    const { t, writer, manager, admin } = await setup();
    const id = await t.mutation(api.errorReports.reportError, report());
    if (!id) throw new Error("report was dropped");
    for (const actor of [writer, manager]) {
      await expect(
        actor.mutation(api.errorReports.setStatus, { id, status: "resolved" })
      ).rejects.toThrow(/permission/);
      await expect(actor.mutation(api.errorReports.deleteError, { id })).rejects.toThrow(/permission/);
    }
    await expect(t.mutation(api.errorReports.deleteError, { id })).rejects.toThrow(/Authentication/);
    expect((await rows(t))[0].status).toBe("open");

    await admin.mutation(api.errorReports.setStatus, { id, status: "resolved" });
    expect((await rows(t))[0].status).toBe("resolved");
    await admin.mutation(api.errorReports.deleteError, { id });
    expect(await rows(t)).toHaveLength(0);
  });
});

describe("retention sweep (review r1 P2-2)", () => {
  async function seed(
    t: Awaited<ReturnType<typeof setup>>["t"],
    rowsToAdd: Array<{ ageMs: number; reportType?: "bug" | "feature"; status?: "open" | "resolved" }>
  ) {
    await t.run(async (ctx) => {
      const now = Date.now();
      for (const row of rowsToAdd) {
        await ctx.db.insert("errorReports", {
          kind: "auto",
          ...(row.reportType ? { reportType: row.reportType } : {}),
          message: `age ${row.ageMs}`,
          url: "/",
          breadcrumbs: [],
          status: row.status ?? "open",
          createdAt: now - row.ageMs,
        });
      }
    });
  }
  const DAY = 24 * 60 * 60 * 1000;

  it("deletes bug reports older than 30 days and keeps recent ones and feature requests", async () => {
    const { t } = await setup();
    await seed(t, [
      { ageMs: ERROR_REPORT_RETENTION_MS + DAY, reportType: "bug" },
      { ageMs: ERROR_REPORT_RETENTION_MS + DAY, reportType: "bug", status: "resolved" },
      { ageMs: ERROR_REPORT_RETENTION_MS + DAY }, // before BNH-38: a bug
      { ageMs: ERROR_REPORT_RETENTION_MS + DAY, reportType: "feature" },
      { ageMs: ERROR_REPORT_RETENTION_MS - DAY, reportType: "bug" },
      { ageMs: 0 },
    ]);
    expect(ERROR_REPORT_RETENTION_MS).toBe(30 * DAY);
    expect(await t.mutation(internal.errorReports.pruneOldErrorReports, {})).toBe(3);
    const left = await rows(t);
    expect(left).toHaveLength(3);
    expect(left.some((row) => row.reportType === "feature")).toBe(true);
    expect(left.every((row) => row.reportType === "feature" || row.createdAt > Date.now() - ERROR_REPORT_RETENTION_MS)).toBe(true);
  });

  it("works in bounded batches", async () => {
    const { t } = await setup();
    await seed(t, Array.from({ length: 250 }, () => ({ ageMs: ERROR_REPORT_RETENTION_MS + DAY })));
    expect(await t.mutation(internal.errorReports.pruneOldErrorReports, {})).toBe(200);
    expect(await rows(t)).toHaveLength(50);
    expect(await t.mutation(internal.errorReports.pruneOldErrorReports, {})).toBe(50);
    expect(await rows(t)).toHaveLength(0);
  });
});

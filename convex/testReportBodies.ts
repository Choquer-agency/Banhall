import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { reportWithBody } from "./lib/reportBodies";

/** Read the same composed report shape the client receives in tests. */
export async function getTestReport(ctx: QueryCtx | MutationCtx, reportId: Id<"reports">) {
  const report = await ctx.db.get(reportId);
  return report ? await reportWithBody(ctx, report) : null;
}

export async function listTestReports(ctx: QueryCtx | MutationCtx) {
  const reports = await ctx.db.query("reports").collect();
  return await Promise.all(reports.map((report) => reportWithBody(ctx, report)));
}

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { domainError } from "./contracts";
import { workItemDueSortAt } from "../../shared/workItems";

const MAX_OVERSIGHT_ROWS_PER_ITEM = 4;

type OversightReason = { sourceAssigner: boolean; sourceOwner: boolean };

export function desiredOversightViewers(item: Doc<"workItems">, project: Doc<"projects">) {
  const desired = new Map<Id<"users">, OversightReason>();
  if (item.status !== "open") return desired;
  if (item.assignerId !== item.assigneeId) {
    desired.set(item.assignerId, { sourceAssigner: true, sourceOwner: false });
  }
  if (project.ownerId && project.ownerId !== item.assigneeId) {
    const existing = desired.get(project.ownerId);
    desired.set(project.ownerId, {
      sourceAssigner: existing?.sourceAssigner ?? false,
      sourceOwner: true,
    });
  }
  return desired;
}

export async function syncOversightForItem(
  ctx: MutationCtx,
  item: Doc<"workItems">,
  project: Doc<"projects">
) {
  const rows = await ctx.db
    .query("workItemOversight")
    .withIndex("by_workItemId", (q) => q.eq("workItemId", item._id))
    .take(MAX_OVERSIGHT_ROWS_PER_ITEM + 1);
  if (rows.length > MAX_OVERSIGHT_ROWS_PER_ITEM) {
    domainError("INVALID_STATE", "This work item has too many oversight projection rows");
  }
  const desired = desiredOversightViewers(item, project);
  const existingByViewer = new Map(rows.map((row) => [row.viewerId, row]));
  const now = Date.now();
  for (const row of rows) {
    if (!desired.has(row.viewerId)) await ctx.db.delete(row._id);
  }
  for (const [viewerId, reason] of desired) {
    const existing = existingByViewer.get(viewerId);
    const patch = {
      projectId: item.projectId,
      assigneeId: item.assigneeId,
      dueSortAt: workItemDueSortAt(item.dueAt),
      ...reason,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("workItemOversight", { viewerId, workItemId: item._id, ...patch });
  }
}

export async function deleteOversightForItem(ctx: MutationCtx, workItemId: Id<"workItems">) {
  const rows = await ctx.db
    .query("workItemOversight")
    .withIndex("by_workItemId", (q) => q.eq("workItemId", workItemId))
    .take(MAX_OVERSIGHT_ROWS_PER_ITEM + 1);
  if (rows.length > MAX_OVERSIGHT_ROWS_PER_ITEM) {
    domainError("INVALID_STATE", "This work item has too many oversight projection rows");
  }
  for (const row of rows) await ctx.db.delete(row._id);
}

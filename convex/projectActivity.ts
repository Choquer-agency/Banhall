import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { getInternalProjectAccessOrNull } from "./lib/auth";
import {
  workflowStageValidator,
  workItemKindValidator,
} from "./lib/contracts";
import { userDisplayLabel } from "./lib/teamRoster";

/**
 * Read-only projection of the project's append-only audit history
 * (`projectEvents` + `workItemEvents`) for the Workflow details rail.
 *
 * Contract notes (docs/product-domain.md, cross-cutting rules):
 * - This is a bounded, indexed read over already-canonical immutable events.
 *   It introduces no mutation, no new event source, and no schema semantics —
 *   only the additive `projectEvents.by_projectId_and_at` index.
 * - Visibility matches the existing internal project read default (D1):
 *   the same `getInternalProjectAccessOrNull` gate used by
 *   `getProjectWorkflowHeader`. Denied/unknown callers receive `null`.
 * - Truncation is disclosed truthfully: each source is bounded to MAX+1 and
 *   `truncated` is true whenever more history exists than the merged page.
 * - Work-item instructions are deliberately NOT exposed here; entries carry
 *   only labels, stages, kinds, due dates, blocking flags, and audit notes.
 */
export const ACTIVITY_PAGE_SIZE = 25;

const activityActorValidator = v.object({
  label: v.string(),
  initials: v.string(),
});

const activityEntryValidator = v.union(
  v.object({
    id: v.string(),
    kind: v.literal("ownership_transferred"),
    at: v.number(),
    actor: activityActorValidator,
    fromLabel: v.union(v.string(), v.null()),
    toLabel: v.string(),
    note: v.union(v.string(), v.null()),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("stage_changed"),
    at: v.number(),
    actor: activityActorValidator,
    fromStage: v.union(workflowStageValidator, v.null()),
    toStage: workflowStageValidator,
    note: v.union(v.string(), v.null()),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("work_created"),
    at: v.number(),
    actor: activityActorValidator,
    workKind: workItemKindValidator,
    assigneeLabel: v.string(),
    blocking: v.boolean(),
    dueAt: v.union(v.number(), v.null()),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("work_reassigned"),
    at: v.number(),
    actor: activityActorValidator,
    workKind: v.union(workItemKindValidator, v.null()),
    fromAssigneeLabel: v.string(),
    toAssigneeLabel: v.string(),
    note: v.union(v.string(), v.null()),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("work_blocking_changed"),
    at: v.number(),
    actor: activityActorValidator,
    workKind: v.union(workItemKindValidator, v.null()),
    toBlocking: v.boolean(),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("work_due_changed"),
    at: v.number(),
    actor: activityActorValidator,
    workKind: v.union(workItemKindValidator, v.null()),
    fromDueAt: v.union(v.number(), v.null()),
    toDueAt: v.union(v.number(), v.null()),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("work_completed"),
    at: v.number(),
    actor: activityActorValidator,
    workKind: v.union(workItemKindValidator, v.null()),
    assigneeLabel: v.string(),
    onBehalfOfAssignee: v.boolean(),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("work_declined"),
    at: v.number(),
    actor: activityActorValidator,
    workKind: v.union(workItemKindValidator, v.null()),
    assigneeLabel: v.string(),
    reason: v.string(),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("work_canceled"),
    at: v.number(),
    actor: activityActorValidator,
    workKind: v.union(workItemKindValidator, v.null()),
    assigneeLabel: v.string(),
    reason: v.union(v.string(), v.null()),
  })
);

function initials(label: string) {
  const parts = label.split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`
    : label.slice(0, 2)
  ).toUpperCase();
}

export const listProjectActivity = query({
  args: { projectId: v.id("projects") },
  returns: v.union(
    v.null(),
    v.object({
      entries: v.array(activityEntryValidator),
      truncated: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;

    // Bound each canonical source to MAX+1 newest-first so a truncated page
    // is always disclosed as truncated — never a silent cap.
    const [projectRows, workRows] = await Promise.all([
      ctx.db
        .query("projectEvents")
        .withIndex("by_projectId_and_at", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .take(ACTIVITY_PAGE_SIZE + 1),
      ctx.db
        .query("workItemEvents")
        .withIndex("by_projectId_and_at", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .take(ACTIVITY_PAGE_SIZE + 1),
    ]);

    // Bounded batch resolution: actors, ownership parties, created/reassigned
    // assignees, plus each referenced work item (for kind + terminal-state
    // assignee labels). Work items are never hard-deleted in their normal
    // lifecycle, but resolution stays defensive.
    const userIds = new Set<Id<"users">>();
    const workItemIds = new Set<Id<"workItems">>();
    for (const event of projectRows) {
      userIds.add(event.actorId);
      if (event.type === "ownership_transferred") {
        if (event.from) userIds.add(event.from);
        userIds.add(event.to);
      }
    }
    for (const event of workRows) {
      userIds.add(event.actorId);
      workItemIds.add(event.workItemId);
      if (event.type === "created") userIds.add(event.detail.assigneeId);
      if (event.type === "reassigned") {
        userIds.add(event.detail.fromAssigneeId);
        userIds.add(event.detail.toAssigneeId);
      }
    }
    const workItems = new Map<Id<"workItems">, Doc<"workItems">>();
    for (const workItemId of workItemIds) {
      const item = await ctx.db.get(workItemId);
      if (item) {
        workItems.set(workItemId, item);
        userIds.add(item.assigneeId);
      }
    }
    const users = new Map<Id<"users">, Doc<"users">>();
    for (const userId of userIds) {
      const member = await ctx.db.get(userId);
      if (member) users.set(userId, member);
    }
    const labelOf = (userId: Id<"users">) => {
      const member = users.get(userId);
      return member ? userDisplayLabel(member) : "Unknown team member";
    };
    const actorOf = (userId: Id<"users">) => {
      const label = labelOf(userId);
      return { label, initials: users.has(userId) ? initials(label) : "?" };
    };
    const workKindOf = (workItemId: Id<"workItems">) =>
      workItems.get(workItemId)?.kind ?? null;
    const workAssigneeLabelOf = (workItemId: Id<"workItems">) => {
      const item = workItems.get(workItemId);
      return item ? labelOf(item.assigneeId) : "Unknown team member";
    };

    type Entry = Infer<typeof activityEntryValidator>;
    const entries: Entry[] = [];
    for (const event of projectRows) {
      if (event.type === "ownership_transferred") {
        entries.push({
          id: event._id,
          kind: "ownership_transferred",
          at: event.at,
          actor: actorOf(event.actorId),
          fromLabel: event.from ? labelOf(event.from) : null,
          toLabel: labelOf(event.to),
          note: event.note ?? null,
        });
      } else {
        entries.push({
          id: event._id,
          kind: "stage_changed",
          at: event.at,
          actor: actorOf(event.actorId),
          fromStage: event.from ?? null,
          toStage: event.to,
          note: event.note ?? null,
        });
      }
    }
    for (const event of workRows) {
      switch (event.type) {
        case "created":
          entries.push({
            id: event._id,
            kind: "work_created",
            at: event.at,
            actor: actorOf(event.actorId),
            workKind: event.detail.kind,
            assigneeLabel: labelOf(event.detail.assigneeId),
            blocking: event.detail.blocking,
            dueAt: event.detail.dueAt ?? null,
          });
          break;
        case "reassigned":
          entries.push({
            id: event._id,
            kind: "work_reassigned",
            at: event.at,
            actor: actorOf(event.actorId),
            workKind: workKindOf(event.workItemId),
            fromAssigneeLabel: labelOf(event.detail.fromAssigneeId),
            toAssigneeLabel: labelOf(event.detail.toAssigneeId),
            note: event.detail.note ?? null,
          });
          break;
        case "blocking_changed":
          entries.push({
            id: event._id,
            kind: "work_blocking_changed",
            at: event.at,
            actor: actorOf(event.actorId),
            workKind: workKindOf(event.workItemId),
            toBlocking: event.detail.toBlocking,
          });
          break;
        case "due_changed":
          entries.push({
            id: event._id,
            kind: "work_due_changed",
            at: event.at,
            actor: actorOf(event.actorId),
            workKind: workKindOf(event.workItemId),
            fromDueAt: event.detail.fromDueAt ?? null,
            toDueAt: event.detail.toDueAt ?? null,
          });
          break;
        case "completed":
          entries.push({
            id: event._id,
            kind: "work_completed",
            at: event.at,
            actor: actorOf(event.actorId),
            workKind: workKindOf(event.workItemId),
            assigneeLabel: workAssigneeLabelOf(event.workItemId),
            onBehalfOfAssignee: event.detail.onBehalfOfAssignee,
          });
          break;
        case "declined":
          entries.push({
            id: event._id,
            kind: "work_declined",
            at: event.at,
            actor: actorOf(event.actorId),
            workKind: workKindOf(event.workItemId),
            assigneeLabel: workAssigneeLabelOf(event.workItemId),
            reason: event.detail.reason,
          });
          break;
        case "canceled":
          entries.push({
            id: event._id,
            kind: "work_canceled",
            at: event.at,
            actor: actorOf(event.actorId),
            workKind: workKindOf(event.workItemId),
            assigneeLabel: workAssigneeLabelOf(event.workItemId),
            reason: event.detail.reason ?? null,
          });
          break;
      }
    }

    // Merge newest-first. Ties break deterministically by id so repeated
    // reads render identically.
    entries.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    const page = entries.slice(0, ACTIVITY_PAGE_SIZE);
    const truncated =
      projectRows.length > ACTIVITY_PAGE_SIZE ||
      workRows.length > ACTIVITY_PAGE_SIZE ||
      entries.length > ACTIVITY_PAGE_SIZE;
    return { entries: page, truncated };
  },
});

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * TEMPORARY STUB (WS2 branch). WS1 owns this file and lands the real helper
 * with the `notifications` and `notificationSettings` tables (round 2 index,
 * section 4). The signature matches that contract so callers need no change;
 * on rebase, delete this stub and take WS1's version.
 */
export type NotifyInput = {
  userId: Id<"users">;
  kind: "ideas_ready" | "draft_ready" | "qa_finished" | "handoff" | "invite_accepted";
  projectId?: Id<"projects">;
  generationId?: Id<"generations">;
  title: string;
  body?: string;
  href: string;
  dedupeKey: string;
};

export async function notify(_ctx: MutationCtx, _input: NotifyInput): Promise<void> {
  // No-op until WS1's notifications land.
}

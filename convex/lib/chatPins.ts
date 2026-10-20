// Report chat parity, Phase C (2026-10-20), W1: the project files a writer
// pins to one chat message. `chatV2.sendMessage` checks them here and stores
// the ids on the turn (`chatTurns.pinnedDocumentIds`); the reply reads them
// in full (convex/ai/chatDocumentTools.ts, `pinnedFilesMessage`), and
// `chatV2.listTurns` shows their names on the writer's message. Only ids and
// names: a pinned file's content is never stored with the turn.

import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { domainError } from "./contracts";
import { CHAT_MAX_PINNED_FILES } from "../../shared/chatLimits";

export const CHAT_PINS_TOO_MANY = `Choose up to ${CHAT_MAX_PINNED_FILES} files to read with one message.`;
export const CHAT_PIN_UNAVAILABLE = "A file you chose is no longer in this project's files. Choose again.";

/**
 * The pins a send may carry: de-duplicated in the order given, at most
 * CHAT_MAX_PINNED_FILES, each a file of `projectId` that is not archived.
 * Refuses the whole send otherwise, before anything is written.
 */
export async function checkedPinnedDocumentIds(
  ctx: Pick<QueryCtx, "db">,
  projectId: Id<"projects">,
  pinned: readonly Id<"projectDocuments">[] | undefined
): Promise<Id<"projectDocuments">[]> {
  if (!pinned || pinned.length === 0) return [];
  const unique = [...new Set(pinned)];
  if (unique.length > CHAT_MAX_PINNED_FILES) domainError("INVALID_INPUT", CHAT_PINS_TOO_MANY);
  for (const documentId of unique) {
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.projectId !== projectId || doc.archived) domainError("INVALID_INPUT", CHAT_PIN_UNAVAILABLE);
  }
  return unique;
}

export type PinnedFile = { documentId: Id<"projectDocuments">; name: string };

/**
 * Each turn's pinned files by turn id, names as stored, in pin order. A file
 * deleted since is left out; an archived one keeps its name, since the
 * message was sent with it.
 */
export async function pinnedFilesByTurn(
  ctx: Pick<QueryCtx, "db">,
  turns: ReadonlyArray<Pick<Doc<"chatTurns">, "_id" | "pinnedDocumentIds">>
): Promise<Map<Id<"chatTurns">, PinnedFile[]>> {
  const names = new Map<Id<"projectDocuments">, string | null>();
  const byTurn = new Map<Id<"chatTurns">, PinnedFile[]>();
  for (const turn of turns) {
    if (!turn.pinnedDocumentIds?.length) continue;
    const files: PinnedFile[] = [];
    for (const documentId of turn.pinnedDocumentIds) {
      if (!names.has(documentId)) names.set(documentId, (await ctx.db.get(documentId))?.fileName ?? null);
      const name = names.get(documentId);
      if (name) files.push({ documentId, name });
    }
    if (files.length) byTurn.set(turn._id, files);
  }
  return byTurn;
}

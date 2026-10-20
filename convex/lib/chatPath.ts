import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isRecordOnlyProposal, proposalPairs } from "../../shared/chatProposals";

/**
 * Report chat parity, Phase C (2026-10-20), W2: alternatives inside one
 * conversation. Edit and Regenerate save a new prompt as a sibling of an
 * earlier turn, so a conversation is a tree of turns. One path through it is
 * active for everyone (lead decision: one shared path per conversation): the
 * browser shows it, and the model, cards, jobs and chains read only it.
 *
 * - A turn's parent is `parentPromptMessageId`. When absent: for an
 *   alternative (`alternativeOf` set), the parent of its group's first turn;
 *   otherwise the turn with the next lower order (every turn saved before
 *   alternatives existed, and a conversation's first turn).
 * - The path runs from the tip (`agentChatThreads.activeTipPromptMessageId`,
 *   absent meaning the newest turn) up through parents. It is read over the
 *   newest CHAT_PATH_TURN_SCAN turns; anything older counts as linear, so
 *   every message below the oldest turn read is on the path.
 * - A conversation gets a tip only when its first alternative is made, and
 *   keeps it from then on. With no tip there are no alternatives and every
 *   turn is on the path, so `loadChatPath` returns null and readers keep
 *   their plain, by-order behavior (and their reads).
 */

/** Newest turns read to find the active path. */
export const CHAT_PATH_TURN_SCAN = 200;

/** The fields the path is computed from. */
export type PathTurn = Pick<
  Doc<"chatTurns">,
  "promptMessageId" | "order" | "parentPromptMessageId" | "alternativeOf"
>;

export interface AlternativeGroup {
  /** 1-based position among the group's alternatives, oldest first. */
  index: number;
  count: number;
  previousPromptMessageId?: string;
  nextPromptMessageId?: string;
}

export interface ChatPath<T extends PathTurn> {
  /** Every turn read, oldest first. */
  turns: T[];
  /** The active path, oldest first. */
  path: T[];
  tip: T | null;
  /** True when every turn read is on the path (nothing is hidden). */
  linear: boolean;
  /** Whether a turn, by its prompt, is on the path. Unknown (older) prompts are. */
  onPathPrompt(promptMessageId: string | undefined): boolean;
  /** Whether a message, by its order, is on the path. */
  onPathOrder(order: number): boolean;
  parentOf(turn: T): T | null;
  /** The turn's alternatives, when its group has more than one. */
  group(turn: T): AlternativeGroup | undefined;
  /** The newest turn in the subtree under `promptMessageId` (itself if none). */
  newestLeafUnder(promptMessageId: string): T | null;
}

const groupKey = (turn: PathTurn) => turn.alternativeOf ?? turn.promptMessageId;

/**
 * The active path over `scanned` (any order). Pure, so the tree rules are
 * unit-tested without a database.
 */
export function buildChatPath<T extends PathTurn>(
  scanned: readonly T[],
  tipPromptMessageId: string | undefined
): ChatPath<T> {
  const turns = [...scanned].sort((left, right) => left.order - right.order);
  const byPrompt = new Map(turns.map((turn) => [turn.promptMessageId, turn]));
  const indexOf = new Map(turns.map((turn, index) => [turn, index]));

  const parentOf = (turn: T): T | null => {
    const seen = new Set<T>();
    let current = turn;
    for (;;) {
      if (current.parentPromptMessageId !== undefined) {
        return byPrompt.get(current.parentPromptMessageId) ?? null;
      }
      if (current.alternativeOf !== undefined && current.alternativeOf !== current.promptMessageId) {
        const first = byPrompt.get(current.alternativeOf);
        if (!first || seen.has(first)) return null;
        seen.add(current);
        current = first;
        continue;
      }
      const index = indexOf.get(current);
      return index === undefined || index === 0 ? null : turns[index - 1]!;
    }
  };

  const newest = turns.at(-1) ?? null;
  const tip = (tipPromptMessageId !== undefined ? byPrompt.get(tipPromptMessageId) : undefined) ?? newest;

  const path: T[] = [];
  const onPath = new Set<T>();
  for (let turn = tip; turn && !onPath.has(turn); turn = parentOf(turn)) {
    onPath.add(turn);
    path.push(turn);
  }
  path.reverse();
  const pathOrders = new Set(path.map((turn) => turn.order));
  const pathPrompts = new Set(path.map((turn) => turn.promptMessageId));
  const oldestRead = turns[0]?.order ?? Number.POSITIVE_INFINITY;

  const groups = new Map<string, T[]>();
  for (const turn of turns) {
    const key = groupKey(turn);
    const members = groups.get(key);
    if (members) members.push(turn);
    else groups.set(key, [turn]);
  }

  let children: Map<T, T[]> | undefined;
  const childrenOf = (turn: T): T[] => {
    if (!children) {
      children = new Map();
      for (const candidate of turns) {
        const parent = parentOf(candidate);
        if (!parent) continue;
        const list = children.get(parent);
        if (list) list.push(candidate);
        else children.set(parent, [candidate]);
      }
    }
    return children.get(turn) ?? [];
  };

  const linear = path.length === turns.length;
  return {
    turns,
    path,
    tip,
    linear,
    onPathPrompt: (promptMessageId) =>
      promptMessageId === undefined || pathPrompts.has(promptMessageId) || !byPrompt.has(promptMessageId),
    // Nothing hidden: every message shows, as before alternatives existed.
    onPathOrder: (order) => linear || order < oldestRead || pathOrders.has(order),
    parentOf,
    group(turn) {
      const key = groupKey(turn);
      const members = [...(groups.get(key) ?? [turn])];
      // The group's first turn is older than the turns read: count it.
      const firstKnown = byPrompt.has(key);
      const ids = [...(firstKnown ? [] : [key]), ...members.map((member) => member.promptMessageId)];
      if (ids.length < 2) return undefined;
      const position = ids.indexOf(turn.promptMessageId);
      if (position === -1) return undefined;
      // Review P3-3: it is counted, but never offered as a place to switch
      // to: `setActiveAlternative` reads the same turns and could not find it.
      const reachable = (id: string | undefined) => (id !== undefined && byPrompt.has(id) ? id : undefined);
      const previous = reachable(ids[position - 1]);
      const next = reachable(ids[position + 1]);
      return {
        index: position + 1,
        count: ids.length,
        ...(previous ? { previousPromptMessageId: previous } : {}),
        ...(next ? { nextPromptMessageId: next } : {}),
      };
    },
    newestLeafUnder(promptMessageId) {
      const start = byPrompt.get(promptMessageId);
      if (!start) return null;
      let best = start;
      const stack = [start];
      const seen = new Set<T>();
      while (stack.length) {
        const turn = stack.pop()!;
        if (seen.has(turn)) continue;
        seen.add(turn);
        if (turn.order > best.order) best = turn;
        stack.push(...childrenOf(turn));
      }
      return best;
    },
  };
}

type ReadCtx = Pick<QueryCtx, "db">;

async function threadRow(ctx: ReadCtx, agentThreadId: string) {
  return await ctx.db
    .query("agentChatThreads")
    .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
    .unique();
}

/** The newest CHAT_PATH_TURN_SCAN turns of a thread and its active path. */
export async function readChatPath(
  ctx: ReadCtx,
  agentThreadId: string,
  tipPromptMessageId: string | undefined
): Promise<ChatPath<Doc<"chatTurns">>> {
  const turns = await ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", agentThreadId))
    .order("desc")
    .take(CHAT_PATH_TURN_SCAN);
  return buildChatPath(turns, tipPromptMessageId);
}

/**
 * The thread's active path, or null when it has no alternatives (no tip
 * recorded): then every turn is on the path and nothing needs filtering.
 * Pass the thread row when it is already read.
 */
export async function loadChatPath(
  ctx: ReadCtx,
  agentThreadId: string,
  thread?: Pick<Doc<"agentChatThreads">, "activeTipPromptMessageId"> | null
): Promise<ChatPath<Doc<"chatTurns">> | null> {
  const row = thread === undefined ? await threadRow(ctx, agentThreadId) : thread;
  const tip = row?.activeTipPromptMessageId;
  if (tip === undefined) return null;
  return await readChatPath(ctx, agentThreadId, tip);
}

/**
 * The thread's turns on the active path, newest first, at most `limit`.
 * Without alternatives, the newest turns by order (the reads callers made
 * before alternatives existed).
 */
export async function pathTurnsNewestFirst(
  ctx: ReadCtx,
  agentThreadId: string,
  limit: number,
  path?: ChatPath<Doc<"chatTurns">> | null
): Promise<Doc<"chatTurns">[]> {
  const view = path === undefined ? await loadChatPath(ctx, agentThreadId) : path;
  if (view) return view.path.slice(-limit).reverse();
  return await ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", agentThreadId))
    .order("desc")
    .take(limit);
}

/**
 * The tip: the newest turn of the active path (the thread's newest turn when
 * it has no alternatives).
 */
export async function chatTipTurn(
  ctx: ReadCtx,
  agentThreadId: string
): Promise<Doc<"chatTurns"> | null> {
  const thread = await threadRow(ctx, agentThreadId);
  const tip = thread?.activeTipPromptMessageId;
  if (tip !== undefined) {
    const turn = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
        q.eq("agentThreadId", agentThreadId).eq("promptMessageId", tip)
      )
      .unique();
    if (turn) return turn;
  }
  return await ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", agentThreadId))
    .order("desc")
    .first();
}

/**
 * A new turn appended at the tip (`sendMessage`, an automatic link): its
 * parent is the tip it follows (`parent` when the caller knows it), and, in a
 * conversation with alternatives, it becomes the tip. Call right after the
 * turn is inserted.
 */
export async function appendTurnAtTip(
  ctx: MutationCtx,
  turn: Pick<Doc<"chatTurns">, "_id" | "agentThreadId" | "promptMessageId">,
  parent?: string
): Promise<void> {
  const thread = await threadRow(ctx, turn.agentThreadId);
  let parentPromptMessageId = parent ?? thread?.activeTipPromptMessageId;
  if (parentPromptMessageId === undefined || parentPromptMessageId === turn.promptMessageId) {
    const newest = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", turn.agentThreadId))
      .order("desc")
      .take(2);
    parentPromptMessageId = newest.find((row) => row._id !== turn._id)?.promptMessageId;
  }
  if (parentPromptMessageId !== undefined) {
    await ctx.db.patch(turn._id, { parentPromptMessageId });
  }
  if (thread && thread.activeTipPromptMessageId !== undefined) {
    await ctx.db.patch(thread._id, { activeTipPromptMessageId: turn.promptMessageId });
  }
}

/** Make `promptMessageId` the conversation's tip (alternatives and the switcher). */
export async function setChatTip(
  ctx: MutationCtx,
  agentThreadId: string,
  promptMessageId: string
): Promise<void> {
  const thread = await threadRow(ctx, agentThreadId);
  if (thread) await ctx.db.patch(thread._id, { activeTipPromptMessageId: promptMessageId });
}

/**
 * Whether a history row, by its order, is on the active path the model
 * reads: the prompt's own order (the prompt and this turn's replies), the
 * path's orders, and everything older than the turns read.
 */
export function onHistoryPath(
  historyPath: { orders: readonly number[]; belowOrder: number },
  promptOrder: number | undefined
): (order: number) => boolean {
  const orders = new Set(historyPath.orders);
  return (order) => order === promptOrder || order < historyPath.belowOrder || orders.has(order);
}

/** The writer's own text in a stored prompt, before any block the server added. */
export const SERVER_PROMPT_MARKERS = [
  "\n\n[Writer highlighted this excerpt from the report]:\n",
  "\n\n[Writer is refining suggestion ",
] as const;

/**
 * The writer's text of a stored prompt: its first `writerTextLength`
 * characters, or, for a turn stored before that was recorded, everything
 * before the first server block.
 */
export function writerTextOf(stored: string, writerTextLength: number | undefined): string {
  if (writerTextLength !== undefined) return stored.slice(0, writerTextLength);
  let end = stored.length;
  for (const marker of SERVER_PROMPT_MARKERS) {
    const at = stored.indexOf(marker);
    if (at !== -1 && at < end) end = at;
  }
  return stored.slice(0, end);
}

/**
 * Review P3-2: the card a stored prompt's refinement block names, for a turn
 * saved before `refineProposalId` was recorded. Read only from the server's
 * own block format.
 */
export function legacyRefineProposalId(stored: string): string | undefined {
  return /\n\n\[Writer is refining suggestion ([^\s.\]]+)\. Keep this exact canonical report target:\]\n"""/.exec(stored)?.[1];
}

/** The highlight block `sendMessage` appends after the writer's text. */
export function excerptBlock(highlightText: string): string {
  return `\n\n[Writer highlighted this excerpt from the report]:\n"""${highlightText}"""`;
}

/** The refinement block `sendMessage` appends for a card being refined. */
export function refinementBlock(proposal: Doc<"chatProposals">): string {
  const pairs = proposalPairs(proposal);
  return `\n\n[Writer is refining suggestion ${proposal._id}. Keep this exact canonical report target:]
"""${pairs.map((pair) => pair.find).join("\n---\n")}"""
[Current candidate wording:]
"""${pairs.map((pair) => pair.replaceWith).join("\n---\n")}"""`;
}

/**
 * Whether a card may be refined from this report: the checks `sendMessage`
 * makes before it builds a refinement block.
 */
export function refinableProposal(
  proposal: Doc<"chatProposals"> | null,
  report: Pick<Doc<"reports">, "_id" | "projectId">
): proposal is Doc<"chatProposals"> {
  return (
    !!proposal &&
    proposal.reportId === report._id &&
    proposal.projectId === report.projectId &&
    proposal.kind !== "references" &&
    // DW-135: a record-only revision has no wording to refine.
    !isRecordOnlyProposal(proposal)
  );
}

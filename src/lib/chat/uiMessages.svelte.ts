/**
 * Svelte 5 port of @convex-dev/agent/react's useUIMessages — live thread
 * messages with token streaming over Convex subscriptions.
 *
 * Wire protocol (mirrors react/useDeltaStreams + useStreamingUIMessages):
 *  1. paginated messages: usePaginatedQuery over a query shaped like
 *     chatV2.listMessages ({ threadId, paginationOpts, streamArgs }) that
 *     returns { ...paginated, streams } via listUIMessages + syncStreams.
 *  2. active-streams subscription: same query with
 *     streamArgs { kind: "list", startOrder } → streams.messages.
 *  3. deltas subscription: streamArgs { kind: "deltas", cursors } →
 *     streams.deltas; contiguous accepted chunks enter each stream's pending
 *     queue and cursors advance (which re-subscribes). One persistent official
 *     readUIMessageStream consumes the queue; processed chunk history is freed.
 *
 * Each active stream owns one persistent AI SDK parser. Accepted chunks are
 * consumed once and published at most once per browser animation frame.
 */
import { useQuery, usePaginatedQuery } from "convex-svelte";
import type { StreamDelta, StreamMessage } from "@convex-dev/agent/validators";
import {
  combineUIMessages,
  sorted,
  type UIMessage,
} from "./agentInternal";

import { createPersistentProjection } from "./persistentProjection";

// Any query shaped like chatV2.listMessages (see convex/chatV2.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListMessagesQuery = any;

export type UIMessagesArgs = { threadId: string } | "skip";

export function createUIMessages(
  query: ListMessagesQuery,
  getArgs: () => UIMessagesArgs,
  options: { initialNumItems: number }
) {
  // ── 1. Persisted messages (paginated, live) ────────────────────────────────
  const paginated = usePaginatedQuery(query, getArgs, {
    initialNumItems: options.initialNumItems,
  });

  const pageResults = $derived(paginated.results as UIMessage[]);

  const startOrder = $derived(
    pageResults.length ? Math.min(...pageResults.map((m) => m.order)) : 0
  );

  // ── 2. Active streams ──────────────────────────────────────────────────────
  const streamListQ = useQuery(query, () => {
    const args = getArgs();
    if (args === "skip" || paginated.status === "LoadingFirstPage") return "skip";
    return {
      ...args,
      paginationOpts: { cursor: null, numItems: 0 },
      streamArgs: { kind: "list" as const, startOrder },
    };
  });

  const streamMessages: StreamMessage[] = $derived.by(() => {
    const streams = streamListQ.data?.streams;
    if (!streams || streams.kind !== "list") return [];
    // Snapshot: these rows seed the AI SDK's message assembly, which
    // structuredClone()s them — convex-svelte's deep $state proxies throw.
    return sorted($state.snapshot(streams.messages)) as StreamMessage[];
  });

  // ── 3. Accepted deltas and persistent projection ────────────────────────────
  // $state.raw: cursors/messages are replaced wholesale, never mutated in
  // place. Plain snapshots flow into the AI SDK's readUIMessageStream,
  // which structuredClone()s the assembled message. Deep $state proxies are
  // not cloneable — with plain $state every streaming update threw
  // DataCloneError ("#<Object> could not be cloned") and chat streaming died.
  let currentThreadId: string | undefined = $state(undefined);
  let cursors: Record<string, number> = $state.raw({});
  let streaming: UIMessage[] = $state.raw([]);
  const projections = new Map<string, ReturnType<typeof createPersistentProjection>>();
  let version = 0;
  let frame: number | undefined;

  function clear() {
    version++;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    for (const projection of projections.values()) void projection.dispose();
    projections.clear();
    cursors = {};
    streaming = [];
  }
  function publish(expectedVersion: number) {
    if (expectedVersion !== version || frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (expectedVersion === version) {
        streaming = sorted([...projections.values()].map(projection => projection.snapshot()));
      }
    });
  }
  $effect(() => () => clear());

  const deltasQ = useQuery(query, () => {
    const args = getArgs();
    if (args === "skip" || streamMessages.length === 0) return "skip";
    return {
      ...args,
      paginationOpts: { cursor: null, numItems: 0 },
      streamArgs: {
        kind: "deltas" as const,
        cursors: streamMessages.map(({ streamId }) => ({
          streamId,
          cursor: cursors[streamId] ?? 0,
        })),
      },
    };
  });

  const deltaResponse = $derived(deltasQ.data);

  $effect(() => {
    const args = getArgs();
    const threadId = args === "skip" ? undefined : args.threadId;
    if (threadId !== currentThreadId) {
      clear();
      currentThreadId = threadId;
    }
    if (!threadId) return;
    // An absent response is loading, not an authoritative empty list.
    const confirmedList = streamListQ.data?.streams?.kind === "list";
    const messages = streamMessages;
    const active = new Set(messages.map(message => message.streamId));
    const nextCursors = { ...cursors };
    let changed = false;
    for (const [id, projection] of projections) {
      if (confirmedList && !active.has(id)) {
        void projection.dispose();
        projections.delete(id);
        delete nextCursors[id];
        changed = true;
      }
    }
    for (const message of messages) {
      const existing = projections.get(message.streamId);
      if (existing) existing.updateStream(message);
      else {
        try { projections.set(message.streamId, createPersistentProjection(threadId, message)); }
        catch (error) { console.error("Error in stream", error); }
      }
    }

    const streams = deltaResponse?.streams;
    if (streams?.kind === "deltas") {
      // Convex subscriptions expose deep proxies; the SDK clones its input.
      const deltas = $state.snapshot(streams.deltas) as StreamDelta[];
      for (const delta of [...deltas].sort((a, b) => a.start - b.start)) {
        const projection = projections.get(delta.streamId);
        if (!projection) continue;
        const have = nextCursors[delta.streamId] ?? 0;
        if (delta.start !== have) continue; // duplicate or gap: wait for resend
        nextCursors[delta.streamId] = delta.end;
        changed = true;
        const expectedVersion = version;
        void projection.append(delta.parts).then(() => {
          if (projections.get(delta.streamId) === projection) publish(expectedVersion);
        }, error => {
          if (expectedVersion === version && projections.get(delta.streamId) === projection) {
            console.error("Error in stream", error);
          }
        });
      }
    }
    if (changed) cursors = nextCursors;
    // Also publish status-only updates and removal of one stream among many.
    publish(version);
  });

  // ── Merge: persisted + streaming, deduped by (order, stepOrder) ───────────
  const results: UIMessage[] = $derived.by(() => {
    const deduped = (
      sorted([...pageResults, ...streaming]) as UIMessage[]
    ).reduce<UIMessage[]>((msgs, msg) => {
      const last = msgs.at(-1);
      if (!last) return [msg];
      if (last.order !== msg.order || last.stepOrder !== msg.stepOrder) {
        msgs.push(msg);
        return msgs;
      }
      if (
        (last.status === "pending" || last.status === "streaming") &&
        msg.status !== "pending"
      ) {
        msgs[msgs.length - 1] = msg; // prefer finalized over pending/streaming
      }
      return msgs;
    }, []);
    return combineUIMessages(deduped) as UIMessage[];
  });

  return {
    // Local acknowledgements inspect only this thread's persisted page. Never
    // allow a streaming projection (or equal text) to acknowledge a request.
    hasPersistedMessage({ threadId, messageId }: { threadId: string; messageId: string }) {
      const args = getArgs();
      return args !== "skip" && args.threadId === threadId &&
        pageResults.some(message => message.role === "user" && message.id === messageId);
    },
    get results() {
      return results;
    },
    get status() {
      return paginated.status;
    },
    get isLoading() {
      return paginated.isLoading;
    },
    loadMore: (n: number) => paginated.loadMore(n),
  };
}

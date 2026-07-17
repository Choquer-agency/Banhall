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
 *     streams.deltas; deltas accumulate per stream, cursors advance (which
 *     re-subscribes), and accumulated UIMessageChunks materialize into
 *     UIMessages via the agent package's own derive helper (AI SDK
 *     readUIMessageStream under the hood).
 *
 * Unlike the React hook we materialize non-incrementally (full re-derive per
 * delta batch) — chat-sized messages make that a non-issue and it avoids
 * vendoring the incremental state machine.
 */
import { useQuery, usePaginatedQuery } from "convex-svelte";
import type { StreamDelta, StreamMessage } from "@convex-dev/agent/validators";
import {
  combineUIMessages,
  deriveUIMessagesFromDeltas,
  sorted,
  type UIMessage,
} from "./agentInternal";

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

  // ── 3. Delta accumulation ──────────────────────────────────────────────────
  // $state.raw: deltas/messages are replaced wholesale, never mutated in
  // place, and their contents flow into the AI SDK's readUIMessageStream,
  // which structuredClone()s the assembled message. Deep $state proxies are
  // not cloneable — with plain $state every streaming update threw
  // DataCloneError ("#<Object> could not be cloned") and chat streaming died.
  let currentThreadId: string | undefined = $state(undefined);
  let cursors: Record<string, number> = $state.raw({});
  let deltasByStream: Record<string, StreamDelta[]> = $state.raw({});
  let streaming: UIMessage[] = $state.raw([]);

  // Reset accumulated state when the thread changes.
  $effect(() => {
    const args = getArgs();
    const threadId = args === "skip" ? undefined : args.threadId;
    if (threadId !== currentThreadId) {
      currentThreadId = threadId;
      cursors = {};
      deltasByStream = {};
      streaming = [];
    }
  });

  // When no active streams remain, drop stale streaming messages.
  $effect(() => {
    if (streamListQ.data && streamMessages.length === 0 && streaming.length) {
      streaming = [];
      deltasByStream = {};
      cursors = {};
    }
  });

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

  $effect(() => {
    const streams = deltasQ.data?.streams;
    const threadId = currentThreadId;
    if (!threadId) return;
    if (streams && streams.kind === "deltas" && streams.deltas.length) {
      // Snapshot: convex-svelte hands us deep $state proxies; the AI SDK
      // structuredClone()s these parts downstream, and proxies don't clone.
      const deltas = $state.snapshot(streams.deltas) as StreamDelta[];
      let changed = false;
      const nextBuckets = { ...deltasByStream };
      const nextCursors = { ...cursors };
      for (const delta of [...deltas].sort((a, b) => a.start - b.start)) {
        const have = nextCursors[delta.streamId] ?? 0;
        if (delta.start < have) continue; // already applied
        if (delta.start > have) continue; // gap — wait for resend
        nextBuckets[delta.streamId] = [
          ...(nextBuckets[delta.streamId] ?? []),
          delta,
        ];
        nextCursors[delta.streamId] = delta.end;
        changed = true;
      }
      if (changed) {
        deltasByStream = nextBuckets;
        cursors = nextCursors; // advancing cursors re-subscribes deltasQ
      }
    }

    // Re-derive streaming UIMessages from everything accumulated so far.
    // (Also runs on stream status flips with no new deltas — cheap.)
    const messages = streamMessages;
    const allDeltas = Object.values(deltasByStream).flat();
    if (messages.length === 0) return;
    let cancelled = false;
    void deriveUIMessagesFromDeltas(threadId, messages, allDeltas).then(
      (derived: UIMessage[]) => {
        if (!cancelled) streaming = derived;
      }
    );
    return () => {
      cancelled = true;
    };
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

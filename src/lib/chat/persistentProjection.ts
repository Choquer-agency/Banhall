import { readUIMessageStream, type UIMessageChunk } from "ai";
import type { StreamMessage } from "@convex-dev/agent/validators";
import { blankUIMessage, joinText, statusFromStreamStatus, type UIMessage } from "./agentInternal";

type Batch = { parts: UIMessageChunk[]; index: number; resolve: () => void; reject: (error: unknown) => void };

/** One authoritative SDK parser for the lifetime of a stream. Only unconsumed
 * batches are retained; the SDK owns text/tool/metadata reconstruction. */
export function createPersistentProjection(threadId: string, initial: StreamMessage) {
  if (initial.format !== "UIMessageChunk") throw new Error(`Unsupported stream format ${initial.format ?? "text"}`);
  const seed = blankUIMessage(initial, threadId);
  let latest = seed;
  let published = structuredClone(seed);
  let row = initial;
  let closed = false;
  let terminalError: unknown;
  let suppressed = false;
  let wake: (() => void) | undefined;
  let acknowledgment: Batch | undefined;
  const batches: Batch[] = [];
  let inputController: ReadableStreamDefaultController<UIMessageChunk> | undefined;
  const settle = (error?: unknown) => {
    for (const batch of [...(acknowledgment ? [acknowledgment] : []), ...batches]) {
      if (error !== undefined) batch.reject(error);
      else batch.resolve();
    }
    acknowledgment = undefined;
    batches.length = 0;
    wake?.();
    wake = undefined;
  };
  const input = new ReadableStream<UIMessageChunk>({
    start(controller) { inputController = controller; },
    async pull(controller) {
      // With no read-ahead buffer, the next pull acknowledges processing of
      // the previous chunk, including the SDK's snapshot publication.
      const completed = acknowledgment;
      acknowledgment = undefined;
      if (completed) queueMicrotask(() => {
        if (terminalError !== undefined) completed.reject(terminalError);
        else {
          published = structuredClone(latest);
          completed.resolve();
        }
      });
      if (!batches.length && !closed) await new Promise<void>(resolve => { wake = resolve; });
      if (closed) return;
      const batch = batches[0];
      if (!batch) return;
      controller.enqueue(batch.parts[batch.index++]);
      if (batch.index === batch.parts.length) {
        batches.shift();
        acknowledgment = batch;
      }
    },
    cancel(reason) {
      closed = true;
      settle(suppressed ? undefined : reason);
    },
  }, { highWaterMark: 0 });

  const done = (async () => {
    try {
      for await (const message of readUIMessageStream({
        message: seed,
        stream: input,
        terminateOnError: true,
        onError(error) {
          const message = error instanceof Error ? error.message : String(error);
          // Match @convex-dev/agent's updateFromUIMessageChunks contract.
          suppressed = message.toLowerCase().includes("no tool invocation found");
          if (!suppressed) terminalError = error;
        },
      })) {
        if (message.id !== latest.id) {
          terminalError = new Error("Expecting to only make one UIMessage in a stream");
          closed = true;
          settle(terminalError);
          try { inputController?.close(); } catch { /* Disposal may already have closed input. */ }
        } else if (terminalError === undefined) latest = message;
      }
    } catch (error) {
      if (!suppressed) terminalError = error;
    } finally {
      closed = true;
      if (suppressed) published = structuredClone(latest);
      settle(terminalError);
      // Closing the input, rather than cancelling only the output iterator,
      // also releases the SDK's internal consumer and any pending pull.
      try { inputController?.close(); } catch { /* Already closed/cancelled by SDK. */ }
    }
  })();

  return {
    async append(parts: UIMessageChunk[]): Promise<void> {
      if (terminalError !== undefined) throw terminalError;
      if (closed || parts.length === 0) return;
      await new Promise<void>((resolve, reject) => {
        batches.push({ parts, index: 0, resolve, reject });
        wake?.();
        wake = undefined;
      });
      if (terminalError !== undefined) throw terminalError;
    },
    updateStream(next: StreamMessage) { row = next; },
    snapshot(): UIMessage {
      return {
        ...published,
        // These belong to the reactive stream row, not the chunk protocol.
        key: `${threadId}-${row.order}-${row.stepOrder}`,
        status: statusFromStreamStatus(row.status),
        order: row.order,
        stepOrder: row.stepOrder,
        agentName: row.agentName,
        _creationTime: Date.now(),
        text: joinText(published.parts),
      };
    },
    async dispose() {
      if (!closed) {
        closed = true;
        settle();
        inputController?.close();
      }
      await done;
    },
  };
}

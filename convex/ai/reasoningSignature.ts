import type {
  ProviderMetadata,
  StreamTextTransform,
  TextStreamPart,
  ToolSet,
} from "ai";

/**
 * Preserves Anthropic thinking-block signatures across multi-step tool turns.
 *
 * Anthropic sends a thinking block's signature on a FINAL, EMPTY
 * `reasoning-delta` (`signature_delta` →
 * `{ type: "reasoning-delta", delta: "", providerMetadata: { anthropic: { signature } } }`).
 *
 * `@convex-dev/agent` installs `smoothStream({ chunking: /[\p{P}\s]/u })`
 * whenever `saveStreamDeltas` is on. That transform emits its matched chunks
 * WITHOUT `providerMetadata`, and its buffer flush only runs when the buffer is
 * non-empty — so whenever reasoning text ends on punctuation (the common case:
 * "Checks complete."), the buffer is already drained and the signature-only
 * delta is swallowed. Reasoning text that happens to end mid-word survives,
 * which makes the failure intermittent and very hard to diagnose.
 *
 * The consequence is not cosmetic: `streamText` builds each step's response
 * messages from the POST-transform stream, so step 2+ would send a thinking
 * block back to Anthropic with no signature. Anthropic requires thinking blocks
 * in a tool-use turn to be returned complete and unmodified; the SDK drops the
 * unsigned block with an "unsupported reasoning metadata" warning, losing the
 * model's reasoning between steps.
 *
 * `mergeTransforms` places existing transforms BEFORE its `smoothStream`, so
 * this runs upstream: it lifts the signature off the doomed empty delta and
 * re-attaches it to `reasoning-end`, which `smoothStream` passes through
 * untouched. Reasoning text is unchanged.
 *
 * Revisit on any `ai`/`@convex-dev/agent` upgrade — if `smoothStream` learns to
 * carry metadata on flushed chunks, this becomes a no-op and can be deleted.
 */
export function preserveReasoningSignature<
  TOOLS extends ToolSet = ToolSet,
>(): StreamTextTransform<TOOLS> {
  return () => {
    const pending = new Map<string, ProviderMetadata>();
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (
          chunk.type === "reasoning-delta" &&
          chunk.providerMetadata &&
          !chunk.text
        ) {
          pending.set(chunk.id, chunk.providerMetadata);
          return; // Carries no text; its only payload is the signature.
        }
        if (chunk.type === "reasoning-end" && pending.has(chunk.id)) {
          const signature = pending.get(chunk.id);
          pending.delete(chunk.id);
          controller.enqueue({
            ...chunk,
            providerMetadata: chunk.providerMetadata ?? signature,
          });
          return;
        }
        controller.enqueue(chunk);
      },
    });
  };
}

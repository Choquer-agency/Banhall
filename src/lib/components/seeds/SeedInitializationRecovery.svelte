<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { userErrorMessage } from "$lib/errors";
  import Button from "$lib/components/ui/Button.svelte";

  let {
    generationId,
    message,
    canEdit,
  }: {
    generationId: Id<"generations">;
    message: string;
    canEdit: boolean;
  } = $props();

  const retryInitialize = useMutation(api.generations.retryInitializeSeedStage);
  let retrying = $state(false);
  let error = $state<string | null>(null);

  // A3/A5 (R6-07): a retry belongs to the generation that submitted it and to
  // this component's lifetime. A replaced generation starts idle, and an
  // obsolete completion changes neither its pending state nor its refusal.
  let request = 0;
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
    request += 1;
  });
  let ownedGenerationId = untrack(() => generationId);
  $effect.pre(() => {
    const current = generationId;
    untrack(() => {
      if (current === ownedGenerationId) return;
      ownedGenerationId = current;
      request += 1;
      retrying = false;
      error = null;
    });
  });

  async function retry() {
    // Capability is rechecked at dispatch, and a duplicate interaction that
    // lands before the pending state renders is refused.
    if (!canEdit || retrying) return;
    const submitted = { request: ++request, generationId };
    const current = () => !destroyed && submitted.request === request && submitted.generationId === generationId;
    retrying = true;
    error = null;
    try {
      await retryInitialize({ generationId: submitted.generationId });
    } catch (cause) {
      if (current()) error = userErrorMessage(cause, "Seed preparation could not be retried.");
    } finally {
      if (current()) retrying = false;
    }
  }
</script>

<section class="mt-4 rounded-xl border border-line bg-surface p-4" aria-labelledby="seed-initialization-title">
  <h2 id="seed-initialization-title" class="text-title">Seed preparation needs attention</h2>
  <p class="mt-1 text-body text-ink-muted">{message}</p>
  {#if error}<p role="alert" class="mt-2 text-body text-gap-text!">{error}</p>{/if}
  {#if canEdit}
    <Button class="mt-3" size="sm" onclick={retry} disabled={retrying}>
      {retrying ? "Retrying…" : "Retry initialization"}
    </Button>
  {/if}
</section>

<script lang="ts">
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

  async function retry() {
    retrying = true;
    error = null;
    try {
      await retryInitialize({ generationId });
    } catch (cause) {
      error = userErrorMessage(cause, "Seed preparation could not be retried.");
    } finally {
      retrying = false;
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

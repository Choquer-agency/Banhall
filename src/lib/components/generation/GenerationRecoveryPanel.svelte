<script lang="ts">
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import {
    recoveryExplanation,
    recoveryHeading,
    runStatusLabel,
    type GenerationRecoveryModel,
  } from "$lib/generation/recovery";

  let {
    models,
    candidatesDone,
    candidatesFailed,
    busy = false,
    error = "",
    onRetry,
    onContinue,
  }: {
    models: GenerationRecoveryModel[];
    candidatesDone: number;
    candidatesFailed: number;
    busy?: boolean;
    error?: string;
    onRetry: () => void | Promise<void>;
    onContinue?: () => void;
  } = $props();

  const isPartial = $derived(candidatesDone > 0 && candidatesFailed > 0);
</script>

<section
  class="rounded-xl border border-amber-200 bg-amber-50/60"
  aria-labelledby="generation-recovery-title"
>
  <div class="px-4 py-4 sm:px-5">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p class="text-label text-amber-800">Generation recovery</p>
        <h2 id="generation-recovery-title" class="mt-1 text-base font-semibold text-navy">
          {recoveryHeading(candidatesDone, candidatesFailed)}
        </h2>
        <p class="mt-1 max-w-2xl text-sm leading-relaxed text-gray-600">
          {recoveryExplanation(candidatesDone, candidatesFailed)}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button class="min-h-11" onclick={onRetry} disabled={busy}>
          {#if busy}<Spinner size="sm" class="border-white" />{/if}
          {busy ? "Retrying…" : isPartial ? "Retry failed drafts" : "Try again"}
        </Button>
        {#if isPartial && onContinue}
          <Button class="min-h-11" variant="secondary" onclick={onContinue}>Continue with ready drafts</Button>
        {/if}
      </div>
    </div>

    {#if models.length > 0}
      <ul class="mt-4 divide-y divide-amber-200/70 border-y border-amber-200/70">
        {#each models as model (`${model.model}-${model.status}`)}
          <li class="flex min-h-11 items-center justify-between gap-4 py-2.5 text-sm">
            <span class="font-medium text-gray-800">{model.label}</span>
            <span
              class={`rounded-full px-2.5 py-1 text-xs font-medium ${
                model.status === "succeeded"
                  ? "bg-green-100 text-green-800"
                  : model.status === "failed"
                    ? "bg-red-100 text-red-700"
                    : "bg-blue-100 text-blue-700"
              }`}
            >
              {runStatusLabel(model.status)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if error}
      <p class="mt-3 text-sm text-red-700" role="alert">{error}</p>
    {/if}
  </div>
</section>

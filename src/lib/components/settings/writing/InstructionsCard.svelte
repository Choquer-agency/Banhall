<script lang="ts">
  // I2 "Your instructions": the first 200 characters and the count.
  import { instructionsExcerpt } from "$lib/settings/writingAreas";
  import { MAX_INSTRUCTIONS_CHARS } from "../../../../../shared/writerProfileLimits";

  let { text, onEdit, notice = "" }: { text: string; onEdit: () => void; notice?: string } = $props();
  const tooLong = $derived(text.length > MAX_INSTRUCTIONS_CHARS);
  const count = $derived(text.length.toLocaleString("en-US"));
  const max = MAX_INSTRUCTIONS_CHARS.toLocaleString("en-US");
</script>

<section data-instructions-card class="flex flex-col gap-2.5 rounded-xl border border-line-soft bg-surface p-4">
  <div class="flex items-center">
    <h3 class="flex-1 text-sm leading-5 font-medium text-ink">Your instructions</h3>
    {#if text.trim()}
      <button type="button" data-instructions-edit onclick={onEdit} class="rounded text-xs leading-4 font-medium text-primary-selected hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Edit</button>
    {/if}
  </div>
  {#if text.trim()}
    <p data-instructions-excerpt class="font-serif text-[13px] leading-5 text-ink-secondary [overflow-wrap:anywhere]">"{instructionsExcerpt(text)}"</p>
    <p data-instructions-count class={`text-xs leading-4 ${tooLong ? "text-danger-ink-muted" : "text-ink-faint"}`} aria-live={tooLong ? "polite" : "off"}>
      {#if tooLong}
        {count} of {max} characters. Shorten your instructions to save them.
      {:else}
        {count} of {max} characters. You can paste your own writing here too.
      {/if}
    </p>
  {:else}
    <p data-instructions-empty class="text-[13px] leading-5 text-ink-muted">No instructions yet. Paste how you write, or a sample of your writing.</p>
    <button type="button" onclick={onEdit} class="self-start rounded-lg bg-chrome px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Add instructions</button>
  {/if}
  {#if notice}
    <p role="status" data-prefill-notice class="text-[13px] leading-5 text-ink-secondary">{notice}</p>
  {/if}
</section>

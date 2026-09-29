<script lang="ts">
  // I2 Preview: House style or With your preferences, a sample 242 paragraph
  // from ai/stylePreview. Loading shows grey skeleton lines.
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import type { FunctionArgs } from "convex/server";
  import type { api } from "../../../../../convex/_generated/api";

  type StylePreviewVariant = FunctionArgs<typeof api.ai.stylePreview.previewMyStyle>["variant"];

  let {
    variant = $bindable("preferences"),
    preview,
    onRetry,
  }: {
    variant?: StylePreviewVariant;
    preview:
      | { kind: "loading" }
      | { kind: "ready"; paragraphs: string[] }
      | { kind: "limit"; message: string }
      | { kind: "error" };
    onRetry: () => void;
  } = $props();

  const SEGMENTS: Array<{ value: StylePreviewVariant; label: string }> = [
    { value: "house", label: "House style" },
    { value: "preferences", label: "With your preferences" },
  ];
</script>

<section data-style-preview={variant} class="flex min-w-0 flex-1 flex-col gap-3.5 rounded-[0.875rem] border border-line-soft bg-surface px-[1.625rem] py-[1.375rem] shadow-settings-card">
  <div class="flex flex-wrap items-center gap-2.5">
    <h3 class="flex-1 text-[0.8125rem] leading-[1.125rem] font-medium text-ink-muted">Preview</h3>
    <div role="radiogroup" aria-label="Preview style" class="flex gap-1 rounded-[0.625rem] bg-chrome p-1">
      {#each SEGMENTS as segment (segment.value)}
        <button
          type="button"
          role="radio"
          aria-checked={variant === segment.value}
          data-preview-segment={segment.value}
          onclick={() => (variant = segment.value)}
          class={`h-[1.875rem] rounded-[0.4375rem] px-3 text-[0.8125rem] leading-[1.125rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${variant === segment.value ? "bg-surface text-ink shadow-settings-segment" : "text-ink-secondary hover:bg-primary-wash hover:text-ink"}`}
        >{segment.label}</button>
      {/each}
    </div>
  </div>
  <p data-preview-section class="font-mono text-[0.6875rem] leading-[0.875rem] text-ink-faint">Section 242</p>
  <h4 data-preview-heading class="font-serif text-[1.25rem] font-normal leading-[1.625rem] text-ink">Technological uncertainty</h4>
  <div aria-live="polite" class="flex min-h-[8rem] flex-col gap-3.5">
    {#if preview.kind === "loading"}
      <div data-preview-loading role="status" aria-label="Writing the preview" class="flex max-w-3xl flex-col gap-2.5 pt-1">
        {#each [100, 96, 88, 100, 72] as width, index (index)}
          <span class="h-3.5 animate-pulse rounded bg-chrome motion-reduce:animate-none" style={`width:${width}%`}></span>
        {/each}
      </div>
    {:else if preview.kind === "ready"}
      {#each preview.paragraphs as paragraph, index (index)}
        <p data-preview-paragraph class="max-w-3xl font-serif text-base leading-[1.6875rem] text-ink">{paragraph}</p>
      {/each}
    {:else if preview.kind === "limit"}
      <p data-preview-limit class="text-[0.8125rem] leading-5 text-ink-muted">{preview.message}</p>
    {:else}
      <div data-preview-error class="flex flex-col items-start gap-2">
        <p role="alert" class="text-[0.8125rem] leading-5 text-danger-ink-muted">The preview could not be written. Try again.</p>
        <button type="button" onclick={onRetry} class="rounded-lg bg-chrome px-3 py-1.5 text-[0.8125rem] font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Try again</button>
      </div>
    {/if}
  </div>
  <div class="flex items-center gap-2 border-t border-line-soft pt-1.5">
    <AuroraMark size={14} />
    <p class="text-xs leading-4 text-ink-muted">
      {variant === "preferences"
        ? "A sample 242 paragraph written with your preferences."
        : "A sample 242 paragraph written with the house rules."}
    </p>
  </div>
</section>

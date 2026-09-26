<script lang="ts">
  /**
   * Keyboard key chips (I4, I5): 24px tall, min 24px wide, radius 5, white
   * with a `line` border, 12px/500 ink. A sequence reads "G then A" with a
   * faint "then". `inline` renders the plain text hint used in menus and
   * tooltips ("⇧V", "Shift V", "G then A").
   */
  import {
    SHORTCUTS,
    detectPlatform,
    keysFor,
    shortcutHint,
    type Platform,
    type ShortcutId,
  } from "$lib/shell/shortcuts";

  let {
    id,
    platform = undefined,
    variant = "chips",
    class: className = "",
  }: {
    id: ShortcutId;
    platform?: Platform;
    variant?: "chips" | "inline";
    class?: string;
  } = $props();

  const resolved = $derived(platform ?? detectPlatform());
  const keys = $derived(keysFor(id, resolved));
  const sequence = $derived(SHORTCUTS[id].kind === "sequence");
</script>

{#if variant === "inline"}
  <span data-key-hint={id} class={`whitespace-nowrap text-xs leading-4 text-ink-faint ${className}`}>{shortcutHint(id, resolved)}</span>
{:else}
  <span data-key-hint={id} class={`inline-flex items-center gap-1 ${className}`}>
    {#each keys as key, index (index)}
      {#if sequence && index > 0}
        <span class="text-xs leading-4 text-ink-faint">then</span>
      {/if}
      <kbd
        class="inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-line bg-surface px-1.5 font-sans text-xs font-medium leading-4 text-ink"
      >{key}</kbd>
    {/each}
  </span>
{/if}

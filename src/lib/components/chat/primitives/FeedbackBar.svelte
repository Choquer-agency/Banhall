<script lang="ts">
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { cn } from "$lib/utils";

  interface Props {
    title?: string;
    value?: 1 | -1 | null;
    disabled?: boolean;
    onHelpful?: () => void | Promise<void>;
    onNotHelpful?: () => void | Promise<void>;
    onClose?: () => void;
    class?: string;
  }

  let {
    title = "Was this research useful?",
    value = null,
    disabled = false,
    onHelpful,
    onNotHelpful,
    onClose,
    class: className,
  }: Props = $props();
</script>

<div class={cn("flex items-center gap-1.5 py-1 text-xs text-ink-muted", className)}>
  <span class="mr-1">{value ? "Feedback recorded" : title}</span>

  <Tooltip text="Helpful" side="bottom" delayDuration={300}>
    {#snippet children({ props })}
      <button
        {...props}
        type="button"
        aria-label="Mark response helpful"
        aria-pressed={value === 1}
        disabled={disabled || value !== null}
        onclick={onHelpful}
        class={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-default ${
          value === 1
            ? "bg-primary-wash text-primary-selected"
            : "text-ink-muted hover:bg-primary-wash hover:text-navy disabled:opacity-50"
        }`}
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 10v11M14 5.7 13 10h6a2 2 0 0 1 1.9 2.6l-2.1 7A2 2 0 0 1 16.9 21H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.7-1L13 3a3 3 0 0 1 1 2.7Z" />
        </svg>
      </button>
    {/snippet}
  </Tooltip>

  <Tooltip text="Not helpful" side="bottom" delayDuration={300}>
    {#snippet children({ props })}
      <button
        {...props}
        type="button"
        aria-label="Mark response not helpful"
        aria-pressed={value === -1}
        disabled={disabled || value !== null}
        onclick={onNotHelpful}
        class={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-default ${
          value === -1
            ? "bg-red-50 text-red-600"
            : "text-ink-muted hover:bg-primary-wash hover:text-navy disabled:opacity-50"
        }`}
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17 14V3M10 18.3l1-4.3H5a2 2 0 0 1-1.9-2.6l2.1-7A2 2 0 0 1 7.1 3H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.7 1L11 21a3 3 0 0 1-1-2.7Z" />
        </svg>
      </button>
    {/snippet}
  </Tooltip>

  {#if onClose}
    <Tooltip text="Dismiss" side="bottom" delayDuration={300}>
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          aria-label="Dismiss feedback question"
          onclick={onClose}
          class="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-primary-wash hover:text-navy"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      {/snippet}
    </Tooltip>
  {/if}
</div>

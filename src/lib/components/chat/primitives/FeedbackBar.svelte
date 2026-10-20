<script lang="ts">
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import { cn } from "$lib/utils";

  type Reason = { code: string; label: string };

  interface Props {
    title?: string;
    value?: 1 | -1 | null;
    disabled?: boolean;
    /**
     * Chat parity Phase C: a recorded vote can still be changed (the report
     * chat). Without it a vote is final (research feedback).
     */
    changeable?: boolean;
    /** Phase C: reasons offered after a thumbs down, with optional text. */
    reasons?: readonly Reason[];
    reasonCode?: string | null;
    reasonText?: string | null;
    reasonTextMax?: number;
    onReason?: (code: string, text: string) => void | Promise<void>;
    onHelpful?: () => void | Promise<void>;
    onNotHelpful?: () => void | Promise<void>;
    onClose?: () => void;
    class?: string;
  }

  let {
    title = "Was this research useful?",
    value = null,
    disabled = false,
    changeable = false,
    reasons,
    reasonCode = null,
    reasonText = null,
    reasonTextMax = 500,
    onReason,
    onHelpful,
    onNotHelpful,
    onClose,
    class: className,
  }: Props = $props();

  const componentId = $props.id();
  const reasonsLabelId = `${componentId}-reasons`;
  const locked = $derived(disabled || (!changeable && value !== null));
  const showReasons = $derived(value === -1 && !!reasons?.length && !!onReason);

  // The text field holds the writer's words until they send them; a saved
  // reason from the server fills it when it changes.
  let draft = $state("");
  let shownReasonText: string | null = null;
  $effect(() => {
    const saved = reasonText ?? "";
    if (saved !== shownReasonText) {
      shownReasonText = saved;
      draft = saved;
    }
  });
  const draftChanged = $derived(draft.trim() !== (reasonText ?? "").trim());

  function chooseReason(code: string) {
    if (disabled) return;
    void onReason?.(code, draft.trim());
  }

  function sendText() {
    if (disabled || !draftChanged) return;
    void onReason?.(reasonCode ?? "other", draft.trim());
  }
</script>

<div class={cn("flex flex-col gap-1.5 py-1 text-xs text-ink-muted", className)}>
  <div class="flex items-center gap-1.5">
    <span class="mr-1">{value ? (changeable ? "Feedback recorded. You can change it." : "Feedback recorded") : title}</span>

    <Tooltip text="Helpful" side="bottom" delayDuration={300}>
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          aria-label="Mark response helpful"
          aria-pressed={value === 1}
          disabled={locked || (changeable && value === 1)}
          onclick={onHelpful}
          class={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-default pointer-coarse:size-11 ${
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
          disabled={locked || (changeable && value === -1)}
          onclick={onNotHelpful}
          class={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-default pointer-coarse:size-11 ${
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
            class="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-primary-wash hover:text-navy pointer-coarse:size-11"
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        {/snippet}
      </Tooltip>
    {/if}
  </div>

  {#if showReasons && reasons}
    <!-- Phase C: why a thumbs down, from a short fixed list plus optional
         words. Choosing a reason saves it. -->
    <div class="flex flex-col gap-1.5" data-feedback-reasons>
      <span id={reasonsLabelId} class="sr-only">Reason for not helpful</span>
      <div role="group" aria-labelledby={reasonsLabelId} class="flex flex-wrap gap-1.5">
        {#each reasons as reason (reason.code)}
          <button
            type="button"
            aria-pressed={reasonCode === reason.code}
            {disabled}
            onclick={() => chooseReason(reason.code)}
            class={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs transition-colors disabled:opacity-50 pointer-coarse:min-h-11 ${
              reasonCode === reason.code
                ? "border-primary-selected bg-primary-wash text-primary-selected"
                : "border-line text-ink-secondary hover:bg-primary-wash hover:text-navy"
            }`}
          >
            {reason.label}
          </button>
        {/each}
      </div>
      <form
        class="flex items-center gap-1.5"
        onsubmit={(event) => {
          event.preventDefault();
          sendText();
        }}
      >
        <div class="min-w-0 flex-1">
          <Input
            bind:value={draft}
            maxlength={reasonTextMax}
            {disabled}
            placeholder="What went wrong? (optional)"
            aria-label="What went wrong? (optional)"
            class="h-8 w-full px-2.5 py-1 text-xs pointer-coarse:h-11"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || !draftChanged}
          class="inline-flex min-h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-medium text-primary-selected transition-colors hover:bg-primary-wash disabled:opacity-40 pointer-coarse:min-h-11"
        >
          Send
        </button>
      </form>
    </div>
  {/if}
</div>

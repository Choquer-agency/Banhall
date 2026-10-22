<script lang="ts">
  import { ActionButton } from "./primitives";
  import {
    alternativeAccessibleName,
    alternativeCounter,
    type TurnAlternatives,
  } from "$lib/chat/alternatives";

  /**
   * Phase C (W2): under a writer message, Edit, the switcher between its
   * alternatives ("2 / 3") and who made this one ("Edited by you").
   */
  interface Props {
    edit?: { disabled: boolean; onEdit: () => void };
    alternatives?: TurnAlternatives;
    switchDisabled?: boolean;
    onSwitch?: (promptMessageId: string) => Promise<void> | void;
    authorLine?: string | null;
    error?: string | null;
  }

  let { edit, alternatives, switchDisabled = false, onSwitch, authorLine = null, error = null }: Props = $props();

  let switching = $state(false);
  async function go(promptMessageId: string | undefined) {
    if (!promptMessageId || switching || switchDisabled) return;
    switching = true;
    try {
      await onSwitch?.(promptMessageId);
    } finally {
      switching = false;
    }
  }
</script>

{#if edit || alternatives || authorLine || error}
  <div class="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[0.6875rem] leading-[calc(16/11)] text-ink-muted" data-writer-footer>
    {#if authorLine}
      <span data-alternative-author>{authorLine}</span>
    {/if}
    {#if alternatives}
      <div class="flex items-center gap-0.5" role="group" aria-label={alternativeAccessibleName(alternatives)} data-alternative-switcher>
        <ActionButton variant="icon" class="size-7 pointer-coarse:size-11"
          aria-label="Previous response"
          disabled={!alternatives.previousPromptMessageId || switchDisabled || switching}
          onclick={() => go(alternatives?.previousPromptMessageId)}>
          <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6" />
          </svg>
        </ActionButton>
        <span class="text-data min-w-8 text-center" aria-hidden="true">{alternativeCounter(alternatives)}</span>
        <ActionButton variant="icon" class="size-7 pointer-coarse:size-11"
          aria-label="Next response"
          disabled={!alternatives.nextPromptMessageId || switchDisabled || switching}
          onclick={() => go(alternatives?.nextPromptMessageId)}>
          <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="m9 18 6-6-6-6" />
          </svg>
        </ActionButton>
      </div>
    {/if}
    {#if edit}
      <!-- Revealed on hover or focus, like the reply's actions (the
           message wrapper carries `group`). -->
      <span class="flex opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:has-focus-visible:opacity-100 motion-reduce:transition-none">
        <ActionButton variant="ghost" class="min-h-7 px-2 pointer-coarse:min-h-11" disabled={edit.disabled}
          onclick={edit.onEdit} data-edit-message>Edit</ActionButton>
      </span>
    {/if}
    {#if error}
      <p class="w-full text-right text-xs text-red-600" role="alert">{error}</p>
    {/if}
  </div>
{/if}

<script lang="ts">
  // 2026-11-02 (client meeting, rule overrides): a manager applies a card
  // that goes against a house rule, the template or a CRA limit only after
  // this confirmation names those rules. The server checks the same names
  // (`chatV2.applyProposal`); Cancel applies nothing.
  import { AlertDialog } from "bits-ui";
  import {
    CRA_LIMIT_EXPORT_NOTE,
    breaksCraLimit,
    brokenRuleLabel,
    describeBrokenRules,
    type BrokenRule,
  } from "../../../../shared/ruleOverride";

  let {
    open = $bindable(false),
    rules,
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    rules: BrokenRule[];
    onConfirm: () => void;
    onCancel?: () => void;
  } = $props();

  let cancelButton: HTMLButtonElement | null = $state(null);
  const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  let confirmed = false;
</script>

<AlertDialog.Root
  bind:open
  onOpenChange={(next) => {
    if (next) {
      confirmed = false;
    } else if (!confirmed) {
      onCancel?.();
    }
  }}
>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="fixed inset-0 z-[130] bg-dialog-scrim" />
    <AlertDialog.Content
      data-rule-override-dialog
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        cancelButton?.focus();
      }}
      class="fixed left-1/2 top-1/2 z-[130] w-[calc(100%-2rem)] max-w-[27rem] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface shadow-dialog"
    >
      <div class="flex flex-col gap-1.5 px-6 pt-6">
        <AlertDialog.Title class="text-lg leading-[calc(4/3)] font-medium text-ink">Apply this change?</AlertDialog.Title>
        <AlertDialog.Description class="text-sm leading-[calc(10/7)] text-ink-muted">
          {describeBrokenRules(rules)} Apply it anyway?
        </AlertDialog.Description>
      </div>
      <ul class="mx-6 mt-4 flex flex-col gap-2 rounded-lg border border-warning-line bg-warning-surface px-3.5 py-3" aria-label="Rules this change goes against">
        {#each rules as rule (rule.name)}
          <li class="flex flex-col gap-0.5" data-rule-override-rule>
            <span class="text-[0.8125rem] leading-[calc(18/13)] font-medium text-warning-ink">{sentenceCase(brokenRuleLabel(rule))}</span>
            <span class="text-xs leading-[calc(4/3)] text-warning-body">{rule.reason}</span>
          </li>
        {/each}
      </ul>
      {#if breaksCraLimit(rules)}
        <p class="px-6 pt-3 text-xs leading-[calc(4/3)] text-warning-body" data-rule-override-export-note>{CRA_LIMIT_EXPORT_NOTE}</p>
      {/if}
      <p class="px-6 pt-3 text-xs leading-[calc(4/3)] text-ink-muted">Your name is kept with this change.</p>
      <div class="flex items-center justify-end gap-2 px-6 pt-5 pb-5">
        <AlertDialog.Cancel
          bind:ref={cancelButton}
          data-rule-override-cancel
          class="h-9 rounded-lg bg-chrome px-3.5 pointer-coarse:h-11 text-sm leading-[calc(10/7)] font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >Cancel</AlertDialog.Cancel>
        <AlertDialog.Action
          data-rule-override-confirm
          onclick={() => {
            confirmed = true;
            open = false;
            onConfirm();
          }}
          class="h-9 rounded-lg bg-warning-action px-4 pointer-coarse:h-11 text-sm leading-[calc(10/7)] font-medium text-white hover:bg-warning-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning focus-visible:ring-offset-2"
        >Apply anyway</AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>

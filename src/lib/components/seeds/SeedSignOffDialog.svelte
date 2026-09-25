<script lang="ts">
  /**
   * Sign-off confirm (ui-design-final.md section 5, board 3.4). Nothing starts
   * until the primary button is pressed; the owner re-checks its version fence
   * at that moment through `onConfirm`.
   *
   * Focus: opening lands on "Keep reviewing" (the action that changes
   * nothing). Closing without confirming returns focus to `returnFocus()`.
   * Confirming skips that restore, so the host's own move (to the workspace
   * or to the drafting progress) always wins.
   */
  import { tick } from "svelte";
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import Button from "$lib/components/ui/Button.svelte";

  let {
    open = $bindable(false),
    stepCount,
    editedCount,
    modelLabel,
    canConfirm,
    changedNotice = null,
    onConfirm,
    returnFocus,
  }: {
    open?: boolean;
    /** Every planning step; all are decided whenever sign-off is offered. */
    stepCount: number;
    /** Seeds whose wording the writer changed by hand. */
    editedCount: number;
    modelLabel: string;
    /** False while the Summary under review is no longer the current one. */
    canConfirm: boolean;
    /** Why confirming is unavailable right now, shown in the dialog. */
    changedNotice?: string | null;
    /** Starts sign-off; returns false when the fence refused it (the dialog
     * then stays open). */
    onConfirm: () => boolean;
    returnFocus: () => HTMLElement | null | undefined;
  } = $props();

  const keepReviewingId = $props.id();
  // Set only by a confirmed close, so the restore is skipped for it alone.
  let confirmedClose = false;

  function confirm() {
    if (!canConfirm) return;
    confirmedClose = true;
    if (!onConfirm()) confirmedClose = false;
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(isOpen) => {
    if (isOpen) confirmedClose = false;
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}
          <!-- Near-black fir scrim over the Summary. -->
          <div {...props} transition:overlayFade data-signoff-scrim class="fixed inset-0 z-[110] bg-[#010505]/75"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <!-- Set a little above centre on tall screens, as on board 3.4. -->
    <div class="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4 [@media(min-height:640px)]:pb-24">
      <Dialog.Content
        forceMount
        onOpenAutoFocus={(event) => {
          const keepReviewing = document.getElementById(keepReviewingId);
          if (!keepReviewing) return;
          event.preventDefault();
          keepReviewing.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (confirmedClose) {
            confirmedClose = false;
            return;
          }
          // After the page behind the dialog is interactive again.
          void tick().then(() => returnFocus()?.focus());
        }}
      >
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              transition:modalPop
              data-signoff-dialog
              class="pointer-events-auto flex max-h-[calc(100dvh-2rem)] [@media(min-height:640px)]:max-h-[calc(100dvh-7rem)] w-full max-w-[536px] flex-col overflow-hidden rounded-[16px] border border-line bg-surface shadow-2xl"
            >
              <div class="flex items-start gap-4 border-b border-line-soft pt-[26px] pr-6 pb-5 pl-7">
                <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Dialog.Title class="text-title leading-6">Sign off and generate the PD?</Dialog.Title>
                  <Dialog.Description class="text-body leading-5 text-ink-muted!">
                    We will draft sections 242, 244 and 246 from this plan. Once you sign off, the plan is locked and later changes happen in the report.
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  aria-label="Close"
                  class="-mt-2.5 -mr-2.5 flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink motion-reduce:transition-none"
                >
                  <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </Dialog.Close>
              </div>

              <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-7 pt-6 pb-7">
                <div class="flex items-start gap-2.5" data-signoff-row="decided">
                  <span class="flex size-5 shrink-0 items-center justify-center rounded-full" style="background:#DCFCE7" aria-hidden="true">
                    <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </span>
                  <p class="text-body leading-5 text-ink!">All {stepCount} steps decided</p>
                </div>
                {#if editedCount > 0}
                  <div class="flex items-start gap-2.5" data-signoff-row="edited">
                    <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-gap-bg text-gap-text" aria-hidden="true">
                      <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                    </span>
                    <div class="flex flex-col gap-0.5">
                      <p class="text-body leading-5 text-ink!">{editedCount} {editedCount === 1 ? "seed" : "seeds"} edited by hand</p>
                      <p class="text-[13px] leading-[18px] text-ink-muted">They are drafted as written, not quoted from the interview.</p>
                    </div>
                  </div>
                {/if}
                <div class="flex items-start gap-2.5" data-signoff-row="model">
                  <AuroraMark size={20} />
                  <p class="text-body leading-5 text-ink!">Written by {modelLabel}</p>
                </div>
                <p class="mt-1 rounded-[10px] bg-canvas px-3 py-2.5 text-[13px] leading-[18px] text-ink-secondary">
                  Takes about three minutes. You can leave this page; we will let you know when the draft is ready.
                </p>
                {#if changedNotice}
                  <p role="status" data-signoff-changed class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">{changedNotice}</p>
                {/if}
              </div>

              <div class="flex flex-col-reverse gap-2.5 border-t border-line-soft bg-surface px-7 py-[18px] sm:flex-row sm:justify-end">
                <Dialog.Close>
                  {#snippet child({ props: closeProps })}
                    <Button {...closeProps} id={keepReviewingId} variant="secondary" size="sm" class="min-h-9">Keep reviewing</Button>
                  {/snippet}
                </Dialog.Close>
                <Button size="sm" class="min-h-9" disabled={!canConfirm} onclick={confirm}>Sign off and generate PD</Button>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>

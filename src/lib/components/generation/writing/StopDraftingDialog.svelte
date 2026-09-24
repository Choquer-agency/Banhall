<!--
  Stop confirmation for a signed-off draft (ui-design-final.md section 6, FR-43;
  owner decision 20). Nothing stops until "Stop" is pressed.
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import Button from "$lib/components/ui/Button.svelte";
  import { overlayFade, modalPop } from "$lib/motion";

  let {
    open = $bindable(false),
    currentSectionNumber = null,
    busy = false,
    errorMessage = null,
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    /** The Section being written; it finishes before the run stops. */
    currentSectionNumber?: string | null;
    busy?: boolean;
    errorMessage?: string | null;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
  } = $props();

  function keepWriting() {
    open = false;
    onCancel?.();
  }

  let confirming = $state(false);

  async function confirm() {
    if (busy || confirming) return;
    confirming = true;
    try {
      await onConfirm();
      // Closed without onCancel: the run is stopping, not continuing.
      open = false;
    } catch (error) {
      // The host reports the failure through `errorMessage`; keep the dialog open.
      console.error("Stop request failed", error);
    } finally {
      confirming = false;
    }
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(isOpen) => {
    if (!isOpen) onCancel?.();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}
          <div {...props} transition:overlayFade class="fixed inset-0 z-[110] bg-[#052A28]/80"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4">
      <Dialog.Content forceMount>
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              transition:modalPop
              data-stop-drafting-dialog
              class="card pointer-events-auto flex w-full max-w-[480px] flex-col overflow-hidden rounded-2xl p-0 shadow-xl"
            >
              <div class="flex flex-col gap-2 px-6 pb-4 pt-6">
                <Dialog.Title class="text-title">Stop writing the draft?</Dialog.Title>
                <Dialog.Description class="flex flex-col gap-2 text-sm leading-relaxed text-ink-secondary">
                  {#if currentSectionNumber}
                    <span class="block">Section {currentSectionNumber} finishes first, then writing stops.</span>
                  {/if}
                  <span class="block">
                    Sections already drafted stay in the report and you can edit them. The rest are marked
                    Not drafted, and QA does not run on this draft.
                  </span>
                  <span class="block">
                    Later, Draft the rest fills in only the missing sections in this same report and keeps your
                    edits.
                  </span>
                </Dialog.Description>
              </div>

              {#if errorMessage}
                <p class="mx-6 mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {errorMessage}
                </p>
              {/if}

              <div class="flex flex-col-reverse gap-2 border-t border-line-soft px-6 py-4 sm:flex-row sm:justify-end">
                <Button variant="secondary" size="sm" class="h-9" onclick={keepWriting} data-stop-cancel>
                  Keep writing
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  class="h-9"
                  disabled={busy || confirming}
                  onclick={confirm}
                  data-stop-confirm
                >
                  {busy || confirming ? "Stopping…" : "Stop"}
                </Button>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>

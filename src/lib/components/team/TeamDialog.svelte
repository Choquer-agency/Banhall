<script lang="ts">
  // Shared frame for the Team dialogs (C3 invite, C5 revoke, temporary
  // password): the board scrim, radius 16, the dialog shadow, header padding
  // 24/20/0/28, title 18/24 500, muted 14/20 subtitle and a 32px close button
  // (18px close icon, stroke 2) top right.
  import type { Snippet } from "svelte";
  import { Dialog } from "bits-ui";
  import { IconClose } from "$lib/components/icons";
  import { overlayFade, modalPop } from "$lib/motion";

  let {
    open = $bindable(false),
    title,
    description = undefined,
    width = 540,
    busy = false,
    children,
    footer,
    testId = undefined,
  }: {
    open?: boolean;
    title: string;
    description?: string;
    width?: number;
    busy?: boolean;
    children?: Snippet;
    footer?: Snippet;
    testId?: string;
  } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}<div {...props} transition:overlayFade data-team-dialog-scrim class="fixed inset-0 z-[130] bg-dialog-scrim"></div>{/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[130] flex items-end sm:items-center sm:justify-center sm:p-4">
      <Dialog.Content
        forceMount
        onEscapeKeydown={(event) => { if (busy) event.preventDefault(); }}
        onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
      >
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              transition:modalPop
              data-testid={testId}
              style={`max-width:${width}px`}
              class="pointer-events-auto flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-dialog sm:rounded-2xl"
            >
              <div class="flex items-start gap-4 pl-7 pr-5 pt-6">
                <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Dialog.Title class="text-lg leading-6 font-medium text-ink">{title}</Dialog.Title>
                  {#if description}
                    <Dialog.Description class="text-sm leading-5 text-ink-muted">{description}</Dialog.Description>
                  {/if}
                </div>
                <Dialog.Close
                  disabled={busy}
                  aria-label="Close"
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-primary-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                >
                  <IconClose size={18} strokeWidth={2} />
                </Dialog.Close>
              </div>
              <div class="min-h-0 overflow-y-auto">
                {@render children?.()}
              </div>
              {@render footer?.()}
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>

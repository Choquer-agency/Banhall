<script lang="ts">
  // Shared frame for the Team dialogs (C3 invite, C5 revoke, temporary
  // password): radius 16, header padding 24/20/0/28, title 18px 500, muted
  // 14px subtitle and a close button top right.
  import type { Snippet } from "svelte";
  import { Dialog } from "bits-ui";
  import { XIcon } from "phosphor-svelte";
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
        {#if isOpen}<div {...props} transition:overlayFade class="fixed inset-0 z-[130] bg-fir/40"></div>{/if}
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
              class="pointer-events-auto flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-popover sm:rounded-2xl"
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
                  <XIcon size={18} aria-hidden="true" />
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

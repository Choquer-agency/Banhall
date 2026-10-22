<!--
  The one frame every form dialog on the Projects page uses (Paper Z7m,
  2026-10-19): Edit details, bulk edit, New client and Merge clients. A
  centered bits-ui Dialog over a dark scrim: the title (18/24 500) with an
  optional short description and the close button, a body that scrolls on
  its own, and a grey footer band with the actions on the right (Cancel,
  then the main action). Every field inside reads light grey (the
  `[data-form-dialog]` rules in layout.css), so hosts never style that.

  While a save or apply runs (`busy`) nothing closes the dialog; the host
  disables its own Cancel too. While there are unsaved edits (`dirty`)
  Escape and a click outside do not discard them silently: the dialog stays
  and `onEscapeBlocked` lets the host say how to leave (Cancel, or the
  close button).
-->
<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { Dialog } from "bits-ui";
  import { IconClose } from "$lib/components/icons";
  import { modalPop, overlayFade } from "$lib/motion";

  let {
    open = $bindable(false),
    title,
    description = undefined,
    srDescription = undefined,
    width = 520,
    busy = false,
    dirty = false,
    onEscapeBlocked = undefined,
    initialFocus = undefined,
    returnFocus = undefined,
    closeButton = $bindable(null),
    testId = undefined,
    children,
    footer,
    footerNote = undefined,
  }: {
    open?: boolean;
    title: string;
    /** One short visible line under the title. */
    description?: string;
    /** A description for screen readers only, when nothing shows. */
    srDescription?: string;
    /** Width in px at the 16px root (600 for Edit details, 520 otherwise). */
    width?: number;
    /** A save or apply is running: Escape, a click outside and Close do nothing. */
    busy?: boolean;
    /** Unsaved edits: Escape and a click outside keep the dialog open. */
    dirty?: boolean;
    /** Escape or a click outside over unsaved edits (not while busy). */
    onEscapeBlocked?: () => void;
    /** The element to focus on open; the first focusable one when absent. */
    initialFocus?: () => HTMLElement | null | undefined;
    /** The element to focus on close, asked for once the page has settled. */
    returnFocus?: () => HTMLElement | null | undefined;
    /** The close button, for hosts that focus it first. */
    closeButton?: HTMLButtonElement | null;
    testId?: string;
    children: Snippet;
    /** The footer actions, Cancel first and the main action last. */
    footer: Snippet;
    /** A short line at the footer's left (an Escape hint, a skip note). */
    footerNote?: Snippet;
  } = $props();
</script>

<!-- The shared overlay motion ($lib/motion): the scrim fades, the dialog
     rises and settles on the way in and sinks away on the way out. A
     centering layer keeps the dialog's own transform free for the motion. -->
<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}<div {...props} transition:overlayFade data-form-dialog-scrim class="fixed inset-0 z-[105] bg-form-dialog-scrim"></div>{/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[105] flex items-center justify-center p-4">
      <Dialog.Content
        forceMount
        onOpenAutoFocus={(event) => {
          const target = initialFocus?.();
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return;
          event.preventDefault();
          // After the page behind the dialog is interactive again.
          void tick().then(() => returnFocus?.()?.focus());
        }}
        onEscapeKeydown={(event) => {
          if (busy) {
            event.preventDefault();
          } else if (dirty) {
            event.preventDefault();
            onEscapeBlocked?.();
          }
        }}
        onInteractOutside={(event) => {
          if (busy) {
            event.preventDefault();
          } else if (dirty) {
            event.preventDefault();
            onEscapeBlocked?.();
          }
        }}
      >
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              transition:modalPop
              data-form-dialog
              data-testid={testId}
              style={`width:${width / 16}rem`}
              class="pointer-events-auto flex max-h-[calc(100dvh-2rem)] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-dialog outline-none"
            >
              <header class="flex shrink-0 items-start gap-2 px-6 pt-[1.375rem]">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <Dialog.Title class="text-lg leading-[calc(4/3)] font-medium text-ink" data-form-dialog-title>{title}</Dialog.Title>
                  {#if description}
                    <Dialog.Description class="text-sm leading-[calc(10/7)] text-ink-secondary">{description}</Dialog.Description>
                  {:else if srDescription}
                    <Dialog.Description class="sr-only">{srDescription}</Dialog.Description>
                  {/if}
                </div>
                <Dialog.Close
                  bind:ref={closeButton}
                  aria-label="Close"
                  data-form-dialog-close
                  disabled={busy}
                  class="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none pointer-coarse:size-11"
                >
                  <IconClose size={18} strokeWidth={1.8} />
                </Dialog.Close>
              </header>

              <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-[1.125rem]" data-form-dialog-body>
                {@render children()}
              </div>

              <footer class="flex min-h-[3.75rem] shrink-0 items-center gap-2 border-t border-line-soft bg-gray-50 px-6 py-3" data-form-dialog-footer>
                {#if footerNote}
                  <div class="min-w-0 flex-1">{@render footerNote()}</div>
                {:else}
                  <div class="flex-1"></div>
                {/if}
                {@render footer()}
              </footer>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>

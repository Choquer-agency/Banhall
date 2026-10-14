<!--
  The frame both Projects page panels share (Paper W2, W3 and W4; 2026-10-14
  amendment): a bits-ui Dialog, so focus stays inside, Escape closes it and
  focus goes back where the host says (the card menu trigger, or Edit
  details in the selection bar).

  "side" is the 400px panel on the right over the cards, with no scrim
  (W2, W3). "center" is the review dialog with a scrim (W4). Both layouts
  are the same dialog, so switching between them keeps the edits and the
  focus trap.

  While a save or apply runs (`busy`) nothing closes the panel, as in
  TeamDialog; the host disables its own Cancel and Close too. While there
  are unsaved edits (`dirty`) Escape and a click outside do not discard
  them silently: the panel stays and `onEscapeBlocked` lets the host say
  how to leave (Cancel, or the close button).
-->
<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { Dialog } from "bits-ui";

  let {
    open = $bindable(false),
    layout = "side",
    busy = false,
    dirty = false,
    onEscapeBlocked = undefined,
    initialFocus = undefined,
    returnFocus = undefined,
    testId = undefined,
    children,
  }: {
    open?: boolean;
    layout?: "side" | "center";
    /** A save or apply is running: Escape and a click outside do nothing. */
    busy?: boolean;
    /** Unsaved edits: Escape and a click outside keep the panel open. */
    dirty?: boolean;
    /** Escape was pressed over unsaved edits (not while busy). */
    onEscapeBlocked?: () => void;
    /** The element to focus when the panel opens; the first focusable one when absent. */
    initialFocus?: () => HTMLElement | null | undefined;
    /** The element to focus when the panel closes, asked for once the page has settled. */
    returnFocus?: () => HTMLElement | null | undefined;
    testId?: string;
    children: Snippet;
  } = $props();

  const sideClass =
    "fixed inset-y-0 right-0 z-[105] flex w-[25rem] max-w-full flex-col border-l border-line bg-surface shadow-preview-sheet outline-none";
  const centerClass =
    "fixed left-1/2 top-1/2 z-[105] flex max-h-[calc(100dvh-2rem)] w-[37.5rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-surface shadow-dialog outline-none";
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay
      data-projects-panel-scrim={layout}
      class={`fixed inset-0 z-[105] ${layout === "center" ? "bg-dialog-scrim" : "bg-transparent"}`}
    />
    <Dialog.Content
      data-projects-panel={layout}
      data-testid={testId}
      class={layout === "center" ? centerClass : sideClass}
      onOpenAutoFocus={(event) => {
        const target = initialFocus?.();
        if (!target) return;
        event.preventDefault();
        target.focus();
      }}
      onCloseAutoFocus={(event) => {
        if (!returnFocus) return;
        event.preventDefault();
        // After the page behind the panel is interactive again (and has
        // settled, for example after leaving select mode).
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
        if (busy || dirty) event.preventDefault();
      }}
    >
      {@render children()}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

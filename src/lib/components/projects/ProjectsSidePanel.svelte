<!--
  The frame both Projects page panels share (Paper W2, W3 and W4; 2026-10-14
  amendment): a bits-ui Dialog, so focus stays inside, Escape closes it and
  focus goes back where the host says (the card menu trigger, or Edit
  details in the selection bar).

  "side" is the 400px panel on the right over the cards, with no scrim
  (W2, W3); a click outside closes it unless `guardOutside` is set (the host
  sets it while there are unsaved edits). "center" is the review dialog with
  a scrim (W4). Both layouts are the same dialog, so switching between them
  keeps the edits and the focus trap.
-->
<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { Dialog } from "bits-ui";

  let {
    open = $bindable(false),
    layout = "side",
    guardOutside = false,
    initialFocus = undefined,
    returnFocus = undefined,
    testId = undefined,
    children,
  }: {
    open?: boolean;
    layout?: "side" | "center";
    /** Keep the panel open on a click outside (unsaved edits). */
    guardOutside?: boolean;
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
      onInteractOutside={(event) => {
        if (guardOutside) event.preventDefault();
      }}
    >
      {@render children()}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

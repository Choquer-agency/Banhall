<script lang="ts">
  // The full-height instructions editor ("Edit instructions"). It edits the
  // page's draft; Save on the page stores it.
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import { MAX_INSTRUCTIONS_CHARS } from "../../../../../shared/writerProfileLimits";

  const PLACEHOLDER =
    "e.g. Prefer short declarative sentences. Lead each iteration with the hypothesis tested. Avoid the passive voice in the work narrative.";

  let { open = $bindable(false), value = $bindable("") }: { open?: boolean; value?: string } = $props();
  const tooLong = $derived(value.length > MAX_INSTRUCTIONS_CHARS);

  // Open at the top so a long draft reads from the start.
  function focusAtStart(el: HTMLTextAreaElement) {
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
    });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>{#snippet child({ props, open: isOpen })}{#if isOpen}<div {...props} transition:overlayFade class="fixed inset-0 z-[130] bg-fir/40"></div>{/if}{/snippet}</Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[130] flex items-end sm:items-center sm:justify-center sm:p-4">
      <Dialog.Content forceMount>{#snippet child({ props, open: isOpen })}{#if isOpen}
        <div {...props} transition:modalPop data-instructions-editor class="pointer-events-auto flex h-[90dvh] w-full flex-col rounded-t-2xl border border-line bg-surface p-6 shadow-popover sm:h-[80dvh] sm:max-w-3xl sm:rounded-2xl">
          <Dialog.Title class="text-lg leading-6 font-medium text-ink">Your instructions</Dialog.Title>
          <Dialog.Description class="mt-1.5 text-sm leading-5 text-ink-muted">
            Describe how you like to write, or paste a sample of your writing. Close the editor, then save your preferences.
          </Dialog.Description>
          <textarea
            id="style-instructions"
            aria-label="Your instructions"
            use:focusAtStart
            bind:value
            placeholder={PLACEHOLDER}
            class="field-control mt-4 block min-h-0 w-full flex-1 resize-none rounded-[10px] px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint"
          ></textarea>
          <div class="mt-3 flex items-center justify-between gap-3">
            <span class={`text-xs ${tooLong ? "text-danger-ink-muted" : "text-ink-muted"}`}>
              {value.length.toLocaleString("en-US")} of {MAX_INSTRUCTIONS_CHARS.toLocaleString("en-US")} characters
            </span>
            <Dialog.Close class="h-9 rounded-[10px] bg-chrome px-3.5 text-sm font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Back to settings</Dialog.Close>
          </div>
        </div>
      {/if}{/snippet}</Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>

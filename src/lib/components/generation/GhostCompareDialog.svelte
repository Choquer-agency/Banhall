<!--
  Section-by-section vs one-shot comparison: side-by-side read-only panes of
  the final assembled report and the background ghost draft. Only offered for
  completed iterative generations whose ghost snapshot exists.
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import ReadOnlyEditor from "$lib/components/review/ReadOnlyEditor.svelte";

  let {
    open = $bindable(false),
    reportContent,
    ghostContent,
    ghostLabel,
  }: {
    open?: boolean;
    reportContent: string;
    ghostContent: string;
    ghostLabel: string;
  } = $props();
</script>

<style>
  /* Compact comparison panes: smaller type, regular weight (the workspace
     editor's serif renders optically heavy at reading sizes). */
  .ghost-compare :global(.tiptap-editor) {
    font-size: 0.8125rem;
    line-height: 1.6;
    font-weight: 400;
  }
  .ghost-compare :global(.tiptap-editor p) {
    font-weight: 400;
  }
  .ghost-compare :global(.tiptap-editor h1),
  .ghost-compare :global(.tiptap-editor h2) {
    font-size: 0.875rem;
  }
</style>

<Dialog.Root bind:open>
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
              class="card ghost-compare pointer-events-auto flex h-[min(640px,calc(100dvh-4rem))] w-full max-w-4xl flex-col overflow-hidden p-0 shadow-xl"
            >
              <div class="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
                <Dialog.Title class="text-sm font-semibold text-gray-900">
                  Compare drafts
                </Dialog.Title>
                <button
                  type="button"
                  aria-label="Close comparison"
                  onclick={() => (open = false)}
                  class="flex size-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
                <div class="flex min-h-0 flex-col border-b border-gray-100 md:border-b-0 md:border-r">
                  <p class="border-b border-gray-100 bg-primary-wash px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary-dark">
                    Your report
                  </p>
                  <div class="min-h-0 flex-1 overflow-y-auto p-4">
                    <ReadOnlyEditor content={reportContent} />
                  </div>
                </div>
                <div class="flex min-h-0 flex-col">
                  <p class="border-b border-gray-100 bg-chrome px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    AI generated ({ghostLabel})
                  </p>
                  <div class="min-h-0 flex-1 overflow-y-auto p-4">
                    <ReadOnlyEditor content={ghostContent} />
                  </div>
                </div>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>

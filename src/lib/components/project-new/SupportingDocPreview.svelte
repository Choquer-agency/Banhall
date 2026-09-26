<script lang="ts">
  /**
   * Preview a supporting document (board E3): a right sheet with the file
   * name, its category and size, page 1 of a PDF (other files show the start
   * of their text, not designed), and for a previous-year report the Sections
   * we found with their pages and the note that it is never copied into the
   * new PD. Footer: Remove, Replace file, Done. With `categories` and
   * `onCategory` the category chip is the same small menu as on the card.
   */
  import { Dialog, DropdownMenu } from "bits-ui";
  import { IconCheck, IconChevronDown, IconClose, IconShieldCheck } from "$lib/components/icons";
  import Button from "$lib/components/ui/Button.svelte";
  import { pageRangeLabel } from "../../../../shared/pdSectionDetect";
  import { CATEGORY_LABELS, type SupportingCategory, type SupportingDoc } from "./supportingDocs.svelte";

  let {
    open = $bindable(false),
    doc,
    categories = undefined,
    onCategory = undefined,
    onRemove,
    onReplace,
  }: {
    open?: boolean;
    doc: SupportingDoc | null;
    /** The chip menu's choices; without them the chip is a plain label. */
    categories?: SupportingCategory[];
    onCategory?: (category: SupportingCategory) => void;
    onRemove: () => void;
    onReplace: () => void;
  } = $props();

  const chipClass =
    "flex h-6 items-center gap-1 rounded-md bg-chrome px-2 text-xs leading-4 font-medium text-ink-secondary";

  const PREVIEW_CHARS = 1200;
  let canvas = $state<HTMLCanvasElement | null>(null);
  let pdfState = $state<"idle" | "rendering" | "rendered" | "failed">("idle");

  const isPdf = $derived(Boolean(doc?.file && doc.file.name.toLowerCase().endsWith(".pdf")));
  const text = $derived(doc?.pastedText ?? doc?.transcript?.content ?? doc?.parsed?.content ?? "");
  const pageCount = $derived(doc?.parsed?.pageCount ?? null);
  const sizeLine = $derived(
    doc
      ? `${
          pageCount
            ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}`
            : `${doc.words.toLocaleString("en-US")} words`
        }, added just now`
      : ""
  );

  // Page 1 of a PDF through pdf.js, as the parser already loads it. Any
  // failure falls back to the text box.
  $effect(() => {
    const file = doc?.file;
    const target = canvas;
    if (!open || !isPdf || !file || !target) return;
    let cancelled = false;
    pdfState = "rendering";
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = (380 / base.width) * (window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale });
        if (cancelled) return;
        target.width = viewport.width;
        target.height = viewport.height;
        const context = target.getContext("2d");
        if (!context) throw new Error("No canvas");
        await page.render({ canvasContext: context, viewport }).promise;
        if (!cancelled) pdfState = "rendered";
        void task.destroy();
      } catch {
        if (!cancelled) pdfState = "failed";
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[110] bg-preview-scrim" data-preview-scrim />
    <Dialog.Content
      data-supporting-preview
      class="fixed inset-y-0 right-0 z-[110] flex w-full max-w-[560px] flex-col border-l border-line bg-surface shadow-preview-sheet outline-none"
    >
      {#if doc}
        <div class="flex items-start gap-3 border-b border-line-soft pt-[22px] pr-5 pb-4 pl-7">
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <Dialog.Title class="truncate text-[17px] leading-6 font-medium text-ink">{doc.name}</Dialog.Title>
            <div class="flex flex-wrap items-center gap-2">
              {#if categories && onCategory}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    class={`${chipClass} transition-colors hover:bg-primary-wash focus-visible:outline-2 focus-visible:outline-fir pointer-coarse:h-11`}
                    aria-label={`Type: ${CATEGORY_LABELS[doc.category]}. Change type`}
                    data-preview-category
                  >
                    {CATEGORY_LABELS[doc.category]}
                    <IconChevronDown size={11} strokeWidth={2.2} stroke-linejoin="miter" class="shrink-0 text-ink-muted" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="z-[130] min-w-[200px] rounded-xl border border-line bg-surface p-1.5 shadow-menu" sideOffset={4} align="start">
                      <DropdownMenu.RadioGroup value={doc.category} onValueChange={(next) => onCategory(next as SupportingCategory)}>
                        {#each categories as category (category)}
                          <DropdownMenu.RadioItem
                            value={category}
                            class="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] leading-[19px] text-ink outline-none data-highlighted:bg-primary-wash pointer-coarse:h-11"
                          >
                            {#snippet children({ checked })}
                              <span class="min-w-0 flex-1">{CATEGORY_LABELS[category]}</span>
                              {#if checked}<IconCheck size={14} strokeWidth={2.2} class="text-primary-selected" />{/if}
                            {/snippet}
                          </DropdownMenu.RadioItem>
                        {/each}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              {:else}
                <span class={chipClass} data-preview-category>{CATEGORY_LABELS[doc.category]}</span>
              {/if}
              <Dialog.Description class="text-xs leading-4 text-ink-muted">{sizeLine}</Dialog.Description>
            </div>
          </div>
          <Dialog.Close
            aria-label="Close"
            class="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink pointer-coarse:size-11"
          >
            <IconClose size={18} strokeWidth={2} />
          </Dialog.Close>
        </div>

        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div class="flex shrink-0 justify-center bg-gray-50 px-7 py-6" data-preview-page-area>
            {#if isPdf && pdfState !== "failed"}
              <figure class="flex w-[380px] max-w-full flex-col items-center gap-3 rounded-[4px] bg-surface pb-4 shadow-preview-page">
                <canvas bind:this={canvas} data-pdf-page class="w-full" aria-label={`Page 1 of ${doc.name}`}></canvas>
                <figcaption class="text-[11px] leading-[14px] text-ink-faint">Page 1 of {pageCount ?? 1}</figcaption>
              </figure>
            {:else}
              <div data-preview-text class="w-[380px] max-w-full rounded-[4px] bg-surface px-[34px] py-9 shadow-preview-page">
                <p class="font-serif text-[13px] leading-[20px] whitespace-pre-wrap text-ink-secondary">{text.slice(0, PREVIEW_CHARS)}{text.length > PREVIEW_CHARS ? "..." : ""}</p>
              </div>
            {/if}
          </div>

          {#if doc.category === "previous_pd"}
            <div class="flex flex-col gap-1.5 px-7 py-5" data-found-list>
              <p class="text-xs leading-4 font-medium text-ink-muted">What we found</p>
              {#if doc.sections.length === 0}
                <p class="py-2 text-[13px] leading-[18px] text-ink-secondary" data-no-sections>We did not find Lines 242, 244 or 246 in this file.</p>
              {:else}
                <ul class="flex flex-col">
                  {#each doc.sections as section (section.section)}
                    <li data-found-section={section.number} class="flex h-10 items-center gap-2.5 border-b border-line-soft">
                      <IconCheck size={14} strokeWidth={2} class="shrink-0 text-success" />
                      <span class="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-ink">{section.number} {section.title}</span>
                      {#if section.pageStart}
                        <span class="shrink-0 text-xs leading-4 text-ink-muted">{pageRangeLabel(section.pageStart, section.pageEnd ?? section.pageStart)}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
              <p data-previous-year-note class="mt-2 flex gap-2.5 rounded-[10px] bg-canvas px-3.5 py-3 text-[13px] leading-[19px] text-ink-secondary">
                <IconShieldCheck size={15} strokeWidth={1.6} class="shrink-0 text-ink-muted" />
                We use this to check facts and match last year's claim. It is never copied into the new PD.
              </p>
            </div>
          {/if}
        </div>

        <div class="flex items-center gap-2.5 border-t border-line-soft px-7 pt-4 pb-[22px]">
          <Button variant="destructive-soft" size="sm" class="h-9 px-3.5! py-0!" onclick={onRemove} data-preview-remove>Remove</Button>
          <span class="grow"></span>
          <Button variant="secondary" size="sm" class="h-9 px-3.5! py-0!" onclick={onReplace} data-preview-replace>Replace file</Button>
          <Dialog.Close>
            {#snippet child({ props })}
              <button
                {...props}
                type="button"
                data-preview-done
                class="inline-flex h-9 items-center rounded-lg bg-fir px-4 text-sm font-medium text-white transition-colors hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fir focus-visible:ring-offset-2"
              >Done</button>
            {/snippet}
          </Dialog.Close>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<script lang="ts">
  /**
   * Preview a supporting document (board E3): a right sheet with the file
   * name, its category and size, page 1 of a PDF (other files show the start
   * of their text, not designed), and for a previous-year report the Sections
   * we found with their pages and the note that it is never copied into the
   * new PD. Footer: Remove, Replace file, Done.
   */
  import { Dialog } from "bits-ui";
  import { CheckIcon, ShieldCheckIcon, XIcon } from "phosphor-svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { pageRangeLabel } from "../../../../shared/pdSectionDetect";
  import { CATEGORY_LABELS, type SupportingDoc } from "./supportingDocs.svelte";

  let {
    open = $bindable(false),
    doc,
    onRemove,
    onReplace,
  }: {
    open?: boolean;
    doc: SupportingDoc | null;
    onRemove: () => void;
    onReplace: () => void;
  } = $props();

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
    <Dialog.Overlay class="fixed inset-0 z-[110] bg-[#010505]/30" data-preview-scrim />
    <Dialog.Content
      data-supporting-preview
      class="fixed inset-y-0 right-0 z-[110] flex w-full max-w-[560px] flex-col border-l border-line bg-surface shadow-popover outline-none"
    >
      {#if doc}
        <div class="flex items-start gap-3 border-b border-line-soft px-7 pt-6 pb-4">
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <Dialog.Title class="truncate text-lg leading-6 font-medium text-ink">{doc.name}</Dialog.Title>
            <div class="flex flex-wrap items-center gap-2.5">
              <span class="flex h-6 items-center rounded-md bg-chrome px-2 text-xs leading-4 font-medium text-ink-secondary">{CATEGORY_LABELS[doc.category]}</span>
              <Dialog.Description class="text-[13px] leading-[18px] text-ink-muted">{sizeLine}</Dialog.Description>
            </div>
          </div>
          <Dialog.Close
            aria-label="Close"
            class="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink"
          >
            <XIcon size={18} aria-hidden="true" />
          </Dialog.Close>
        </div>

        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div class="flex justify-center bg-canvas px-7 py-6">
            {#if isPdf && pdfState !== "failed"}
              <figure class="flex w-[380px] max-w-full flex-col items-center gap-3 bg-surface pb-4 shadow-[0_2px_12px_rgba(22,33,31,0.12)]">
                <canvas bind:this={canvas} data-pdf-page class="w-full" aria-label={`Page 1 of ${doc.name}`}></canvas>
                <figcaption class="text-xs leading-4 text-ink-muted">Page 1 of {pageCount ?? 1}</figcaption>
              </figure>
            {:else}
              <div data-preview-text class="w-[380px] max-w-full bg-surface px-7 py-6 shadow-[0_2px_12px_rgba(22,33,31,0.12)]">
                <p class="font-serif text-[13px] leading-[20px] whitespace-pre-wrap text-ink-secondary">{text.slice(0, PREVIEW_CHARS)}{text.length > PREVIEW_CHARS ? "..." : ""}</p>
              </div>
            {/if}
          </div>

          {#if doc.category === "previous_pd"}
            <div class="flex flex-col gap-2 px-7 pt-6 pb-6">
              <p class="text-[13px] leading-[18px] text-ink-muted">What we found</p>
              {#if doc.sections.length === 0}
                <p class="py-2 text-sm text-ink-secondary" data-no-sections>We did not find Lines 242, 244 or 246 in this file.</p>
              {:else}
                <ul class="flex flex-col">
                  {#each doc.sections as section (section.section)}
                    <li data-found-section={section.number} class="flex min-h-11 items-center gap-2.5 border-b border-line-soft">
                      <CheckIcon size={14} class="shrink-0 text-success" aria-hidden="true" />
                      <span class="min-w-0 flex-1 text-sm leading-5 font-medium text-ink">{section.number} {section.title}</span>
                      {#if section.pageStart}
                        <span class="shrink-0 text-[13px] leading-[18px] text-ink-muted">{pageRangeLabel(section.pageStart, section.pageEnd ?? section.pageStart)}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
              <p data-previous-year-note class="mt-2 flex gap-2.5 rounded-[10px] bg-canvas px-4 py-3 text-[13px] leading-[19px] text-ink-secondary">
                <ShieldCheckIcon size={14} class="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
                We use this to check facts and match last year's claim. It is never copied into the new PD.
              </p>
            </div>
          {/if}
        </div>

        <div class="flex items-center gap-2 border-t border-line-soft px-7 py-4">
          <Button variant="destructive-soft" size="sm" class="h-9 py-0!" onclick={onRemove} data-preview-remove>Remove</Button>
          <span class="grow"></span>
          <Button variant="secondary" size="sm" class="h-9 py-0!" onclick={onReplace} data-preview-replace>Replace file</Button>
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

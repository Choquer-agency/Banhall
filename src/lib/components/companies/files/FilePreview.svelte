<!--
  The Files tab's preview (2026-11-04, Paper "Files / Preview, PDF",
  "Excel", "Word", "email or text"): a full-screen dark viewer with the file
  in the middle (540 by 690 at board size), its neighbours dimmed at the
  sides, arrows, a position bar, Original or Text the AI reads, Download and
  Open in a new tab. Embla Carousel moves between files (swipe, drag, the
  arrows and the arrow keys). A bits-ui dialog keeps focus inside; Esc
  closes it and focus goes back to where the parent says.
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import emblaCarouselSvelte from "embla-carousel-svelte";
  import type { EmblaCarouselType, EmblaOptionsType } from "embla-carousel";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import FileIcon from "$lib/components/ui/FileIcon.svelte";
  import PreviewPage from "./PreviewPage.svelte";
  import { describeFile, fiscalYearOf, wordsLabel, type ListedCompanyFile } from "./fileMeta";
  import { downloadOriginals } from "./downloadOriginals";
  import { userErrorMessage } from "$lib/errors";

  let {
    files,
    open = $bindable(false),
    index = $bindable(0),
    onCloseAutoFocus,
  }: {
    files: readonly ListedCompanyFile[];
    open?: boolean;
    /** The file shown; follows the carousel. */
    index?: number;
    onCloseAutoFocus?: (event: Event) => void;
  } = $props();

  let embla = $state<EmblaCarouselType | null>(null);
  // Set once each time the viewer opens: a new start index later would
  // make the carousel start over (and skip its motion) on every move. No
  // contained scroll: the first and last files sit centred too, with their
  // neighbour peeking, instead of being pinned to an edge.
  let emblaOptions = $state.raw<EmblaOptionsType>({ align: "center", containScroll: false, startIndex: 0, duration: 24 });
  let wasOpen = false;
  $effect.pre(() => {
    if (open && !wasOpen) emblaOptions = { align: "center", containScroll: false, startIndex: untrack(() => index), duration: 24 };
    if (!open) embla = null;
    wasOpen = open;
  });
  let mode = $state<"original" | "text">("original");
  /** The dots show every file up to this many; past it, only "n of m". */
  const MAX_DOTS = 12;

  const current = $derived(files[Math.min(index, files.length - 1)] ?? null);
  const effectiveMode = $derived(current && !current.url ? "text" : mode);

  function onInit(event: CustomEvent<EmblaCarouselType>) {
    const api = event.detail;
    embla = api;
    api.on("select", () => {
      index = api.selectedScrollSnap();
    });
  }

  // A file added or removed while the viewer is open: keep the one shown.
  $effect(() => {
    if (index > files.length - 1 && files.length > 0) index = files.length - 1;
  });

  function go(step: -1 | 1) {
    const next = Math.max(0, Math.min(files.length - 1, index + step));
    if (next === index) return;
    if (embla) embla.scrollTo(next);
    else index = next;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    }
  }

  async function download() {
    if (!current) return;
    try {
      await downloadOriginals([current], current.fileName);
    } catch (error) {
      toast.error(userErrorMessage(error, "The original could not be downloaded."));
    }
  }

  function subtitle(file: ListedCompanyFile): string {
    const year = fiscalYearOf(file);
    return [describeFile(file), year !== null ? `FY ${year}` : null, file.wordCount > 0 ? wordsLabel(file.wordCount) : null]
      .filter(Boolean)
      .join(", ");
  }

  const iconButton =
    "flex size-[2.125rem] shrink-0 items-center justify-center rounded-lg text-on-ink-muted transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light motion-reduce:transition-none";
  const arrowButton =
    "pointer-events-auto flex size-11 items-center justify-center rounded-full bg-white/[0.12] text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:opacity-30 motion-reduce:transition-none";
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[140] bg-ink" />
    <Dialog.Content
      data-company-file-preview
      {onCloseAutoFocus}
      onkeydown={onKeydown}
      class="fixed inset-0 z-[140] flex flex-col overflow-hidden bg-ink outline-none"
    >
      {#if current}
        <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 pt-3 pr-3 pl-4 sm:h-16 sm:flex-nowrap sm:pr-5 sm:pl-6" data-preview-toolbar>
          <span class="flex w-6 shrink-0 justify-center"><FileIcon name={current.fileName} size={32} /></span>
          <div class="min-w-0 flex-1">
            <Dialog.Title class="truncate text-sm leading-[calc(10/7)] font-medium text-white" data-preview-title>{current.fileName}</Dialog.Title>
            <Dialog.Description class="truncate text-xs leading-[calc(4/3)] text-on-ink-muted">{subtitle(current)}</Dialog.Description>
          </div>
          <div class="order-last flex w-full items-center gap-0.5 rounded-[0.5625rem] bg-white/[0.08] p-[0.1875rem] *:flex-1 sm:order-none sm:w-auto sm:*:flex-none" role="group" aria-label="What to show">
            <button
              type="button"
              aria-pressed={effectiveMode === "original"}
              disabled={!current.url}
              data-preview-mode="original"
              onclick={() => (mode = "original")}
              class={`h-7 rounded-md px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-light disabled:opacity-40 motion-reduce:transition-none ${effectiveMode === "original" ? "bg-primary-selected text-white" : "text-on-ink-muted hover:bg-white/10"}`}
            >Original</button>
            <button
              type="button"
              aria-pressed={effectiveMode === "text"}
              data-preview-mode="text"
              onclick={() => (mode = "text")}
              class={`h-7 rounded-md px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-light motion-reduce:transition-none ${effectiveMode === "text" ? "bg-primary-selected text-white" : "text-on-ink-muted hover:bg-white/10"}`}
            >Text the AI reads</button>
          </div>
          <button type="button" aria-label="Download original" disabled={!current.url} onclick={() => void download()} class={`${iconButton} disabled:opacity-40`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
          </button>
          {#if current.url}
            <a href={current.url} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" class={iconButton}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
            </a>
          {/if}
          <span class="mx-1 h-5 w-px bg-white/20" aria-hidden="true"></span>
          <Dialog.Close aria-label="Close preview" class={iconButton}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </Dialog.Close>
        </div>

        <div class="relative min-h-0 flex-1">
          <div
            class="h-full overflow-hidden"
            use:emblaCarouselSvelte={{ options: emblaOptions, plugins: [] }}
            onemblaInit={onInit}
            data-preview-viewport
          >
            <div class="flex h-full items-center">
              {#each files as file, position (file._id)}
                {@const near = Math.abs(position - index) <= 1}
                <div
                  class={`relative mx-4 flex h-full min-w-0 flex-[0_0_calc(100vw-2rem)] flex-col sm:mx-[6.5625rem] sm:flex-[0_0_33.75rem] justify-center transition-opacity duration-200 motion-reduce:transition-none ${position === index ? "opacity-100" : "opacity-[0.22]"}`}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${position + 1} of ${files.length}: ${file.fileName}`}
                  aria-hidden={position === index ? undefined : "true"}
                  inert={position !== index}
                  data-preview-slide={file._id}
                >
                  {#if position !== index}
                    <p class={`absolute top-[calc(50%-min(21.5625rem,calc(50%-1rem))-1.625rem)] max-w-full truncate text-xs leading-[calc(4/3)] text-on-ink-muted ${position < index ? "right-0" : "left-0"}`}>{file.fileName}</p>
                  {/if}
                  <div class="h-[min(43.125rem,calc(100%-2rem))] overflow-hidden rounded-[0.25rem] shadow-dialog">
                    {#if near}
                      <PreviewPage {file} mode={effectiveMode} current={position === index} />
                    {:else}
                      <div class="h-full w-full bg-surface"></div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="pointer-events-none absolute top-1/2 left-1/2 flex w-[49.625rem] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 justify-between">
            <button type="button" aria-label="Previous file" disabled={index === 0} onclick={() => go(-1)} class={arrowButton} data-preview-prev>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <button type="button" aria-label="Next file" disabled={index >= files.length - 1} onclick={() => go(1)} class={arrowButton} data-preview-next>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        </div>

        <div class="flex h-[5.5rem] shrink-0 items-start justify-center pt-4">
          <div class="flex h-[1.875rem] items-center gap-2.5 rounded-full bg-white/[0.08] px-3" data-preview-position>
            {#if files.length <= MAX_DOTS}
              <div class="flex items-center gap-[0.3125rem]">
                {#each files as file, position (file._id)}
                  <button
                    type="button"
                    aria-label={`Show ${file.fileName}`}
                    aria-current={position === index ? "true" : undefined}
                    onclick={() => (embla ? embla.scrollTo(position) : (index = position))}
                    class={`h-1.5 rounded-full transition-all motion-reduce:transition-none ${position === index ? "w-[1.125rem] bg-primary" : "w-1.5 bg-white/30 hover:bg-white/50"}`}
                    data-preview-dot={position}
                  ></button>
                {/each}
              </div>
            {/if}
            <span class="text-xs leading-[calc(4/3)] text-on-ink-muted" aria-live="polite">{index + 1} of {files.length}</span>
          </div>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

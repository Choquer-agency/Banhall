<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import {
    ArrowRightIcon,
    ArrowUpIcon,
    ClipboardTextIcon,
    FileDocIcon,
    PaperclipIcon,
  } from "phosphor-svelte";
  import { parseFileToText } from "$lib/parseDocument";
  import { stashProjectStart } from "$lib/workspace/projectIntentHandoff";

  let { greeting }: { greeting: string } = $props();

  let title = $state("");
  let transcriptText = $state("");
  let transcriptFileName = $state<string | null>(null);
  let fileInput: HTMLInputElement | null = $state(null);
  let transcriptField: HTMLTextAreaElement | null = $state(null);
  let parsing = $state<string | null>(null);
  let transcriptError = $state("");
  let dragOver = $state(false);
  // The two transcript sources are mutually exclusive input modes. Paste is
  // the predictable default; switching modes preserves in-progress text so a
  // mistaken click never destroys work, but only the active mode is handed to
  // the wizard.
  let transcriptMode = $state<"paste" | "attach">("paste");

  function selectPaste() {
    if (transcriptFileName) {
      transcriptFileName = null;
      transcriptError = "";
    }
    transcriptMode = "paste";
    queueMicrotask(() => transcriptField?.focus());
  }

  function selectAttach() {
    transcriptMode = "attach";
    transcriptError = "";
  }

  const wordCount = $derived(transcriptText.trim().split(/\s+/).filter(Boolean).length);
  const hasActiveTranscript = $derived(
    transcriptMode === "paste"
      ? transcriptText.trim().length > 0
      : Boolean(transcriptFileName && transcriptText.trim())
  );
  const canStart = $derived(Boolean(title.trim()) && hasActiveTranscript && !parsing);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      transcriptError = "Transcripts must be Word (.docx) files. Teams exports are supported, or you can paste the transcript instead.";
      return;
    }
    transcriptError = "";
    parsing = file.name;
    try {
      const parsed = await parseFileToText(file);
      const text = parsed.content.trim();
      if (!text) {
        transcriptError = `Couldn't extract any text from ${file.name}.`;
        return;
      }
      transcriptText = text;
      transcriptFileName = file.name;
      transcriptMode = "attach";
    } catch {
      transcriptError = `Couldn't read ${file.name}. Try another file.`;
    } finally {
      parsing = null;
    }
  }

  function removeTranscript() {
    transcriptText = "";
    transcriptFileName = null;
    transcriptError = "";
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragOver = false;
    const file = event.dataTransfer?.files[0];
    if (file) {
      transcriptMode = "attach";
      void handleFile(file);
    }
  }

  function startProject() {
    if (!canStart) return;
    stashProjectStart({
      title,
      transcriptText:
        transcriptMode === "paste" || transcriptFileName ? transcriptText : "",
      transcriptFileName: transcriptMode === "attach" ? transcriptFileName : null,
    });
    goto(resolve("/project/new"));
  }

  function startBlankProject() {
    stashProjectStart({ title: "", transcriptText: "", transcriptFileName: null });
    goto(resolve("/project/new"));
  }
</script>

<!-- Rhythm (2026-08-10 Obvious-parity spacing pass): 8pt vertical scale —
     header→box 24/32, box→helper 12, gutters 16/24 matching the recents
     band; hero type scales fluidly via the text-hero roles instead of
     breakpoint steps. -->
<!-- Fixed top offset instead of vertical centering (keeps recents above the
     laptop fold), with a generous top pad (2026-08-10 owner direction). The
     shader wash renders in the workspace scroll owner (WorkspaceDashboard) —
     container-width, so classic scrollbars never cause horizontal overflow. -->
<section data-home-start aria-labelledby="home-start-title" class="relative isolate flex flex-col px-4 pb-8 pt-24 sm:px-6 sm:pb-10">
  <div data-home-start-centered class="mx-auto w-full max-w-[var(--container-home)]">
    <!-- Customer.io Agent-home hierarchy (Mobbin evidence 2026-08-10): the
         greeting IS the headline; the question is the quiet line under it.
         Weight discipline: nothing on Home exceeds font-medium (500) —
         hierarchy comes from size and ink, not boldness. -->
    <header data-home-welcome class="text-center">
      <h1 data-home-greeting class="text-hero">{greeting}.</h1>
      <p id="home-start-title" class="text-hero-sub mt-2 text-ink-muted">What are we writing today?</p>
    </header>

    <!-- The Home intake is a white working surface. A one-pixel inset line
         shifts from neutral to lagoon on hover/focus while its title and
         transcript fields stay chromeless. -->
    <form
      data-home-start-form
      data-drag-over={dragOver ? "" : undefined}
      class="field-control-shell field-control-shell--surface mt-6 flex flex-col rounded-xl px-3 pb-2.5 pt-4 text-left sm:mt-8 sm:px-4 sm:pb-3 sm:pt-5"
      onsubmit={(event) => {
        event.preventDefault();
        startProject();
      }}
      ondragover={(event) => {
        event.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={handleDrop}
    >
      <label for="home-project-title" class="sr-only">Internal project title</label>
      <input
        id="home-project-title"
        data-home-start-input
        bind:value={title}
        maxlength="160"
        autocomplete="off"
        placeholder="Name the project…"
        class="input-chromeless block min-h-10 w-full border-0 bg-transparent px-1.5 text-[0.9375rem] font-medium text-ink outline-none placeholder:text-ink-faint sm:text-base"
      />

      {#if transcriptMode === "paste"}
        <label for="home-transcript" class="sr-only">Interview transcript</label>
        <textarea
          id="home-transcript"
          data-home-transcript-input
          role="tabpanel"
          aria-labelledby="home-transcript-paste-tab"
          bind:this={transcriptField}
          bind:value={transcriptText}
          rows="3"
          placeholder="Paste the interview transcript…"
          class="input-chromeless mt-1 block min-h-16 w-full resize-none border-0 bg-transparent px-1.5 pb-1 text-[0.8125rem] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
        ></textarea>
      {:else if transcriptFileName}
        <div data-home-transcript-file class="mt-1 flex items-center justify-between gap-3 rounded-xl bg-chrome/60 px-3 py-2">
          <span class="flex min-w-0 items-center gap-2.5">
            <FileDocIcon size={16} weight="regular" aria-hidden="true" class="shrink-0 text-ink-muted" />
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium text-ink">{transcriptFileName}</span>
              <span class="block text-xs text-ink-muted"><span class="font-mono tabular-nums">{wordCount.toLocaleString()}</span> words extracted</span>
            </span>
          </span>
          <button type="button" data-home-transcript-remove onclick={removeTranscript} class="min-h-11 shrink-0 rounded-lg px-2 text-xs font-medium text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy sm:min-h-9">Remove</button>
        </div>
      {:else}
        <div
          id="home-transcript-attach-panel"
          data-home-transcript-attach-empty
          role="tabpanel"
          aria-labelledby="home-transcript-attach-tab"
          class="mt-1 flex min-h-16 items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3"
        >
          <span class="flex min-w-0 items-center gap-2 text-xs text-ink-muted">
            <PaperclipIcon size={15} weight="regular" aria-hidden="true" class="shrink-0" />
            <span class="truncate">Word transcript (.docx)</span>
          </span>
          <button
            type="button"
            data-home-transcript-browse
            disabled={Boolean(parsing)}
            onclick={() => fileInput?.click()}
            class="h-7 shrink-0 rounded-md bg-chrome px-2.5 text-xs font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-60 pointer-coarse:min-h-11"
          >
            Choose file
          </button>
        </div>
      {/if}

      {#if parsing}<p class="mt-1 px-1.5 text-sm text-ink-secondary" role="status">Reading {parsing}…</p>{/if}
      {#if transcriptError}<p data-home-transcript-error class="mt-1 px-1.5 text-sm text-red-700" role="alert">{transcriptError}</p>{/if}

      <!-- Prompt toolbar row: one segmented paste/attach toggle left (both
           modes land in the same wizard handoff), send right. Quiet by
           design: no hover treatments inside the box — state shows only
           through the selected segment and keyboard focus. -->
      <!-- Obvious prompt-toolbar anatomy: compact borderless ghost buttons
           (h-7, rounded-full) left, small round send right. Selection shows
           as a quiet chrome fill; no hover treatments in the box. -->
      <div class="mt-2 flex items-center justify-between gap-2">
        <div
          data-home-transcript-mode
          role="tablist"
          aria-label="Transcript input method"
          class="inline-flex min-w-0 shrink-0 items-center gap-0.5 rounded-lg bg-chrome p-0.5"
        >
          <button
            id="home-transcript-paste-tab"
            type="button"
            role="tab"
            data-home-transcript-paste
            aria-selected={transcriptMode === "paste"}
            aria-controls="home-transcript"
            onclick={selectPaste}
            class={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-11 ${transcriptMode === "paste" ? "bg-surface text-ink shadow-sm" : "text-ink-muted"}`}
          >
            <ClipboardTextIcon size={14} weight="regular" aria-hidden="true" />
            Paste
          </button>
          <button
            id="home-transcript-attach-tab"
            type="button"
            role="tab"
            data-home-transcript-attach
            disabled={Boolean(parsing)}
            aria-selected={transcriptMode === "attach"}
            aria-controls="home-transcript-attach-panel"
            onclick={selectAttach}
            class={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-60 pointer-coarse:min-h-11 ${transcriptMode === "attach" ? "bg-surface text-ink shadow-sm" : "text-ink-muted"}`}
          >
            <PaperclipIcon size={14} weight="regular" aria-hidden="true" />
            Attach file
          </button>
        </div>
        <button
          type="submit"
          data-home-start-submit
          disabled={!canStart}
          aria-label={canStart ? "Start project" : "Add a project name and transcript to continue"}
          title={canStart ? "Start project" : "Add a project name and transcript to continue"}
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-selected text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy active:translate-y-px disabled:cursor-not-allowed disabled:bg-chrome disabled:text-ink-faint disabled:opacity-100 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <ArrowUpIcon size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <input
        bind:this={fileInput}
        type="file"
        accept=".docx"
        class="hidden"
        onchange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void handleFile(file);
          event.currentTarget.value = "";
        }}
      />
    </form>

    <!-- A quiet continuation row keeps an empty Home useful without
         inventing activity, templates, or another subscription. This is the
         same section rhythm Attio uses below its composer: one sentence of
         context and one honest next destination. -->
    <div data-home-continuation class="mt-4 border-t border-line-soft pt-3">
      <button
        type="button"
        data-home-start-blank
        onclick={startBlankProject}
        class="group flex min-h-14 w-full items-center justify-between gap-4 rounded-lg px-2 text-left transition-colors hover:bg-chrome/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-16"
      >
        <span class="min-w-0">
          <span class="block text-sm font-medium text-ink">Start a blank project</span>
          <span class="mt-0.5 block text-xs leading-relaxed text-ink-muted">Open intake and add the project details there.</span>
        </span>
        <ArrowRightIcon size={16} weight="regular" aria-hidden="true" class="shrink-0 text-ink-muted transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </button>
    </div>
  </div>
</section>

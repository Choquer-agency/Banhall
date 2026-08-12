<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
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
  // Paste entry is an explicit option (chip in the prompt toolbar) — the
  // textarea stays hidden until chosen, and stays open while it holds text.
  let pasteOpen = $state(false);
  const pasteVisible = $derived(!transcriptFileName && (pasteOpen || transcriptText.trim().length > 0));

  // Segmented toggle: the selected segment mirrors actual content — "Paste"
  // while the textarea is open, "Attach file" while a parsed file is
  // attached. Switching from an attached file to Paste keeps the extracted
  // text editable and only drops the filename.
  const transcriptMode = $derived<"paste" | "attach" | null>(
    transcriptFileName ? "attach" : pasteVisible ? "paste" : null
  );

  function selectPaste() {
    if (transcriptFileName) {
      transcriptFileName = null;
      transcriptError = "";
    } else if (pasteVisible && !transcriptText.trim()) {
      pasteOpen = false;
      return;
    }
    pasteOpen = true;
    queueMicrotask(() => transcriptField?.focus());
  }

  const wordCount = $derived(transcriptText.trim().split(/\s+/).filter(Boolean).length);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      transcriptError = "Transcripts must be Word (.docx) files — Teams exports are. You can paste the transcript instead.";
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
    if (file) void handleFile(file);
  }

  function startProject() {
    stashProjectStart({ title, transcriptText, transcriptFileName });
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
<section data-home-start aria-labelledby="home-start-title" class="relative isolate flex flex-col px-4 pb-8 pt-24 sm:px-6 sm:pb-10 sm:pt-32">
  <div data-home-start-centered class="mx-auto w-full max-w-[46rem]">
    <!-- Customer.io Agent-home hierarchy (Mobbin evidence 2026-08-10): the
         greeting IS the headline; the question is the quiet line under it.
         Weight discipline: nothing on Home exceeds font-medium (500) —
         hierarchy comes from size and ink, not boldness. -->
    <header data-home-welcome class="text-center">
      <p data-home-greeting class="text-hero">{greeting}.</p>
      <h2 id="home-start-title" class="text-hero-sub mt-2 text-ink-muted">What are we writing today?</h2>
    </header>

    <!-- Prompt-box composition (2026-08-10, Obvious prompt parity): one
         quiet rounded container carries the whole intake. The CONTAINER owns
         the focus treatment (focus-within border shift) so the fields inside
         stay chrome-free — no per-input underline, hover, or default black
         focus outline. Labels stay in the DOM for assistive tech (sr-only);
         placeholders carry the visible prompt. Still pure wizard navigation. -->
    <!-- Quiet container: full-opacity hairline, no hover/focus-within
         treatment (2026-08-10 owner direction) — the caret and control
         focus rings carry keyboard state. -->
    <form
      data-home-start-form
      class={`mt-6 flex flex-col rounded-xl border bg-surface px-3 pb-2.5 pt-4 text-left sm:mt-8 sm:px-4 sm:pb-3 sm:pt-5 ${dragOver ? "border-primary-selected" : "border-line"}`}
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

      {#if transcriptFileName}
        <div data-home-transcript-file class="mt-1 flex items-center justify-between gap-3 rounded-xl bg-chrome/60 px-3 py-2">
          <span class="flex min-w-0 items-center gap-2.5">
            <svg class="h-4 w-4 shrink-0 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium text-ink">{transcriptFileName}</span>
              <span class="block text-xs text-ink-muted"><span class="font-mono tabular-nums">{wordCount.toLocaleString()}</span> words extracted</span>
            </span>
          </span>
          <button type="button" data-home-transcript-remove onclick={removeTranscript} class="min-h-11 shrink-0 rounded-lg px-2 text-xs font-medium text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy sm:min-h-9">Remove</button>
        </div>
      {:else if pasteVisible}
        <label for="home-transcript" class="sr-only">Interview transcript</label>
        <textarea
          id="home-transcript"
          data-home-transcript-input
          bind:this={transcriptField}
          bind:value={transcriptText}
          rows="3"
          placeholder="Paste the interview transcript…"
          class="input-chromeless mt-1 block min-h-16 w-full resize-none border-0 bg-transparent px-1.5 pb-1 text-[0.8125rem] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
        ></textarea>
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
          role="group"
          aria-label="Transcript entry"
          class="flex min-w-0 shrink-0 items-center gap-0.5"
        >
          <button
            type="button"
            data-home-transcript-paste
            aria-pressed={transcriptMode === "paste"}
            onclick={selectPaste}
            class={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy active:translate-y-px pointer-coarse:min-h-11 ${transcriptMode === "paste" ? "bg-chrome text-ink" : "text-ink-secondary"}`}
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 14.25v4.5A2.25 2.25 0 0117.25 21H5.25A2.25 2.25 0 013 18.75V6.75A2.25 2.25 0 015.25 4.5h4.5" /></svg>
            Paste
          </button>
          <button
            type="button"
            data-home-transcript-attach
            disabled={Boolean(parsing)}
            aria-pressed={transcriptMode === "attach"}
            onclick={() => fileInput?.click()}
            class={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy active:translate-y-px disabled:opacity-60 pointer-coarse:min-h-11 ${transcriptMode === "attach" ? "bg-chrome text-ink" : "text-ink-secondary"}`}
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-6.69 6.69a4.5 4.5 0 01-6.364-6.364l8.955-8.955a3 3 0 114.243 4.243l-8.96 8.955a1.5 1.5 0 01-2.12-2.121l8.25-8.25" /></svg>
            Attach file
          </button>
        </div>
        <button
          type="submit"
          data-home-start-submit
          disabled={Boolean(parsing)}
          aria-label="Start project"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-selected text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy active:translate-y-px disabled:opacity-60 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m-6 6 6-6 6 6" /></svg>
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
  </div>
</section>


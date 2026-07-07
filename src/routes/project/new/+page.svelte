<script lang="ts">
  import { goto } from "$app/navigation";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import {
    parseFileToText,
    isSupportedFile,
    SUPPORTED_ACCEPT,
    SUPPORTED_LABEL,
  } from "$lib/parseDocument";
  import { CONTEXT_CATEGORIES, type ContextCategoryId } from "$lib/contextCategories";
  import {
    emptyStaged,
    guessFileType,
    type Staged,
    type StagedCategory,
    type PyRow,
  } from "$lib/components/project-new/shared";
  import CategoryCard from "$lib/components/project-new/CategoryCard.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import PreviousYearCard from "$lib/components/project-new/PreviousYearCard.svelte";

  const STEPS = ["Details", "Context & files", "Review"];

  const auth = useAuth();
  const createProject = useMutation(api.projects.createProject);
  const generateReport = useMutation(api.projects.scheduleGenerateReport);
  const startPdReview = useMutation(api.pdReviews.startPdReview);
  const uploadDocument = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const user = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  // Writer is always the signed-in user — not editable.
  const writerName = $derived(user.data?.name ?? user.data?.email ?? "");

  let step = $state(0);
  // BNH-39: generate a new PD from a transcript, or review an existing written PD.
  let mode = $state<"generate" | "review">("generate");
  // BNH-10: routes Brain retrieval. Values must match the Brain namespace
  // strings exactly (docs/the-brain.md); "" = not set (all industries).
  const INDUSTRY_OPTIONS = [
    { value: "", label: "Not set (all industries)" },
    { value: "software", label: "Software" },
    { value: "manufacturing", label: "Manufacturing" },
    { value: "life-sciences", label: "Life sciences" },
  ];
  let industry = $state("");
  let title = $state("");
  let sredTitle = $state(""); // BNH-23: formal SR&ED title
  let clientName = $state("");
  let interviewer = $state("");
  let fiscalYearEnd = $state(""); // yyyy-mm-dd (BNH-36)
  let transcript = $state("");
  let staged = $state<Staged>(emptyStaged());

  // BNH-31: drag-and-drop a transcript file on the Details step.
  let transcriptInput: HTMLInputElement | null = $state(null);
  let transcriptDragOver = $state(false);
  let parsingTranscript = $state<string | null>(null);
  let transcriptFileError = $state("");

  async function handleTranscriptFile(file: File) {
    if (!isSupportedFile(file.name)) {
      transcriptFileError = `Can't read ${file.name} — unsupported type. Supported: ${SUPPORTED_LABEL}.`;
      return;
    }
    transcriptFileError = "";
    parsingTranscript = file.name;
    try {
      const parsed = await parseFileToText(file);
      const text = parsed.content.trim();
      if (!text) {
        transcriptFileError = `Couldn't extract any text from ${file.name}.`;
      } else {
        // Append if the writer already has text, otherwise populate.
        transcript = transcript.trim() ? `${transcript.trim()}\n\n${text}` : text;
      }
    } catch {
      transcriptFileError = `Couldn't read ${file.name}. Try another file.`;
    } finally {
      parsingTranscript = null;
    }
  }

  // BNH-39 review mode: the existing written PD to review (required).
  let pdInput: HTMLInputElement | null = $state(null);
  let pdDragOver = $state(false);
  let parsingPd = $state<string | null>(null);
  let pdFileError = $state("");
  let pdDoc = $state<{ name: string; content: string; file: File } | null>(null);

  async function handlePdFile(file: File) {
    if (!isSupportedFile(file.name)) {
      pdFileError = `Can't read ${file.name} — unsupported type. Supported: ${SUPPORTED_LABEL}.`;
      return;
    }
    pdFileError = "";
    parsingPd = file.name;
    try {
      const parsed = await parseFileToText(file);
      const text = parsed.content.trim();
      if (!text) {
        pdFileError = `Couldn't extract any text from ${file.name}.`;
      } else {
        pdDoc = { name: file.name, content: text, file };
      }
    } catch {
      pdFileError = `Couldn't read ${file.name}. Try another file.`;
    } finally {
      parsingPd = null;
    }
  }

  // Previous-year reports get a structured year-by-year UI (BNH-9 / BNH-26).
  // Multiple files + an optional note per year; the year label is editable, so
  // each row carries a stable id (year alone isn't safe identity once editable).
  const baseYear = new Date().getFullYear() - 1;
  let pyId = 1;
  let pyRows = $state<PyRow[]>([{ id: "py-0", year: baseYear, note: "", files: [] }]);
  let committing = $state(false);
  let progress = $state("");
  let error = $state("");

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) goto("/login", { replaceState: true });
  });

  const wordCount = $derived(transcript.trim().split(/\s+/).filter(Boolean).length);
  const pyFileCount = $derived(pyRows.reduce((n, r) => n + r.files.length, 0));
  const pyNoteOnlyCount = $derived(
    pyRows.filter((r) => r.files.length === 0 && r.note.trim()).length
  );
  const fileCount = $derived(
    CONTEXT_CATEGORIES.reduce(
      (n, c) =>
        c.id === "previous_pd"
          ? n
          : n + staged[c.id].files.length + (staged[c.id].text.trim() ? 1 : 0),
      0
    ) +
      pyFileCount +
      pyNoteOnlyCount
  );

  function addPyFiles(id: string, files: File[]) {
    pyRows = pyRows.map((r) => (r.id === id ? { ...r, files: [...r.files, ...files] } : r));
  }
  function removePyFile(id: string, idx: number) {
    pyRows = pyRows.map((r) =>
      r.id === id ? { ...r, files: r.files.filter((_, i) => i !== idx) } : r
    );
  }
  function updatePyYear(id: string, year: number) {
    pyRows = pyRows.map((r) => (r.id === id ? { ...r, year } : r));
  }
  function updatePyNote(id: string, note: string) {
    pyRows = pyRows.map((r) => (r.id === id ? { ...r, note } : r));
  }
  function removePyYear(id: string) {
    if (pyRows.length > 1) pyRows = pyRows.filter((r) => r.id !== id);
  }
  function addPyYear() {
    const minYear = Math.min(...pyRows.map((r) => r.year));
    pyRows = [...pyRows, { id: `py-${pyId++}`, year: minYear - 1, note: "", files: [] }];
  }

  function updateCategory(id: ContextCategoryId, patch: Partial<StagedCategory>) {
    staged = { ...staged, [id]: { ...staged[id], ...patch } };
  }

  function goNext() {
    error = "";
    if (step === 0) {
      if (!title.trim() || !clientName.trim()) {
        error = "Project title and client name are required.";
        return;
      }
      if (!fiscalYearEnd) {
        error = "Please set the client's fiscal year-end date.";
        return;
      }
      if (mode === "review" && !pdDoc) {
        error = "Please upload the written PD to review.";
        return;
      }
      if (mode === "generate" && !transcript.trim()) {
        error = "Please paste the interview transcript.";
        return;
      }
    }
    step = Math.min(step + 1, STEPS.length - 1);
  }

  async function uploadOriginal(file: File): Promise<Id<"_storage"> | undefined> {
    try {
      const url = await generateUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const json = (await res.json()) as { storageId: Id<"_storage"> };
      return json.storageId;
    } catch (e) {
      console.error("storage upload failed", e);
      return undefined;
    }
  }

  async function commit() {
    error = "";
    committing = true;
    try {
      progress = "Creating project…";
      const { projectId, transcriptId } = await createProject({
        title: title.trim(),
        ...(sredTitle.trim() ? { sredTitle: sredTitle.trim() } : {}),
        clientName: clientName.trim(),
        ...(writerName ? { writer: writerName } : {}),
        ...(interviewer.trim() ? { interviewer: interviewer.trim() } : {}),
        ...(fiscalYearEnd
          ? { fiscalYearEnd: new Date(`${fiscalYearEnd}T00:00:00`).getTime() }
          : {}),
        ...(industry ? { industry } : {}),
        mode,
        transcriptContent: transcript,
      });

      const uploadFile = async (
        file: File,
        category: ContextCategoryId,
        prefix = ""
      ) => {
        progress = `Uploading ${file.name}…`;
        const storageId = await uploadOriginal(file);
        let parsed;
        try {
          parsed = await parseFileToText(file);
        } catch {
          parsed = {
            fileName: file.name,
            fileType: guessFileType(file.name),
            content: "",
          };
        }
        await uploadDocument({
          projectId,
          fileName: file.name,
          fileType: parsed.fileType,
          content: prefix + parsed.content,
          source: "context_input",
          category,
          ...(storageId ? { storageId } : {}),
          ...(file.type ? { mimeType: file.type } : {}),
        });
      };

      // Previous-year reports — tagged with their fiscal year + optional note.
      for (const row of pyRows) {
        const noteLine = row.note.trim() ? `Note: ${row.note.trim()}\n` : "";
        for (const file of row.files) {
          await uploadFile(
            file,
            "previous_pd",
            `[Previous-year report — fiscal ${row.year}]\n${noteLine}\n`
          );
        }
        // A note with no files still carries useful prior-year context.
        if (row.note.trim() && row.files.length === 0) {
          await uploadDocument({
            projectId,
            fileName: `Previous-year note (FY ${row.year})`,
            fileType: "txt",
            content: `[Previous-year note — fiscal ${row.year}]\n\n${row.note.trim()}`,
            source: "context_input",
            category: "previous_pd",
          });
        }
      }

      // Other categories.
      for (const cat of CONTEXT_CATEGORIES) {
        if (cat.id === "previous_pd") continue;
        const s = staged[cat.id];
        for (const file of s.files) {
          await uploadFile(file, cat.id);
        }
        if (s.text.trim()) {
          await uploadDocument({
            projectId,
            fileName: `${cat.label} (pasted)`,
            fileType: "txt",
            content: s.text,
            source: "context_input",
            category: cat.id,
          });
        }
      }

      if (mode === "review" && pdDoc) {
        // BNH-39: store the written PD (no category — it must NOT feed a later
        // generation as context; the review agent reads it directly).
        progress = `Uploading ${pdDoc.name}…`;
        const storageId = await uploadOriginal(pdDoc.file);
        const documentId = await uploadDocument({
          projectId,
          fileName: pdDoc.name,
          fileType: guessFileType(pdDoc.name),
          content: pdDoc.content,
          source: "review_pd",
          ...(storageId ? { storageId } : {}),
          ...(pdDoc.file.type ? { mimeType: pdDoc.file.type } : {}),
        });
        progress = "Starting PD review…";
        await startPdReview({ projectId, documentId });
      } else {
        progress = "Starting generation…";
        await generateReport({ projectId, transcriptId });
      }
      goto(`/project/${projectId}`);
    } catch (e) {
      console.error(e);
      error = "Something went wrong creating the project. Please try again.";
      committing = false;
      progress = "";
    }
  }
</script>

{#snippet row(label: string, value: string)}
  <div class="flex justify-between border-b border-gray-100 py-1.5 last:border-0">
    <span class="text-gray-400">{label}</span>
    <span class="max-w-[60%] truncate text-right text-gray-800">{value}</span>
  </div>
{/snippet}

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "New project" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <main class="mx-auto w-full max-w-4xl flex-1 px-6 pt-12 pb-8">
      <!-- Step indicator (centered) -->
      <div class="mx-auto mb-8 flex w-full max-w-lg items-center gap-2">
        {#each STEPS as label, i (label)}
          <div class="flex flex-1 items-center gap-2">
            <div
              class={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                i < step
                  ? "bg-primary text-white"
                  : i === step
                    ? "bg-navy text-white"
                    : "bg-chrome text-gray-400"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            <span class={`text-xs ${i === step ? "font-medium text-navy" : "text-gray-400"}`}>
              {label}
            </span>
            {#if i < STEPS.length - 1}
              <div class="h-px flex-1 bg-gray-200"></div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Step 1 — details -->
      {#if step === 0}
        <div class="flex flex-col gap-5">
          <div class="flex items-end justify-between gap-4">
            <div>
              <h2 class="text-display">Project details</h2>
              <p class="mt-1 text-sm text-gray-500">
                {mode === "generate"
                  ? "Enter the basics, then drop a transcript file or paste it below."
                  : "Enter the basics, then upload the written PD you want reviewed."}
              </p>
            </div>
            {#if writerName}
              <span
                class="inline-flex flex-none items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs text-white"
                title="Set automatically to the signed-in user"
              >
                <svg class="h-3.5 w-3.5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Writer: <span class="font-semibold">{writerName}</span>
              </span>
            {/if}
          </div>

          <!-- BNH-39: Generate vs Review mode -->
          <div class="grid grid-cols-2 gap-2 rounded-xl bg-chrome p-1" role="radiogroup" aria-label="Project mode">
            {#each [
              { id: "generate", label: "Generate PD", hint: "Draft a new PD from an interview transcript" },
              { id: "review", label: "Review PD", hint: "AI feedback report on an existing written PD" },
            ] as const as opt (opt.id)}
              <button
                type="button"
                role="radio"
                aria-checked={mode === opt.id}
                onclick={() => (mode = opt.id)}
                class={`flex flex-col items-start gap-0.5 rounded-lg px-3.5 py-2.5 text-left transition-colors ${
                  mode === opt.id
                    ? "bg-white text-navy shadow-sm ring-1 ring-gray-200"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <span class="text-sm font-semibold">{opt.label}</span>
                <span class="text-xs text-gray-400">{opt.hint}</span>
              </button>
            {/each}
          </div>
          <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Input id="title" label="Internal project title" bind:value={title} placeholder="Project Verdant F2024" required />
            <Input id="sredTitle" label="SR&ED title (optional — finalize later)" bind:value={sredTitle} placeholder="e.g. Development of a multi-home SoC estimation system" />
            <Input id="clientName" label="Client name" bind:value={clientName} placeholder="GreenStem Nurseries Inc." required />
            <Input id="interviewer" label="Interviewer" bind:value={interviewer} placeholder="John Doe" />
            <div class="flex flex-col gap-1.5">
              <label for="industry" class="text-sm font-medium text-gray-700">Industry</label>
              <SelectInput id="industry" bind:value={industry} items={INDUSTRY_OPTIONS} />
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="fiscalYearEnd" class="text-sm font-medium text-gray-700">
                Fiscal year-end<span class="ml-0.5 text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                id="fiscalYearEnd"
                type="date"
                bind:value={fiscalYearEnd}
                class="h-[42px] rounded-lg border border-gray-200 bg-white px-3.5 text-sm text-gray-900 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
              <span class="text-xs text-gray-400">
                Groups this report under the client's fiscal year (e.g. Dec 31, 2025 → Fiscal 2025).
              </span>
            </div>
          </div>
          <!-- BNH-39: written PD upload (review mode only) -->
          {#if mode === "review"}
            <div class="flex flex-col gap-1.5">
              <span class="text-sm font-medium text-gray-700">
                Written PD to review<span class="ml-0.5 text-red-500" aria-hidden="true">*</span>
              </span>
              {#if pdDoc}
                <div class="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <div class="flex min-w-0 items-center gap-2.5">
                    <svg class="h-5 w-5 flex-none text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-gray-800">{pdDoc.name}</p>
                      <p class="text-xs text-gray-400">
                        {pdDoc.content.split(/\s+/).filter(Boolean).length.toLocaleString()} words extracted
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onclick={() => (pdDoc = null)}
                    aria-label="Remove file"
                    class="flex-none rounded-md p-1.5 text-gray-400 transition-colors hover:text-red-500"
                  >
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              {:else}
                <button
                  type="button"
                  onclick={() => pdInput?.click()}
                  ondragover={(e) => { e.preventDefault(); pdDragOver = true; }}
                  ondragleave={() => (pdDragOver = false)}
                  ondrop={(e) => {
                    e.preventDefault();
                    pdDragOver = false;
                    const file = e.dataTransfer?.files?.[0];
                    if (file) handlePdFile(file);
                  }}
                  class={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
                    pdDragOver
                      ? "border-primary bg-primary/5"
                      : "border-gray-200 bg-canvas hover:border-gray-300"
                  }`}
                >
                  {#if parsingPd}
                    <span class="inline-flex items-center gap-2 text-sm text-navy">
                      <Spinner size="sm" class="border-navy/30 border-t-navy" />
                      Reading {parsingPd}…
                    </span>
                  {:else}
                    <svg class="h-7 w-7 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <span class="text-sm font-medium text-gray-600">
                      Drag the written PD here, or click to browse
                    </span>
                    <span class="text-xs text-gray-400">Word (.docx), PDF, or .txt</span>
                  {/if}
                </button>
              {/if}
              <input
                bind:this={pdInput}
                type="file"
                accept={SUPPORTED_ACCEPT}
                class="hidden"
                onchange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) handlePdFile(file);
                  e.currentTarget.value = "";
                }}
              />
              {#if pdFileError}
                <p class="text-xs text-red-600">{pdFileError}</p>
              {/if}
            </div>
          {/if}

          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <label for="transcript" class="flex flex-wrap items-baseline gap-x-1.5 text-sm font-medium text-gray-700">
                <span>
                  Interview transcript{#if mode === "generate"}<span class="ml-0.5 text-red-500" aria-hidden="true">*</span>{/if}
                </span>
                {#if mode === "review"}
                  <span class="font-normal text-gray-400">(optional — adds context for the review)</span>
                {/if}
              </label>
              {#if wordCount > 0}
                <span class="text-xs text-gray-400">{wordCount.toLocaleString()} words</span>
              {/if}
            </div>

            <!-- BNH-31: large drag-and-drop zone to import a transcript file -->
            <button
              type="button"
              onclick={() => transcriptInput?.click()}
              ondragover={(e) => { e.preventDefault(); transcriptDragOver = true; }}
              ondragleave={() => (transcriptDragOver = false)}
              ondrop={(e) => {
                e.preventDefault();
                transcriptDragOver = false;
                const file = e.dataTransfer?.files?.[0];
                if (file) handleTranscriptFile(file);
              }}
              class={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
                transcriptDragOver
                  ? "border-primary bg-primary/5"
                  : "border-gray-200 bg-canvas hover:border-gray-300"
              }`}
            >
              {#if parsingTranscript}
                <span class="inline-flex items-center gap-2 text-sm text-navy">
                  <Spinner size="sm" class="border-navy/30 border-t-navy" />
                  Reading {parsingTranscript}…
                </span>
              {:else}
                <svg class="h-7 w-7 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span class="text-sm font-medium text-gray-600">
                  Drag a transcript file here, or click to browse
                </span>
                <span class="text-xs text-gray-400">
                  Word (.docx), PDF, .txt, email (.eml/.msg) — or just paste below
                </span>
              {/if}
            </button>
            <input
              bind:this={transcriptInput}
              type="file"
              accept={SUPPORTED_ACCEPT}
              class="hidden"
              onchange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) handleTranscriptFile(file);
                e.currentTarget.value = "";
              }}
            />
            {#if transcriptFileError}
              <p class="text-xs text-red-600">{transcriptFileError}</p>
            {/if}

            <textarea
              id="transcript"
              rows={14}
              bind:value={transcript}
              placeholder="…or paste the full interview transcript here"
              class="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 font-serif text-sm leading-relaxed text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            ></textarea>
          </div>
        </div>
      {/if}

      <!-- Step 2 — context & files -->
      {#if step === 1}
        <div class="flex flex-col gap-4">
          <div>
            <h2 class="text-display">Context & files</h2>
            <p class="mt-1 text-sm text-gray-500">
              Add any supporting material so the report is grounded in more than the transcript.
              Everything here is <span class="font-medium">optional</span> — add what you have.
            </p>
          </div>
          {#each CONTEXT_CATEGORIES as cat (cat.id)}
            {#if cat.id === "previous_pd"}
              <PreviousYearCard
                def={cat}
                rows={pyRows}
                onAddFiles={addPyFiles}
                onRemoveFile={removePyFile}
                onUpdateYear={updatePyYear}
                onUpdateNote={updatePyNote}
                onRemoveYear={removePyYear}
                onAddYear={addPyYear}
              />
            {:else}
              <CategoryCard
                def={cat}
                value={staged[cat.id]}
                onAddFiles={(fs) => updateCategory(cat.id, { files: [...staged[cat.id].files, ...fs] })}
                onRemoveFile={(idx) =>
                  updateCategory(cat.id, {
                    files: staged[cat.id].files.filter((_, i) => i !== idx),
                  })}
                onText={(text) => updateCategory(cat.id, { text })}
              />
            {/if}
          {/each}
        </div>
      {/if}

      <!-- Step 3 — review -->
      {#if step === 2}
        <div class="flex flex-col gap-5">
          <div>
            <h2 class="text-display">{mode === "generate" ? "Review & generate" : "Review & start"}</h2>
            <p class="mt-1 text-sm text-gray-500">
              {mode === "generate"
                ? "Confirm everything looks right, then generate the draft report."
                : "Confirm everything looks right, then start the AI review of the written PD."}
            </p>
          </div>
          <div class="card p-4 text-sm">
            {@render row("Mode", mode === "generate" ? "Generate PD" : "Review PD")}
            {@render row("Project", title || "—")}
            {@render row("Client", clientName || "—")}
            {#if industry}
              {@render row("Industry", INDUSTRY_OPTIONS.find((o) => o.value === industry)?.label ?? industry)}
            {/if}
            {#if writerName}
              {@render row("Writer", writerName)}
            {/if}
            {#if interviewer}
              {@render row("Interviewer", interviewer)}
            {/if}
            {#if mode === "review"}
              {@render row("Written PD", pdDoc?.name ?? "—")}
            {/if}
            {@render row("Transcript", wordCount > 0 ? `${wordCount.toLocaleString()} words` : "None")}
            {@render row("Context items", fileCount > 0 ? `${fileCount} attached` : "None")}
          </div>
          {#if fileCount > 0}
            <div class="card p-4">
              {#if pyFileCount > 0 || pyNoteOnlyCount > 0}
                <div class="mb-2">
                  <p class="text-label">Previous-year reports</p>
                  <ul class="mt-0.5 text-sm text-gray-700">
                    {#each pyRows.filter((r) => r.files.length || r.note.trim()) as r (r.id)}
                      <li class="truncate">
                        <span class="text-gray-400">FY {r.year}:</span>
                        {r.files.length
                          ? r.files.map((f) => f.name).join(", ")
                          : "note only"}
                        {#if r.note.trim()}
                          <span class="text-gray-400">
                            — “{r.note.trim().slice(0, 50)}{r.note.trim().length > 50 ? "…" : ""}”
                          </span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#each CONTEXT_CATEGORIES.filter((c) => c.id !== "previous_pd" && (staged[c.id].files.length || staged[c.id].text.trim())) as c (c.id)}
                <div class="mb-2 last:mb-0">
                  <p class="text-label">{c.label}</p>
                  <ul class="mt-0.5 text-sm text-gray-700">
                    {#each staged[c.id].files as f, i (i)}
                      <li class="truncate">• {f.name}</li>
                    {/each}
                    {#if staged[c.id].text.trim()}
                      <li>• Pasted notes ({staged[c.id].text.trim().length} chars)</li>
                    {/if}
                  </ul>
                </div>
              {/each}
            </div>
          {/if}
          {#if committing && progress}
            <div class="flex items-center gap-2 rounded-lg bg-chrome px-3 py-2 text-sm text-navy">
              <Spinner size="sm" class="h-3.5 w-3.5 border-navy" />
              {progress}
            </div>
          {/if}
        </div>
      {/if}

      {#if error}
        <div class="mt-5 rounded-lg bg-red-50 px-3 py-2">
          <p class="text-sm text-red-600">{error}</p>
        </div>
      {/if}

      <!-- Nav -->
      <div class="mt-8 flex items-center justify-between">
        <div>
          {#if step > 0}
            <Button type="button" variant="ghost" onclick={() => { error = ""; step -= 1; }} disabled={committing}>
              Back
            </Button>
          {:else}
            <a href="/dashboard">
              <Button type="button" variant="ghost">Cancel</Button>
            </a>
          {/if}
        </div>
        <div class="flex items-center gap-3">
          {#if step < STEPS.length - 1}
            <Button type="button" onclick={goNext}>
              {step === 1 && fileCount === 0 ? "Skip — Review" : "Next"}
            </Button>
          {:else}
            <Button type="button" onclick={commit} disabled={committing}>
              {#if committing}
                <Spinner size="sm" class="mr-2 h-3.5 w-3.5 border-white" />
                Working…
              {:else}
                <svg class="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {mode === "generate" ? "Generate Report" : "Review PD"}
              {/if}
            </Button>
          {/if}
        </div>
      </div>
    </main>
  </div>
{/if}

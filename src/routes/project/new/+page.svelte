<script lang="ts">
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import FiscalYearEndInput from "$lib/components/project/FiscalYearEndInput.svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import {
    parseFileToText,
    isImageFile,
    isSupportedFile,
    SUPPORTED_ACCEPT,
    SUPPORTED_LABEL,
  } from "$lib/parseDocument";
  import { CONTEXT_CATEGORIES, type ContextCategoryId } from "$lib/contextCategories";
  import { userErrorMessage } from "$lib/errors";
  import {
    emptyStaged,
    guessFileType,
    type Staged,
    type StagedCategory,
    type PyRow,
  } from "$lib/components/project-new/shared";
  import CategoryRow from "$lib/components/project-new/CategoryRow.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import PreviousYearRow from "$lib/components/project-new/PreviousYearRow.svelte";
  import TagPicker from "$lib/components/project-new/TagPicker.svelte";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import { industryLabel } from "$lib/industries";
  import { CRA_SCIENCE_CODE_ITEMS, scienceCodeLabel } from "../../../../shared/craScienceCodes";
  import { SINGLE_MODEL_ITEMS, comparePairFromSlots, comparePairLabel, type CandidateModelId } from "../../../../shared/generationModels";
  import ComparePairPicker from "$lib/components/generation/ComparePairPicker.svelte";
  import SingleModelPicker from "$lib/components/generation/SingleModelPicker.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { displayName } from "$lib/displayName";
  import { page } from "$app/state";

  // Jul 17 meeting: transcript + context inputs merged onto one page so
  // writers see every upload slot at once (no more drawings in the
  // transcript field because the doc slots were hidden on a later step).
  const STEPS = ["Details & files", "Review"];

  const auth = useAuth();
  const createProject = useMutation(api.projects.createProject);
  const generateReport = useMutation(api.generations.requestGeneration);
  const startPdReview = useMutation(api.pdReviews.startPdReview);
  const uploadDocument = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const user = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  // BNH-22: team roster for the interviewer picker.
  const teamQ = useQuery(api.users.listTeam, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const interviewerOptions = $derived([
    { value: "", label: "Not set" },
    ...(teamQ.data ?? []).map((member) => ({
      value: member.id,
      label:
        member.email && member.email !== member.name
          ? `${member.name} (${member.email})`
          : member.name,
    })),
  ]);
  // BNH-35: available tags for the tag selector.
  const tagsQ = useQuery(api.tags.listTags, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const allTags = $derived(tagsQ.data ?? []);

  // Writer is always the signed-in user — not editable.
  const writerName = $derived(user.data ? displayName(user.data, "Unknown team member") : "");

  let step = $state(0);
  // BNH-39: generate a new PD from a transcript, or review an existing written PD.
  let mode = $state<"generate" | "review">("generate");
  let candidateMode = $state<"compare" | "single" | "iterative">("compare");
  let singleModelId = $state<CandidateModelId | "">("");
  // Compare mode runs exactly 2 models — two slots, each a model or Random.
  let compareSlotA = $state("");
  let compareSlotB = $state("");
  // BNH-10: routes Brain retrieval. Only admins can extend the vocabulary.
  let industry = $state("");
  let scienceCode = $state("");
  let title = $state("");
  let sredTitle = $state(""); // BNH-23: formal SR&ED title
  let clientName = $state("");
  let interviewerUserId = $state("");
  const interviewerName = $derived(
    (teamQ.data ?? []).find((member) => member.id === interviewerUserId)?.name ?? ""
  );
  // BNH-22: client-side interview participants (multi-entry).
  let interviewees = $state<string[]>([]);
  let intervieweeDraft = $state("");
  // BNH-35: selected tag ids.
  let selectedTagIds = $state<string[]>([]);
  let fiscalYearEnd = $state(""); // yyyy-mm-dd (BNH-36)

  function addInterviewee() {
    const name = intervieweeDraft.trim();
    if (!name) return;
    if (!interviewees.some((n) => n.toLowerCase() === name.toLowerCase())) {
      interviewees = [...interviewees, name];
    }
    intervieweeDraft = "";
  }
  function removeInterviewee(idx: number) {
    interviewees = interviewees.filter((_, i) => i !== idx);
  }
  let transcript = $state("");
  // BNH-31: single-tab transcript input — upload OR paste, not both at once.
  let transcriptTab = $state<"upload" | "paste">("upload");

  // Duplicate flow: /project/new?from=<projectId> prefills the wizard from an
  // existing project (setup + transcript now; documents copied on commit).
  const fromProjectId = page.url.searchParams.get("from");
  const sourceProjectQ = useQuery(api.projects.getProject, () =>
    auth.isAuthenticated && fromProjectId
      ? { projectId: fromProjectId as Id<"projects"> }
      : "skip"
  );
  const sourceTranscriptQ = useQuery(api.transcripts.getTranscript, () =>
    auth.isAuthenticated && fromProjectId
      ? { projectId: fromProjectId as Id<"projects"> }
      : "skip"
  );
  const copyProjectDocuments = useMutation(api.projects.copyProjectDocuments);

  let prefilled = $state(false);
  $effect(() => {
    const source = sourceProjectQ?.data;
    if (!fromProjectId || !source || prefilled) return;
    prefilled = true;
    title = `${source.title} (copy)`;
    clientName = source.clientName;
    sredTitle = source.sredTitle ?? "";
    industry = source.industry ?? "";
    scienceCode = source.scienceCode ?? "";
    mode = source.mode ?? "generate";
    interviewerUserId = source.interviewerUserId ?? "";
    interviewees = source.interviewees ?? [];
    selectedTagIds = (source.tagIds ?? []) as string[];
    if (source.fiscalYearEnd) {
      fiscalYearEnd = new Date(source.fiscalYearEnd).toISOString().slice(0, 10);
    }
  });
  $effect(() => {
    const sourceTranscript = sourceTranscriptQ?.data;
    if (!fromProjectId || !sourceTranscript || transcript) return;
    transcript = sourceTranscript.content;
    transcriptTab = "paste";
  });
  let staged = $state<Staged>(emptyStaged());

  // BNH-31: drag-and-drop a transcript file on the Details step.
  let transcriptInput: HTMLInputElement | null = $state(null);
  let transcriptDragOver = $state(false);
  let parsingTranscript = $state<string | null>(null);
  let transcriptFileError = $state("");

  // Jul 17 meeting: transcripts are Teams exports — .docx only. Anything else
  // belongs in the supporting-document slots below; the copy-paste tab stays
  // as the fallback for the rare non-Teams interview (Google Meet etc.).
  // The uploaded file stays visible as a chip; the extracted text is kept
  // behind the scenes instead of being dumped into the textarea.
  let transcriptFileName = $state<string | null>(null);

  async function handleTranscriptFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      transcriptFileError = `Transcripts must be Word (.docx) files — Teams exports are. Put other documents in the context slots below, or paste the transcript text instead.`;
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
        transcript = text;
        transcriptFileName = file.name;
        toast.success(`Imported ${file.name}`);
      }
    } catch {
      transcriptFileError = `Couldn't read ${file.name}. Try another file.`;
    } finally {
      parsingTranscript = null;
    }
  }

  function removeTranscriptFile() {
    transcriptFileName = null;
    transcript = "";
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

  // Step 0 is complete only when every required input is filled; Next stays
  // disabled until then (fiscal year-end is optional — BNH feedback 2026-07-09).
  // Jul 17 meeting: the transcript is no longer required up front — some
  // engagements only have a spreadsheet/drawings/an email. Generation still
  // needs at least one source (transcript OR context docs), checked at commit.
  const detailsValid = $derived(
    Boolean(title.trim() && clientName.trim() && (mode === "review" ? pdDoc : true))
  );
  const canGoNext = $derived(step !== 0 || detailsValid);

  // At least one generation source: a transcript, or any staged context item
  // that yields text. Images are reference-only (no extraction), so an
  // image-only project would fail the backend's readable-source check.
  const textualFileCount = $derived(
    CONTEXT_CATEGORIES.reduce(
      (n, c) =>
        c.id === "previous_pd"
          ? n
          : n +
            staged[c.id].files.filter((f) => !isImageFile(f.name)).length +
            (staged[c.id].text.trim() ? 1 : 0),
      0
    ) +
      pyRows.reduce(
        (n, r) => n + r.files.filter((f) => !isImageFile(f.name)).length,
        0
      ) +
      pyNoteOnlyCount
  );
  const hasAnySource = $derived(
    mode === "review" || Boolean(transcript.trim()) || textualFileCount > 0
  );

  function goNext() {
    if (step === 0 && !detailsValid) {
      if (!title.trim() || !clientName.trim())
        toast.error("Project title and client name are required.");
      else if (mode === "review")
        toast.error("Upload the written PD to review.");
      return;
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
    if (!hasAnySource) {
      toast.error(
        "Add an interview transcript or at least one context document before generating."
      );
      return;
    }
    committing = true;
    let createdProjectId: Id<"projects"> | null = null;
    try {
      progress = "Creating project…";
      const { projectId, transcriptId } = await createProject({
        title: title.trim(),
        ...(sredTitle.trim() ? { sredTitle: sredTitle.trim() } : {}),
        clientName: clientName.trim(),
        ...(interviewerUserId
          ? { interviewerUserId: interviewerUserId as Id<"users"> }
          : {}),
        ...(interviewees.length ? { interviewees } : {}),
        ...(selectedTagIds.length
          ? { tagIds: selectedTagIds as Id<"tags">[] }
          : {}),
        ...(fiscalYearEnd
          ? { fiscalYearEnd: new Date(`${fiscalYearEnd}T00:00:00`).getTime() }
          : {}),
        ...(industry ? { industry } : {}),
        ...(scienceCode ? { scienceCode } : {}),
        mode,
        transcriptContent: transcript,
      });
      createdProjectId = projectId;

      // Duplicate flow: bring the source project's documents along.
      if (fromProjectId) {
        progress = "Copying documents…";
        await copyProjectDocuments({
          fromProjectId: fromProjectId as Id<"projects">,
          toProjectId: projectId,
        });
      }

      // One unreadable/oversized doc must never sink the whole project —
      // skip it, tell the writer which ones were skipped, and keep going.
      const skippedFiles: string[] = [];
      const uploadFile = async (
        file: File,
        category: ContextCategoryId,
        prefix = ""
      ) => {
        progress = `Uploading ${file.name}…`;
        try {
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
        } catch (e) {
          console.error(`upload failed for ${file.name}`, e);
          skippedFiles.push(file.name);
        }
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
        await generateReport({
          projectId,
          transcriptId,
          candidateMode,
          ...(candidateMode !== "compare" && singleModelId
            ? { singleModelId }
            : {}),
          ...(candidateMode === "compare"
            ? (() => {
                const pair = comparePairFromSlots(compareSlotA, compareSlotB);
                return pair ? { compareModelIds: pair } : {};
              })()
            : {}),
        });
      }
      if (skippedFiles.length) {
        toast.error(
          `${skippedFiles.length} document(s) could not be uploaded and were skipped: ${skippedFiles.join(", ")}`
        );
      }
      goto(`/project/${projectId}`);
    } catch (e) {
      console.error(e);
      // The project may already exist at this point (createProject succeeded,
      // a later step failed). Land the writer on it rather than stranding them
      // on the wizard with work they can't see.
      const message = userErrorMessage(
        e,
        "Something went wrong creating the project. Please try again."
      );
      toast.error(message);
      committing = false;
      progress = "";
      if (createdProjectId) {
        toast.error(
          "The project was created but generation did not start — open it and use Generate to retry."
        );
        goto(`/project/${createdProjectId}`);
      }
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
    <PageBar backHref="/dashboard" backLabel="Back">
      {#snippet actions()}
        {#if writerName}
          <Tooltip text="Set automatically to the signed-in user">
            {#snippet children({ props })}
              <span {...props} class="whitespace-nowrap text-sm font-medium text-navy">
                Consultant · {writerName}
              </span>
            {/snippet}
          </Tooltip>
        {/if}
      {/snippet}
    </PageBar>

    <main class="mx-auto w-full max-w-[var(--container-shell)] flex-1 px-6 pt-8 pb-8">
      <!-- Step indicator — segment bar: two labeled progress segments, the
           ledger idiom (a rule that fills) instead of numbered circles. -->
      <div class="mx-auto mb-6 w-full max-w-sm">
        <div class="flex gap-1.5" aria-label="Setup steps">
          {#each STEPS as label, i (label)}
            <button
              type="button"
              aria-current={i === step ? "step" : undefined}
              onclick={() => { if (i < step) step = i; }}
              disabled={i > step}
              class={`group flex-1 pb-1.5 text-left ${i < step ? "cursor-pointer" : "cursor-default"}`}
            >
              <span
                class={`text-[11px] font-medium tracking-wide transition-colors ${
                  i === step
                    ? "text-navy"
                    : i < step
                      ? "text-primary-dark group-hover:text-navy"
                      : "text-gray-300"
                }`}
              >
                {i < step ? "✓ " : ""}{label}
              </span>
              <span
                class={`mt-1 block h-0.5 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-gray-200"
                }`}
              ></span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Step 1 — details -->
      {#if step === 0}
        <div class="flex flex-col gap-4">
          <div>
            <h2 class="text-title">Project details</h2>
            <p class="mt-0.5 text-xs text-gray-500">
              {mode === "generate"
                ? "Enter the basics, then drop a transcript file or paste it below."
                : "Enter the basics, then upload the written PD you want reviewed."}
            </p>
          </div>

          <!-- Mode and draft-generation controls -->
          <!-- Generation controls — separated from the field grid below by a
               hairline so the row reads as its own band. -->
          <div class="mb-6 mt-2 flex flex-wrap items-center gap-x-10 gap-y-5 border-b border-gray-100 pb-6">
            <!-- BNH-39: Generate vs Review mode -->
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-gray-500">Mode</span>
              <div class="flex gap-1 rounded-lg bg-chrome p-1" role="radiogroup" aria-label="Project mode">
                {#each [
                  { id: "generate", label: "Generate PD", hint: "Draft a new PD from an interview transcript" },
                  { id: "review", label: "Review PD", hint: "AI feedback report on an existing written PD" },
                ] as const as opt (opt.id)}
                  <Tooltip text={opt.hint}>
                    {#snippet children({ props })}
                      <button
                        {...props}
                        type="button"
                        role="radio"
                        aria-checked={mode === opt.id}
                        onclick={() => (mode = opt.id)}
                        class={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
                          mode === opt.id
                            ? "bg-primary-selected text-white"
                            : "text-gray-500 hover:bg-primary-wash hover:text-navy"
                        }`}
                      >
                        {opt.label}
                      </button>
                    {/snippet}
                  </Tooltip>
                {/each}
              </div>
            </div>
            {#if mode === "generate"}
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-gray-500">Drafts</span>
                <div class="flex gap-1 rounded-lg bg-chrome p-1" role="radiogroup" aria-label="Draft generation mode">
                  {#each [
                    { id: "compare", label: "Compare", hint: "Generate two alternatives and choose one" },
                    { id: "single", label: "Single draft", hint: "Generate one draft and open it directly" },
                    { id: "iterative", label: "Section by section", hint: "Draft one section at a time — review and approve each before the next" },
                  ] as const as opt (opt.id)}
                    <Tooltip text={opt.hint}>
                      {#snippet children({ props })}
                        <button
                          {...props}
                          type="button"
                          role="radio"
                          aria-checked={candidateMode === opt.id}
                          onclick={() => (candidateMode = opt.id)}
                          class={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
                            candidateMode === opt.id
                              ? "bg-primary-selected text-white"
                              : "text-gray-500 hover:bg-primary-wash hover:text-navy"
                          }`}
                        >
                          {opt.label}
                        </button>
                      {/snippet}
                    </Tooltip>
                  {/each}
                </div>
              </div>
              <div class="ml-auto">
                {#if candidateMode !== "compare"}
                  <SingleModelPicker bind:value={singleModelId} size="md" />
                {:else}
                  <ComparePairPicker bind:slotA={compareSlotA} bind:slotB={compareSlotB} size="md" />
                {/if}
              </div>
            {/if}
          </div>
          <div class="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            <Input id="title" label="Internal project title" bind:value={title} placeholder="Project Verdant F2024" required />
            <Input id="sredTitle" label="SR&ED title (optional — finalize later)" bind:value={sredTitle} placeholder="e.g. Development of a multi-home SoC estimation system" />
            <Input id="clientName" label="Client name" bind:value={clientName} placeholder="GreenStem Nurseries Inc." required />
            <!-- BNH-22: interviewer selectable from the team roster -->
            <div class="flex flex-col gap-1.5">
              <label for="interviewer" class="text-sm font-medium text-gray-700">Interviewer</label>
              <SelectInput id="interviewer" bind:value={interviewerUserId} items={interviewerOptions} />
            </div>
            <!-- BNH-22: multiple client-side interviewees -->
            <div class="flex flex-col gap-1.5">
              <label for="interviewee" class="text-sm font-medium text-gray-700">Interviewees (client)</label>
              <div class="flex gap-2">
                <input
                  id="interviewee"
                  type="text"
                  bind:value={intervieweeDraft}
                  placeholder="Add a name, press Enter"
                  onkeydown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addInterviewee();
                    }
                  }}
                  class="h-[42px] min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
                <Button type="button" variant="secondary" onclick={addInterviewee} disabled={!intervieweeDraft.trim()}>
                  Add
                </Button>
              </div>
              {#if interviewees.length}
                <div class="flex flex-wrap gap-1.5">
                  {#each interviewees as name, i (name)}
                    <span class="inline-flex items-center gap-1 rounded-full bg-chrome px-2.5 py-1 text-xs text-gray-700">
                      {name}
                      <button
                        type="button"
                        aria-label={`Remove ${name}`}
                        onclick={() => removeInterviewee(i)}
                        class="text-gray-400 transition-colors hover:text-red-500"
                      >
                        ×
                      </button>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="industry" class="text-sm font-medium text-gray-700">Industry</label>
              <IndustrySelect id="industry" bind:value={industry} canCreate={user.data?.role === "admin"} />
              <p class="text-xs text-gray-500">
                {user.data?.role === "admin" ? "Admins can add industries." : "Ask an admin to add a new industry."}
              </p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="scienceCode" class="text-sm font-medium text-gray-700">Science code</label>
              <SelectInput id="scienceCode" bind:value={scienceCode} items={CRA_SCIENCE_CODE_ITEMS} class="max-w-full" />
            </div>
            <FiscalYearEndInput bind:value={fiscalYearEnd} />
          </div>

          <!-- BNH-35: project tags -->
          {#if allTags.length > 0}
            <TagPicker {allTags} bind:selectedTagIds />
          {/if}
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

          <!-- Extra top gap isolates the transcript section from the fields above. -->
          <div class="mt-4 flex flex-col gap-1.5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <label for="transcript" class="flex flex-wrap items-baseline gap-x-1.5 text-xs font-medium text-gray-700">
                <span>Interview transcript</span>
                {#if mode === "review"}
                  <span class="font-normal text-gray-400">(optional — adds context for the review)</span>
                {:else}
                  <span class="font-normal text-gray-400">(optional if you add context documents on the next step)</span>
                {/if}
              </label>
              <div class="flex items-center gap-3">
                {#if wordCount > 0}
                  <span class="text-xs text-gray-400">{wordCount.toLocaleString()} words</span>
                {/if}
                <!-- BNH-31: upload OR paste — one shown at a time to keep the page short -->
                <div class="flex gap-1 rounded-lg bg-chrome p-1" role="tablist" aria-label="Transcript input method">
                  {#each [
                    { id: "upload", label: "Upload file" },
                    { id: "paste", label: "Paste text" },
                  ] as const as tab (tab.id)}
                    <button
                      type="button"
                      role="tab"
                      aria-selected={transcriptTab === tab.id}
                      onclick={() => (transcriptTab = tab.id)}
                      class={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
                        transcriptTab === tab.id
                          ? "bg-primary-selected text-white"
                          : "text-gray-500 hover:bg-primary-wash hover:text-navy"
                      }`}
                    >
                      {tab.label}
                    </button>
                  {/each}
                </div>
              </div>
            </div>

            {#if transcriptTab === "upload"}
              {#if transcriptFileName}
                <!-- Imported transcript stays as a file chip — nobody reads the
                     extracted text log (Jul 17). -->
                <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <span class="flex min-w-0 items-center gap-2.5">
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-500">
                      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </span>
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-gray-800">{transcriptFileName}</span>
                      <span class="block text-xs text-gray-400">{wordCount.toLocaleString()} words extracted</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    onclick={removeTranscriptFile}
                    class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              {:else}
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
                class={`flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-dashed px-4 py-4 text-center transition-colors ${
                  transcriptDragOver
                    ? "border-primary bg-primary/10"
                    : "border-primary/40 bg-primary-wash hover:brightness-[0.97]"
                }`}
              >
                {#if parsingTranscript}
                  <span class="inline-flex items-center gap-2 text-sm text-navy">
                    <Spinner size="sm" class="border-navy/30 border-t-navy" />
                    Reading {parsingTranscript}…
                  </span>
                {:else}
                  <svg class="h-5 w-5 text-primary/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <span class="text-xs font-medium text-primary-dark">
                    Drag the transcript here, or click to browse
                  </span>
                  <span class="text-[11px] text-primary-dark/60">
                    Word (.docx) — the Teams export
                  </span>
                {/if}
              </button>
              {/if}
            {:else}
              <textarea
                id="transcript"
                rows={12}
                bind:value={transcript}
                placeholder="Paste the full interview transcript here"
                class="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 font-serif text-sm leading-relaxed text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              ></textarea>
            {/if}
            <input
              bind:this={transcriptInput}
              type="file"
              accept=".docx"
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
          </div>
          <!-- Context & files — one ledger card of divided rows (Jul 20).
               Each category is a row: label ledger-style on the left, staged
               chips in the middle, actions right; the whole row is a drop
               target. Ordered by SR&ED weight, so the card reads as the
               weighting table it actually is. -->
          <div class="mt-5">
            <div class="flex items-baseline justify-between gap-3">
              <h2 class="text-title">Context & files</h2>
              <p class="text-xs text-gray-400">
                All optional · {fileCount} item{fileCount === 1 ? "" : "s"} attached
              </p>
            </div>
            <div class="card mt-2.5 divide-y divide-gray-100 overflow-hidden">
              {#each CONTEXT_CATEGORIES as cat (cat.id)}
                {#if cat.id === "previous_pd"}
                  <PreviousYearRow
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
                  <CategoryRow
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
          </div>
        </div>
      {/if}

      <!-- Step 2 — review -->
      {#if step === 1}
        <div class="flex flex-col gap-4">
          <div>
            <h2 class="text-title">{mode === "generate" ? "Review & generate" : "Review & start"}</h2>
            <p class="mt-0.5 text-xs text-gray-500">
              {mode === "generate"
                ? "Confirm everything looks right, then generate the draft report."
                : "Confirm everything looks right, then start the AI review of the written PD."}
            </p>
          </div>
          <div class="card p-4 text-sm">
            {@render row("Mode", mode === "generate" ? "Generate PD" : "Review PD")}
            {#if mode === "generate"}
              {@render row(
                "Draft generation",
                candidateMode === "compare"
                  ? "Compare 2 drafts"
                  : candidateMode === "iterative"
                    ? "Section by section"
                    : "Single draft"
              )}
              {#if candidateMode === "compare"}
                {@render row("Models", comparePairLabel(compareSlotA, compareSlotB))}
              {/if}
              {#if candidateMode !== "compare"}
                {@render row(
                  "Model",
                  SINGLE_MODEL_ITEMS.find((item) => item.value === singleModelId)?.label ?? SINGLE_MODEL_ITEMS[0].label
                )}
              {/if}
            {/if}
            {@render row("Project", title || "—")}
            {@render row("Client", clientName || "—")}
            {#if industry}
              {@render row("Industry", industryLabel(industry))}
            {/if}
            {#if scienceCode}
              {@render row("Science code", scienceCodeLabel(scienceCode))}
            {/if}
            {#if writerName}
              {@render row("Consultant", writerName)}
            {/if}
            {#if interviewerName}
              {@render row("Interviewer", interviewerName)}
            {/if}
            {#if interviewees.length}
              {@render row("Interviewees", interviewees.join(", "))}
            {/if}
            {#if selectedTagIds.length}
              {@render row(
                "Tags",
                allTags
                  .filter((t) => selectedTagIds.includes(t._id))
                  .map((t) => t.name)
                  .join(", ")
              )}
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

      <!-- Nav -->
      <div class="mt-8 flex items-center justify-between">
        <div>
          {#if step > 0}
            <Button type="button" variant="ghost" onclick={() => (step -= 1)} disabled={committing}>
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
            <Button type="button" onclick={goNext} disabled={!canGoNext}>
              {step === 0 ? "Next" : "Continue"}
            </Button>
          {:else}
            {#if !hasAnySource}
              <span class="text-xs text-amber-600">
                Add a transcript or at least one context document first.
              </span>
            {/if}
            <Button
              type="button"
              onclick={commit}
              disabled={committing || !hasAnySource}
            >
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

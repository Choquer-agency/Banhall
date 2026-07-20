<!--
  One context category as an ACCORDION row (Jul 20 v4). Closed: a single
  header line — color dot, label, weight chip, attachment summary, chevron
  (design rule 7: right edge, down→up, primary when open). Open: help text,
  a full-width drop/browse target, and the paste-text disclosure. Dropping
  files on a closed header opens the row and accepts them.
-->
<script lang="ts">
  import { slide } from "svelte/transition";
  import { SUPPORTED_ACCEPT } from "$lib/parseDocument";
  import type { ContextCategoryDef } from "$lib/contextCategories";
  import { partitionSupported, WEIGHT_STYLES, type StagedCategory } from "./shared";
  import UnsupportedWarning from "./UnsupportedWarning.svelte";

  let {
    def,
    value,
    onAddFiles,
    onRemoveFile,
    onText,
  }: {
    def: ContextCategoryDef;
    value: StagedCategory;
    onAddFiles: (files: File[]) => void;
    onRemoveFile: (idx: number) => void;
    onText: (text: string) => void;
  } = $props();

  let open = $state(false);
  let inputEl: HTMLInputElement | null = $state(null);
  let dragOver = $state(false);
  let rejected = $state<string[]>([]);
  // Paste area visibility inside the open row — seeded once from initial
  // value (duplicate flow); after that the writer owns the toggle.
  // svelte-ignore state_referenced_locally
  let pasteOpen = $state(Boolean(value.text.trim()));

  const dotClass = $derived(def.pill.split(" ").find((c) => c.startsWith("text-")) ?? "text-gray-400");
  const attachedSummary = $derived.by(() => {
    const parts: string[] = [];
    if (value.files.length) parts.push(`${value.files.length} file${value.files.length === 1 ? "" : "s"}`);
    if (value.text.trim()) parts.push("notes");
    return parts.join(" + ");
  });

  function accept(files: File[]) {
    const { ok, rejected: bad } = partitionSupported(files);
    if (ok.length) onAddFiles(ok);
    rejected = bad;
    if (ok.length || bad.length) open = true;
  }
</script>

<div
  role="region"
  aria-label={`${def.label} files`}
  ondragover={(e) => { e.preventDefault(); dragOver = true; }}
  ondragleave={() => (dragOver = false)}
  ondrop={(e) => {
    e.preventDefault();
    dragOver = false;
    if (e.dataTransfer) accept(Array.from(e.dataTransfer.files));
  }}
  class={`transition-colors ${dragOver ? "bg-primary/5" : ""}`}
>
  <!-- Header — the accordion toggle -->
  <button
    type="button"
    onclick={() => (open = !open)}
    aria-expanded={open}
    class="flex w-full items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-primary-wash/50"
  >
    <svg class={`h-2 w-2 flex-none ${dotClass}`} viewBox="0 0 6 6" aria-hidden="true">
      <circle cx="3" cy="3" r="3" fill="currentColor" />
    </svg>
    <span class="text-sm font-medium text-gray-900">{def.label}</span>
    <span class={`flex-none rounded-full px-2 py-0.5 text-[11px] font-medium ${WEIGHT_STYLES[def.weight]}`}>
      {def.weight}
    </span>
    <span class="ml-auto flex items-center gap-2.5">
      {#if attachedSummary}
        <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-dark">
          {attachedSummary}
        </span>
      {:else}
        <span class="hidden text-[11px] text-gray-300 sm:inline">Add files or paste text</span>
      {/if}
      <svg
        class={`h-4 w-4 flex-none transition-transform ${open ? "rotate-180 text-primary" : "text-gray-300"}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </span>
  </button>

  {#if open}
    <div transition:slide={{ duration: 200 }} class="px-5 pb-4">
      <p class="ml-4 text-xs leading-snug text-gray-500">{def.help}</p>

      <!-- Full-width drop / browse target -->
      <button
        type="button"
        onclick={() => inputEl?.click()}
        class={`mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3.5 text-xs font-medium transition-colors ${
          dragOver
            ? "border-primary bg-primary/10 text-primary-dark"
            : `${def.zone}`
        }`}
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        {dragOver ? "Drop to add" : "Drag files here, or click to browse"}
      </button>

      {#if value.files.length > 0}
        <div class="mt-2.5 flex flex-wrap items-center gap-2">
          {#each value.files as f, i (`${f.name}-${i}`)}
            <span class="inline-flex items-center gap-1.5 rounded-md bg-chrome px-2.5 py-1 text-xs text-gray-700">
              <svg class="h-3.5 w-3.5 flex-none text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75" />
              </svg>
              {f.name}
              <button
                type="button"
                onclick={() => onRemoveFile(i)}
                aria-label={`Remove ${f.name}`}
                class="ml-0.5 text-gray-400 transition-colors hover:text-red-500"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          {/each}
        </div>
      {/if}

      <UnsupportedWarning names={rejected} />

      <!-- Paste-text disclosure -->
      <div class="mt-2.5">
        <button
          type="button"
          onclick={() => (pasteOpen = !pasteOpen)}
          aria-expanded={pasteOpen}
          class={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
            pasteOpen
              ? "bg-primary-wash text-primary-dark"
              : value.text.trim()
                ? "text-primary-dark hover:bg-primary-wash"
                : "text-gray-400 hover:bg-primary-wash hover:text-navy"
          }`}
        >
          {pasteOpen ? "Hide notes" : value.text.trim() ? "Notes ✓" : "Paste text instead"}
          <svg
            class={`h-3 w-3 transition-transform ${pasteOpen ? "rotate-180 text-primary" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {#if pasteOpen}
          <div transition:slide={{ duration: 150 }}>
            <textarea
              value={value.text}
              oninput={(e) => onText(e.currentTarget.value)}
              rows={3}
              placeholder="Paste text, notes, or links"
              class="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-canvas px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            ></textarea>
            {#if value.text.trim()}
              <button
                type="button"
                onclick={() => {
                  onText("");
                  pasteOpen = false;
                }}
                class="mt-1 text-xs font-medium text-gray-400 transition-colors hover:text-red-600"
              >
                Clear notes
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <input
    bind:this={inputEl}
    type="file"
    multiple
    accept={SUPPORTED_ACCEPT}
    class="hidden"
    onchange={(e) => {
      if (e.currentTarget.files) accept(Array.from(e.currentTarget.files));
      e.currentTarget.value = "";
    }}
  />
</div>

<!--
  One context category as a divided ROW (Jul 20 redesign, v2). Grammar:
  [category dot + label + weight | help]  [chips / ghost add target]  [paste].
  The whole row is a drop target; the empty state is a real clickable ghost
  button (browse) instead of inert hint text; paste-notes sits behind a
  disclosure so empty categories stay one line tall.
-->
<script lang="ts">
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

  let inputEl: HTMLInputElement | null = $state(null);
  let dragOver = $state(false);
  let rejected = $state<string[]>([]);
  // Open when the writer already pasted something (e.g. duplicate flow) —
  // deliberately seeded from the initial value only; after that the writer
  // owns the toggle.
  // svelte-ignore state_referenced_locally
  let pasteOpen = $state(Boolean(value.text.trim()));

  // The category's pill classes carry its identity color; the dot reuses the
  // text color via a currentColor circle.
  const dotClass = $derived(def.pill.split(" ").find((c) => c.startsWith("text-")) ?? "text-gray-400");

  function accept(files: File[]) {
    const { ok, rejected: bad } = partitionSupported(files);
    if (ok.length) onAddFiles(ok);
    rejected = bad;
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
  class={`px-4 py-2.5 transition-colors ${dragOver ? "bg-primary/5" : ""}`}
>
  <div class="flex items-center gap-4">
    <!-- Identity column -->
    <div class="w-52 flex-none">
      <span class="flex items-center gap-2">
        <svg class={`h-1.5 w-1.5 flex-none ${dotClass}`} viewBox="0 0 6 6" aria-hidden="true">
          <circle cx="3" cy="3" r="3" fill="currentColor" />
        </svg>
        <span class="truncate text-xs font-medium text-gray-900">{def.label}</span>
        <span class={`flex-none rounded-full px-1.5 py-px text-[10px] font-medium leading-4 ${WEIGHT_STYLES[def.weight]}`}>
          {def.weight}
        </span>
      </span>
      <p class="ml-3.5 mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-400" title={def.help}>
        {def.help}
      </p>
    </div>

    <!-- Files -->
    <div class="min-w-0 flex-1">
      {#if value.files.length > 0}
        <div class="flex flex-wrap items-center gap-1.5">
          {#each value.files as f, i (`${f.name}-${i}`)}
            <span class="inline-flex items-center gap-1 rounded-md bg-chrome px-2 py-0.5 text-[11px] text-gray-600">
              <svg class="h-3 w-3 flex-none text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75" />
              </svg>
              {f.name}
              <button
                type="button"
                onclick={() => onRemoveFile(i)}
                aria-label={`Remove ${f.name}`}
                class="ml-0.5 text-gray-400 transition-colors hover:text-red-500"
              >
                <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          {/each}
          <button
            type="button"
            onclick={() => inputEl?.click()}
            aria-label={`Add more files to ${def.label}`}
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
          >
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add
          </button>
        </div>
      {:else}
        <button
          type="button"
          onclick={() => inputEl?.click()}
          class={`flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-[11px] font-medium transition-colors ${
            dragOver
              ? "border-primary bg-primary/5 text-primary-dark"
              : "border-gray-200 text-gray-400 hover:border-primary/40 hover:bg-primary-wash hover:text-navy"
          }`}
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          {dragOver ? "Drop to add" : "Drop files or browse"}
        </button>
      {/if}

      <UnsupportedWarning names={rejected} />

      {#if pasteOpen}
        <textarea
          value={value.text}
          oninput={(e) => onText(e.currentTarget.value)}
          rows={2}
          placeholder="Paste text, notes, or links"
          class="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-canvas px-2.5 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
        ></textarea>
      {/if}
    </div>

    <!-- Paste toggle -->
    <div class="flex-none">
      <button
        type="button"
        onclick={() => (pasteOpen = !pasteOpen)}
        aria-expanded={pasteOpen}
        class={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
          pasteOpen || value.text.trim()
            ? "text-primary-dark hover:bg-primary-wash"
            : "text-gray-400 hover:bg-primary-wash hover:text-navy"
        }`}
      >
        {value.text.trim() ? "Notes ✓" : "Paste"}
      </button>
    </div>
  </div>

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

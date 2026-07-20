<!--
  Previous-year reports as a STACKED section row (Jul 20 v3) — same grammar
  as CategoryRow: label line on top, then one full-width line per fiscal
  year. Each year line is its own drop target.
-->
<script lang="ts">
  import { SUPPORTED_ACCEPT } from "$lib/parseDocument";
  import type { ContextCategoryDef } from "$lib/contextCategories";
  import { partitionSupported, WEIGHT_STYLES, type PyRow } from "./shared";
  import UnsupportedWarning from "./UnsupportedWarning.svelte";

  let {
    def,
    rows,
    onAddFiles,
    onRemoveFile,
    onUpdateYear,
    onUpdateNote,
    onRemoveYear,
    onAddYear,
  }: {
    def: ContextCategoryDef;
    rows: PyRow[];
    onAddFiles: (id: string, files: File[]) => void;
    onRemoveFile: (id: string, idx: number) => void;
    onUpdateYear: (id: string, year: number) => void;
    onUpdateNote: (id: string, note: string) => void;
    onRemoveYear: (id: string) => void;
    onAddYear: () => void;
  } = $props();

  const minYear = $derived(Math.min(...rows.map((r) => r.year)));
  const dotClass = $derived(def.pill.split(" ").find((c) => c.startsWith("text-")) ?? "text-gray-400");

  let inputFor = $state<string | null>(null);
  let inputEl: HTMLInputElement | null = $state(null);
  let dragOverId = $state<string | null>(null);
  let rejected = $state<string[]>([]);
  // Seeded from the initial rows only (duplicate flow); after that the
  // writer owns each note toggle.
  // svelte-ignore state_referenced_locally
  let noteOpen = $state<Set<string>>(new Set(rows.filter((r) => r.note.trim()).map((r) => r.id)));

  function accept(id: string, files: File[]) {
    const { ok, rejected: bad } = partitionSupported(files);
    if (ok.length) onAddFiles(id, ok);
    rejected = bad;
  }

  function toggleNote(id: string) {
    const next = new Set(noteOpen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    noteOpen = next;
  }

  function pickFiles(id: string) {
    inputFor = id;
    inputEl?.click();
  }
</script>

<div class="px-5 py-4">
  <!-- Label line -->
  <div class="flex flex-wrap items-center gap-2">
    <svg class={`h-2 w-2 flex-none ${dotClass}`} viewBox="0 0 6 6" aria-hidden="true">
      <circle cx="3" cy="3" r="3" fill="currentColor" />
    </svg>
    <span class="text-sm font-medium text-gray-900">{def.label}</span>
    <span class={`flex-none rounded-full px-2 py-0.5 text-[11px] font-medium ${WEIGHT_STYLES[def.weight]}`}>
      {def.weight}
    </span>
    <button
      type="button"
      onclick={onAddYear}
      class="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:bg-primary-wash"
    >
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
      </svg>
      Add FY {minYear - 1}
    </button>
  </div>
  <p class="ml-4 mt-1 text-xs leading-snug text-gray-500">{def.help}</p>

  <!-- Year lines -->
  <div class="ml-4 mt-2.5 flex flex-col gap-2">
    {#each rows as r (r.id)}
      <div
        role="region"
        aria-label={`Files for fiscal ${r.year}`}
        ondragover={(e) => { e.preventDefault(); dragOverId = r.id; }}
        ondragleave={() => (dragOverId = dragOverId === r.id ? null : dragOverId)}
        ondrop={(e) => {
          e.preventDefault();
          dragOverId = null;
          if (e.dataTransfer) accept(r.id, Array.from(e.dataTransfer.files));
        }}
        class={`rounded-lg transition-colors ${dragOverId === r.id ? "bg-primary/5" : ""}`}
      >
        <div class="flex items-center gap-3">
          <label class="flex flex-none items-center gap-1.5">
            <span class="text-[11px] uppercase tracking-wide text-gray-400">FY</span>
            <input
              type="number"
              value={r.year}
              oninput={(e) => onUpdateYear(r.id, parseInt(e.currentTarget.value, 10) || r.year)}
              class="w-20 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-medium text-navy focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </label>
          <div class="min-w-0 flex-1">
            {#if r.files.length > 0}
              <span class="flex flex-wrap items-center gap-2">
                {#each r.files as f, i (`${f.name}-${i}`)}
                  <span class="inline-flex items-center gap-1.5 rounded-md bg-chrome px-2.5 py-1 text-xs text-gray-700">
                    <svg class="h-3.5 w-3.5 flex-none text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75" />
                    </svg>
                    {f.name}
                    <button
                      type="button"
                      onclick={() => onRemoveFile(r.id, i)}
                      aria-label={`Remove ${f.name}`}
                      class="ml-0.5 text-gray-400 transition-colors hover:text-red-500"
                    >
                      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                {/each}
                <button
                  type="button"
                  onclick={() => pickFiles(r.id)}
                  aria-label={`Add more files for fiscal ${r.year}`}
                  class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
                >
                  <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add more
                </button>
              </span>
            {:else}
              <button
                type="button"
                onclick={() => pickFiles(r.id)}
                class={`flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-xs font-medium transition-colors ${
                  dragOverId === r.id
                    ? "border-primary bg-primary/5 text-primary-dark"
                    : "border-gray-200 text-gray-400 hover:border-primary/40 hover:bg-primary-wash hover:text-navy"
                }`}
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                {dragOverId === r.id ? "Drop to add" : `Drag the FY ${r.year} PD here, or click to browse`}
              </button>
            {/if}
          </div>
          <span class="flex flex-none items-center gap-1">
            <button
              type="button"
              onclick={() => toggleNote(r.id)}
              aria-expanded={noteOpen.has(r.id)}
              class={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                r.note.trim()
                  ? "text-primary-dark hover:bg-primary-wash"
                  : "text-gray-400 hover:bg-primary-wash hover:text-navy"
              }`}
            >
              {r.note.trim() ? "Note ✓" : "Note"}
            </button>
            {#if rows.length > 1}
              <button
                type="button"
                onclick={() => onRemoveYear(r.id)}
                title="Remove this year"
                aria-label="Remove this year"
                class="rounded-md p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            {/if}
          </span>
        </div>
        {#if noteOpen.has(r.id)}
          <textarea
            value={r.note}
            oninput={(e) => onUpdateNote(r.id, e.currentTarget.value)}
            rows={2}
            placeholder="Optional note for this year (e.g. “covers two projects — focus on the membrane work”)"
            class="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-canvas px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          ></textarea>
        {/if}
      </div>
    {/each}
  </div>

  <UnsupportedWarning names={rejected} />

  <input
    bind:this={inputEl}
    type="file"
    multiple
    accept={SUPPORTED_ACCEPT}
    class="hidden"
    onchange={(e) => {
      if (e.currentTarget.files && inputFor) accept(inputFor, Array.from(e.currentTarget.files));
      e.currentTarget.value = "";
    }}
  />
</div>

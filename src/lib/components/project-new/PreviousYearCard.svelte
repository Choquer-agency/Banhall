<script lang="ts">
  import type { ContextCategoryDef } from "$lib/contextCategories";
  import { WEIGHT_STYLES, type PyRow } from "./shared";
  import YearRow from "./YearRow.svelte";

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
</script>

<div class="card p-4">
  <div class="flex items-center gap-2">
    <span class="text-sm font-medium text-gray-900">{def.label}</span>
    <span class={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${WEIGHT_STYLES[def.weight]}`}>
      {def.weight}
    </span>
  </div>
  <p class="mt-0.5 text-xs text-gray-500">{def.help}</p>

  <div class="mt-3 flex flex-col gap-2.5">
    {#each rows as r (r.id)}
      <YearRow
        year={r.year}
        note={r.note}
        files={r.files}
        canRemove={rows.length > 1}
        onAddFiles={(fs) => onAddFiles(r.id, fs)}
        onRemoveFile={(i) => onRemoveFile(r.id, i)}
        onUpdateYear={(y) => onUpdateYear(r.id, y)}
        onUpdateNote={(n) => onUpdateNote(r.id, n)}
        onRemoveYear={() => onRemoveYear(r.id)}
      />
    {/each}
  </div>

  <button
    type="button"
    onclick={onAddYear}
    class="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-primary/50 hover:text-navy"
  >
    <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
    </svg>
    Add {minYear - 1}
  </button>
</div>

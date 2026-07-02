<script lang="ts">
  import { SUPPORTED_ACCEPT } from "$lib/parseDocument";
  import { partitionSupported } from "./shared";
  import UnsupportedWarning from "./UnsupportedWarning.svelte";

  let {
    year,
    note,
    files,
    canRemove,
    onAddFiles,
    onRemoveFile,
    onUpdateYear,
    onUpdateNote,
    onRemoveYear,
  }: {
    year: number;
    note: string;
    files: File[];
    canRemove: boolean;
    onAddFiles: (files: File[]) => void;
    onRemoveFile: (idx: number) => void;
    onUpdateYear: (year: number) => void;
    onUpdateNote: (note: string) => void;
    onRemoveYear: () => void;
  } = $props();

  let inputEl: HTMLInputElement | null = $state(null);
  let dragOver = $state(false);
  let rejected = $state<string[]>([]);

  function accept(incoming: File[]) {
    const { ok, rejected: bad } = partitionSupported(incoming);
    if (ok.length) onAddFiles(ok);
    rejected = bad;
  }
</script>

<div class="rounded-lg border border-gray-100 bg-canvas p-3">
  <!-- Editable year + actions -->
  <div class="flex items-center justify-between gap-2">
    <label class="flex items-center gap-2">
      <span class="text-xs text-gray-400">Fiscal year</span>
      <input
        type="number"
        value={year}
        oninput={(e) => onUpdateYear(parseInt(e.currentTarget.value, 10) || year)}
        class="w-[5.5rem] rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-semibold text-navy focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
      />
    </label>
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => inputEl?.click()}
        class="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-navy transition-colors hover:bg-primary-wash"
      >
        Add files
      </button>
      {#if canRemove}
        <button
          type="button"
          onclick={onRemoveYear}
          title="Remove this year"
          aria-label="Remove this year"
          class="rounded-md p-1 text-gray-300 transition-colors hover:bg-primary-wash hover:text-gray-500"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}
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

  <!-- Drop zone — consistent with the other context categories -->
  <div
    role="region"
    aria-label={`Drop files for fiscal ${year}`}
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={(e) => {
      e.preventDefault();
      dragOver = false;
      if (e.dataTransfer) accept(Array.from(e.dataTransfer.files));
    }}
    class={`mt-2 rounded-lg border border-dashed px-3 py-3.5 text-center text-xs transition-colors ${
      dragOver
        ? "border-primary bg-primary/5 text-primary-dark"
        : "border-gray-200 text-gray-400"
    }`}
  >
    Drag files here, or use “Add files”
  </div>

  <UnsupportedWarning names={rejected} />

  <!-- Staged files -->
  {#if files.length > 0}
    <div class="mt-2 flex flex-wrap gap-1.5">
      {#each files as f, i (`${f.name}-${i}`)}
        <span class="inline-flex items-center gap-1 rounded-md bg-chrome px-2 py-1 text-[11px] text-gray-600">
          {f.name}
          <button
            type="button"
            onclick={() => onRemoveFile(i)}
            aria-label={`Remove ${f.name}`}
            class="ml-0.5 text-gray-400 hover:text-gray-600"
          >
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <!-- Optional per-year note -->
  <textarea
    value={note}
    oninput={(e) => onUpdateNote(e.currentTarget.value)}
    rows={2}
    placeholder="Optional note for this year (e.g. “covers two projects — focus on the membrane work”)"
    class="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
  ></textarea>
</div>

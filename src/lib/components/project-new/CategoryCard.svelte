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

  function accept(files: File[]) {
    const { ok, rejected: bad } = partitionSupported(files);
    if (ok.length) onAddFiles(ok);
    rejected = bad;
  }
</script>

<div class="card p-4">
  <div class="flex items-start justify-between gap-3">
    <div>
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-gray-900">{def.label}</span>
        <span class={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${WEIGHT_STYLES[def.weight]}`}>
          {def.weight}
        </span>
      </div>
      <p class="mt-0.5 text-xs text-gray-500">{def.help}</p>
    </div>
    <button
      type="button"
      onclick={() => inputEl?.click()}
      class="flex-shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:bg-primary-wash"
    >
      Add files
    </button>
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

  <!-- Drop zone (only when empty, for a lighter look) -->
  <div
    role="region"
    aria-label={`Drop files for ${def.label}`}
    ondragover={(e) => { e.preventDefault(); dragOver = true; }}
    ondragleave={() => (dragOver = false)}
    ondrop={(e) => {
      e.preventDefault();
      dragOver = false;
      if (e.dataTransfer) accept(Array.from(e.dataTransfer.files));
    }}
    class={`mt-3 rounded-lg border border-dashed px-3 py-3.5 text-center text-xs transition-colors ${
      dragOver ? "border-primary bg-primary/5 text-primary-dark" : "border-gray-200 text-gray-400"
    }`}
  >
    Drag files here, or use “Add files”
  </div>

  <UnsupportedWarning names={rejected} />

  <!-- Staged files -->
  {#if value.files.length > 0}
    <div class="mt-2 flex flex-wrap gap-1.5">
      {#each value.files as f, i (`${f.name}-${i}`)}
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

  <!-- Paste text -->
  <textarea
    value={value.text}
    oninput={(e) => onText(e.currentTarget.value)}
    rows={2}
    placeholder="…or paste text / notes / links here"
    class="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-canvas px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
  ></textarea>
</div>

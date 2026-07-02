<script lang="ts">
  /** BNH-23: inline view/edit for a short text field (used for the two titles). */
  let {
    value,
    placeholder,
    onSave,
  }: {
    value: string;
    placeholder: string;
    onSave: (v: string) => Promise<void> | void;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let saving = $state(false);
  let inputEl: HTMLInputElement | null = $state(null);

  // Focus the field when it appears (replaces React's autoFocus).
  $effect(() => {
    if (editing) inputEl?.focus();
  });

  async function save() {
    saving = true;
    try {
      await onSave(draft);
      editing = false;
    } finally {
      saving = false;
    }
  }
</script>

{#if editing}
  <div class="mt-0.5 flex items-center gap-1.5">
    <input
      bind:this={inputEl}
      bind:value={draft}
      class="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
    />
    <button
      onclick={save}
      disabled={saving}
      class="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
    >
      {saving ? "…" : "Save"}
    </button>
    <button
      onclick={() => (editing = false)}
      class="rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-primary-wash"
    >
      Cancel
    </button>
  </div>
{:else}
  <p class="group mt-0.5 inline-flex items-center gap-1.5 text-gray-700">
    {#if value}
      {value}
    {:else}
      <span class="italic text-gray-400">{placeholder}</span>
    {/if}
    <button
      onclick={() => {
        draft = value;
        editing = true;
      }}
      title="Edit"
      class="text-gray-300 transition-colors hover:text-navy"
    >
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  </p>
{/if}

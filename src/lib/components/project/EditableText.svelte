<script lang="ts">
  type Variant = "body" | "heading";

  let {
    value,
    placeholder,
    onSave,
    variant = "body",
    label = "field",
    required = false,
  }: {
    value: string;
    placeholder: string;
    onSave: (v: string) => Promise<void> | void;
    variant?: Variant;
    label?: string;
    required?: boolean;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let saving = $state(false);
  let saveError = $state("");
  let inputEl: HTMLInputElement | null = $state(null);
  const canSave = $derived(!saving && (!required || draft.trim().length > 0));

  $effect(() => {
    if (editing) inputEl?.focus();
  });

  function beginEdit() {
    draft = value;
    saveError = "";
    editing = true;
  }

  function cancel() {
    draft = value;
    saveError = "";
    editing = false;
  }

  async function save() {
    if (!canSave) return;
    saving = true;
    saveError = "";
    try {
      await onSave(draft);
      editing = false;
    } catch {
      saveError = "Couldn’t save. Try again.";
    } finally {
      saving = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }
</script>

{#if editing}
  <div class={`flex items-center gap-1.5 ${variant === "body" ? "mt-1" : ""}`}>
    <input
      bind:this={inputEl}
      bind:value={draft}
      onkeydown={handleKeydown}
      aria-label={`Edit ${label}`}
      {required}
      class={`min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-900 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy ${
        variant === "heading" ? "text-display" : "text-sm"
      }`}
    />
    <button
      type="button"
      onclick={() => void save()}
      disabled={!canSave}
      aria-label={`Save ${label}`}
      class="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50"
    >
      {saving ? "Saving…" : "Save"}
    </button>
    <button
      type="button"
      onclick={cancel}
      disabled={saving}
      aria-label={`Cancel editing ${label}`}
      class="rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50"
    >
      Cancel
    </button>
  </div>
  {#if saveError}
    <p class="mt-1 text-xs text-red-600" role="alert">{saveError}</p>
  {/if}
{:else if variant === "heading"}
  <h1 class="text-display">
    <button
      type="button"
      onclick={beginEdit}
      aria-label={`Edit ${label}`}
      class="group -ml-1 inline-flex max-w-full items-center gap-2 rounded-md px-1 text-left transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
    >
      <span class="min-w-0 break-words">{value || placeholder}</span>
      <svg
        aria-hidden="true"
        class="h-4 w-4 flex-none text-gray-300 transition-colors group-hover:text-primary"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  </h1>
{:else}
  <p class="group mt-1 flex w-fit items-center gap-1.5 text-gray-800">
    {#if value}
      {value}
    {:else}
      <span class="italic text-gray-400">{placeholder}</span>
    {/if}
    <button
      type="button"
      onclick={beginEdit}
      aria-label={`Edit ${label}`}
      class="text-gray-300 transition-colors hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
    >
      <svg aria-hidden="true" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  </p>
{/if}

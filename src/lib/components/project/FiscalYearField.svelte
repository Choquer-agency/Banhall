<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import { PencilSimpleIcon, PlusIcon } from "phosphor-svelte";

  function toDateInput(ts: number | null): string {
    if (!ts) return "";
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  /** BNH-36: view/edit the client's fiscal year-end on the project header. */
  let {
    projectId,
    fiscalYearEnd,
  }: {
    projectId: Id<"projects">;
    fiscalYearEnd: number | null;
  } = $props();

  const update = useMutation(api.projects.updateProjectFiscalYear);
  let editing = $state(false);
  let value = $state("");
  let saving = $state(false);

  async function save() {
    saving = true;
    try {
      await update({
        projectId,
        fiscalYearEnd: value ? new Date(`${value}T00:00:00`).getTime() : undefined,
      });
      editing = false;
    } finally {
      saving = false;
    }
  }
</script>

{#if editing}
  <div
    data-fiscal-year-editor
    class="grid w-full min-w-0 grid-cols-2 gap-1.5 @sm:grid-cols-[minmax(8rem,11rem)_auto_auto] @sm:items-center"
  >
    <div data-fiscal-year-picker class="col-span-2 min-w-0 @sm:col-span-1">
      <DatePicker bind:value size="sm" placeholder="Fiscal year-end" />
    </div>
    <button
      type="button"
      onclick={save}
      disabled={saving}
      class="min-h-8 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-50 pointer-coarse:min-h-11"
    >
      {saving ? "…" : "Save"}
    </button>
    <button
      type="button"
      onclick={() => (editing = false)}
      class="min-h-8 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir pointer-coarse:min-h-11"
    >
      Cancel
    </button>
  </div>
{:else if !fiscalYearEnd}
  <button
    type="button"
    onclick={() => {
      value = "";
      editing = true;
    }}
    class="inline-flex min-h-7 max-w-full items-center gap-1 text-left text-xs font-medium leading-4 text-primary transition-colors hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir pointer-coarse:min-h-11"
  >
    <PlusIcon size={13} weight="regular" aria-hidden="true" class="shrink-0" />
    Set fiscal year-end
  </button>
{:else}
  {@const d = new Date(fiscalYearEnd)}
  <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-5 text-gray-800">
    <span>{d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
    <span class="text-[0.6875rem] text-gray-400">(Fiscal {d.getFullYear()})</span>
    <button
      type="button"
      onclick={() => {
        value = toDateInput(fiscalYearEnd);
        editing = true;
      }}
      aria-label="Edit fiscal year-end"
      class="flex size-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir pointer-coarse:size-11"
    >
      <PencilSimpleIcon size={14} weight="regular" aria-hidden="true" />
    </button>
  </div>
{/if}

<style>
  @media (pointer: coarse) {
    :global([data-fiscal-year-picker] > button) {
      min-height: 2.75rem;
    }
  }
</style>

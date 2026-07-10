<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";

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
  <div class="mt-1 flex flex-wrap items-center gap-1.5">
    <div class="w-44">
      <DatePicker bind:value size="sm" placeholder="Fiscal year-end" />
    </div>
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
{:else if !fiscalYearEnd}
  <button
    onclick={() => {
      value = "";
      editing = true;
    }}
    class="mt-1 flex w-fit items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary-dark"
  >
    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
    </svg>
    Set fiscal year-end
  </button>
{:else}
  {@const d = new Date(fiscalYearEnd)}
  <p class="mt-1 flex w-fit items-center gap-1.5 text-gray-800">
    {d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
    <span class="text-xs text-gray-400">(Fiscal {d.getFullYear()})</span>
    <button
      onclick={() => {
        value = toDateInput(fiscalYearEnd);
        editing = true;
      }}
      title="Edit fiscal year-end"
      class="text-gray-300 transition-colors hover:text-navy"
    >
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  </p>
{/if}

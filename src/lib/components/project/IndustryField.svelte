<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import { industryLabel } from "$lib/industries";

  /**
   * BNH-10: industry scopes Brain retrieval to same-industry exemplars. Optional —
   * the Brain still helps without it (best PDs across all industries).
   */
  let {
    projectId,
    industry,
    canCreate = false,
    readonly = false,
  }: {
    projectId: Id<"projects">;
    industry: string | null;
    canCreate?: boolean;
    /**
     * 2026-09-15 metadata gate: a viewer outside the project's edit scope
     * sees the value as plain text and can never reach the mutation.
     */
    readonly?: boolean;
  } = $props();

  const update = useMutation(api.projects.updateProjectIndustry);
  let saving = $state(false);

  async function save(value: string) {
    if (readonly) return;
    saving = true;
    try {
      await update({ projectId, industry: value || undefined });
    } finally {
      saving = false;
    }
  }
</script>

<div>
  {#if readonly}
    {#if industry}
      <p class="min-w-0 truncate text-gray-800">{industryLabel(industry)}</p>
    {:else}
      <p class="italic text-gray-400">Not set</p>
    {/if}
  {:else}
    <IndustrySelect
      value={industry ?? ""}
      size="sm"
      disabled={saving}
      {canCreate}
      class="max-w-[220px]"
      onValueChange={save}
    />
  {/if}
</div>

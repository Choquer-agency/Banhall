<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";

  /**
   * BNH-10: industry scopes Brain retrieval to same-industry exemplars. Optional —
   * the Brain still helps without it (best PDs across all industries).
   */
  let {
    projectId,
    industry,
    canCreate = false,
  }: {
    projectId: Id<"projects">;
    industry: string | null;
    canCreate?: boolean;
  } = $props();

  const update = useMutation(api.projects.updateProjectIndustry);
  let saving = $state(false);

  async function save(value: string) {
    saving = true;
    try {
      await update({ projectId, industry: value || undefined });
    } finally {
      saving = false;
    }
  }
</script>

<div class="mt-1">
  <IndustrySelect
    value={industry ?? ""}
    size="sm"
    disabled={saving}
    {canCreate}
    class="max-w-[220px]"
    onValueChange={save}
  />
</div>

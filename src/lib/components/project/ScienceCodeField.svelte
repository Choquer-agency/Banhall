<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { CRA_SCIENCE_CODE_ITEMS } from "../../../../shared/craScienceCodes";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";

  let {
    projectId,
    scienceCode,
  }: {
    projectId: Id<"projects">;
    scienceCode: string | null;
  } = $props();

  const update = useMutation(api.projects.updateProjectScienceCode);
  let saving = $state(false);

  async function save(value: string) {
    saving = true;
    try {
      await update({ projectId, scienceCode: value || undefined });
    } finally {
      saving = false;
    }
  }
</script>

<div class="mt-1">
  <SelectInput
    value={scienceCode ?? ""}
    items={CRA_SCIENCE_CODE_ITEMS}
    size="sm"
    placeholder="Not set"
    disabled={saving}
    class="max-w-[300px]"
    onValueChange={save}
  />
</div>

<script lang="ts">
  import { useConvexClient, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { CRA_SCIENCE_CODE_ITEMS } from "../../../../shared/craScienceCodes";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import Button from "$lib/components/ui/Button.svelte";

  let {
    projectId,
    scienceCode,
  }: {
    projectId: Id<"projects">;
    scienceCode: string | null;
  } = $props();

  const convex = useConvexClient();
  const update = useMutation(api.projects.updateProjectScienceCode);
  let saving = $state(false);
  let suggesting = $state(false);
  let suggestionMessage = $state("");

  async function save(value: string) {
    saving = true;
    try {
      await update({ projectId, scienceCode: value || undefined });
    } finally {
      saving = false;
    }
  }

  async function suggest() {
    suggesting = true;
    suggestionMessage = "";
    try {
      const result = await convex.action(api.scienceCodeSuggestions.suggest, {
        projectId,
      });
      if (!result) {
        suggestionMessage = "No suggestion available.";
        return;
      }
      await save(result.code);
      suggestionMessage = `Suggested ${result.label}`;
    } catch {
      suggestionMessage = "Could not suggest a science code.";
    } finally {
      suggesting = false;
    }
  }
</script>

<div class="mt-1">
  <div class="flex flex-wrap items-center gap-2">
    <SelectInput
      value={scienceCode ?? ""}
      items={CRA_SCIENCE_CODE_ITEMS}
      size="sm"
      placeholder="Not set"
      disabled={saving || suggesting}
      class="min-w-0 max-w-[300px] flex-1"
      onValueChange={save}
    />
    <Button
      type="button"
      variant="link"
      class="shrink-0 gap-1.5 text-xs"
      disabled={saving || suggesting}
      onclick={suggest}
    >
      <svg aria-hidden="true" class="h-3.5 w-3.5 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 3l1.15 3.35a5 5 0 003.15 3.15l3.35 1.15-3.35 1.15a5 5 0 00-3.15 3.15L12 18.3l-1.15-3.35a5 5 0 00-3.15-3.15l-3.35-1.15L7.7 9.5a5 5 0 003.15-3.15L12 3z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M18.5 3.5v3M20 5h-3M5.5 17.5v3M7 19H4" />
      </svg>
      {suggesting ? "AI suggesting…" : "AI Suggests"}
    </Button>
  </div>
  {#if suggestionMessage}
    <p class="mt-1.5 text-xs text-gray-500" aria-live="polite">
      {suggestionMessage}
    </p>
  {/if}
</div>

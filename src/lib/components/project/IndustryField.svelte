<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  // Must match The Brain's industry namespace strings — see docs/the-brain.md.
  const INDUSTRIES = ["software", "manufacturing", "life-sciences"] as const;
  const INDUSTRY_LABELS: Record<string, string> = {
    software: "Software",
    manufacturing: "Manufacturing",
    "life-sciences": "Life sciences",
  };

  /**
   * BNH-10: industry scopes Brain retrieval to same-industry exemplars. Optional —
   * the Brain still helps without it (best PDs across all industries).
   */
  let {
    projectId,
    industry,
  }: {
    projectId: Id<"projects">;
    industry: string | null;
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

<div class="mt-0.5">
  <select
    value={industry ?? ""}
    onchange={(e) => save(e.currentTarget.value)}
    disabled={saving}
    class={`w-full max-w-[180px] cursor-pointer rounded-md border bg-white px-2 py-1 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy disabled:opacity-50 ${
      industry ? "border-gray-200 text-gray-900" : "border-dashed border-gray-300 text-gray-400"
    }`}
  >
    <option value="">Not set (all industries)</option>
    {#each INDUSTRIES as i (i)}
      <option value={i}>{INDUSTRY_LABELS[i]}</option>
    {/each}
  </select>
</div>

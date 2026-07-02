<script lang="ts">
  import { Select } from "bits-ui";
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

  // "" = unset, mirroring the old native <select> empty option.
  const ITEMS = [
    { value: "", label: "Not set (all industries)" },
    ...INDUSTRIES.map((i) => ({ value: i as string, label: INDUSTRY_LABELS[i] })),
  ];

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

<div class="mt-1">
  <Select.Root
    type="single"
    value={industry ?? ""}
    onValueChange={save}
    disabled={saving}
    items={ITEMS}
  >
    <Select.Trigger
      class={`flex w-full max-w-[180px] cursor-pointer items-center justify-between gap-1 rounded-md border bg-white px-2 py-1 text-left text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy disabled:opacity-50 ${
        industry ? "border-gray-200 text-gray-900" : "border-dashed border-gray-300 text-gray-400"
      }`}
    >
      <span class="truncate">
        {industry ? (INDUSTRY_LABELS[industry] ?? industry) : "Not set (all industries)"}
      </span>
      <svg
        class="h-3 w-3 flex-shrink-0 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content
        sideOffset={4}
        class="z-50 max-h-60 w-[var(--bits-select-anchor-width)] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
      >
        {#each ITEMS as item (item.value)}
          <Select.Item
            value={item.value}
            label={item.label}
            class={`cursor-pointer px-2 py-1 text-sm data-highlighted:bg-gray-100 data-selected:font-medium ${
              item.value ? "text-gray-900" : "text-gray-500"
            }`}
          >
            {item.label}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Portal>
  </Select.Root>
</div>

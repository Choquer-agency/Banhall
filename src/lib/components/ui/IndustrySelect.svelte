<!--
  BNH-10 shared industry select. One source of truth for industry options
  everywhere (project creation, project page, dashboard filter): the base Brain
  namespaces plus every custom industry already saved on a project.

  variant "picker"  — for setting a project's industry ("" = not set); typing a
                      new value offers an "Add …" row (creatable).
  variant "filter"  — for filtering lists ("all" = no filter); not creatable.

  Values are kebab-case slugs (must match the Brain namespace strings —
  docs/the-brain.md); labels are the humanized form.
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../convex/_generated/api";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import { BASE_INDUSTRIES, industryLabel, industrySlug } from "$lib/industries";

  let {
    value = $bindable(""),
    variant = "picker",
    id,
    size = "md",
    disabled = false,
    class: className = "",
    onValueChange,
  }: {
    value?: string;
    variant?: "picker" | "filter";
    id?: string;
    size?: "md" | "sm";
    disabled?: boolean;
    class?: string;
    onValueChange?: (value: string) => void;
  } = $props();

  const auth = useAuth();
  // Distinct industries already saved on projects, so ad-hoc ones typed by one
  // writer become options for everyone.
  const industriesQ = useQuery(api.projects.listIndustries, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  let sessionIndustries = $state<string[]>([]);

  const customIndustries = $derived(
    [...new Set([...(industriesQ.data ?? []), ...sessionIndustries])]
      .filter((slug) => !BASE_INDUSTRIES.some((b) => b.value === slug))
      .sort()
  );

  // Same option list for both variants (base + custom industries); only the
  // "no selection" sentinel differs: "" for pickers, "all" for filters.
  const items = $derived([
    {
      value: variant === "picker" ? "" : "all",
      label: "Not set (all industries)",
    },
    ...BASE_INDUSTRIES,
    ...customIndustries.map((slug) => ({ value: slug, label: industryLabel(slug) })),
  ]);

  function addIndustry(label: string) {
    const slug = industrySlug(label);
    if (!slug) return;
    if (!sessionIndustries.includes(slug)) sessionIndustries = [...sessionIndustries, slug];
    value = slug;
    onValueChange?.(slug);
  }
</script>

<SelectInput
  {id}
  {size}
  {disabled}
  bind:value
  {items}
  class={className}
  placeholder="Not set (all industries)"
  {onValueChange}
  onCreate={variant === "picker" ? addIndustry : undefined}
/>

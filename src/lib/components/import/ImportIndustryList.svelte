<!--
  The industry picker's list for a new company on the Import sheet
  (2026-11-12, Paper Files 1 "Pick an industry"): the app's one industry
  list, as every industry picker has it (IndustrySelect): the base
  industries (shared/industries.ts) and the ones projects already use
  (projects.listIndustries), then 'Add "..."' for a typed one, which admins
  may add as on New company. Values are slugs, as clients.industry stores
  them. Mount it inside the popover.
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { BASE_INDUSTRIES, BASE_INDUSTRY_SLUGS, industryLabel, industrySlug } from "$lib/industries";
  import ImportNameList from "./ImportNameList.svelte";

  let {
    current = null,
    onPick,
  }: {
    /** The industry picked now, as its slug. */
    current?: string | null;
    onPick: (slug: string) => void;
  } = $props();

  const industriesQ = useQuery(api.projects.listIndustries, () => ({}));
  const options = $derived.by(() => {
    const custom = [...new Set([...(industriesQ.data ?? []), ...(current ? [current] : [])])]
      .filter((slug) => !BASE_INDUSTRY_SLUGS.has(slug))
      .sort();
    return [
      ...BASE_INDUSTRIES.map((entry) => ({ value: entry.value as string, label: entry.label as string })),
      ...custom.map((slug) => ({ value: slug, label: industryLabel(slug) })),
    ];
  });
  const known = $derived(new Set(options.map((option) => option.value)));
</script>

<ImportNameList
  label="Industry"
  placeholder="Find or type an industry"
  {options}
  {current}
  loading={industriesQ.data === undefined && !industriesQ.error}
  hint="Type an industry."
  newText={(typed) => `Add "${typed}"`}
  canOfferNew={null}
  refuseTyped={(typed) => (industrySlug(typed) ? null : "Type an industry with letters or numbers.")}
  onPick={(value) => onPick(known.has(value) ? value : industrySlug(value))}
/>

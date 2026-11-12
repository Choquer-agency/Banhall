<!--
  The company picker's list (board ao5, "Move to another company"): the
  companies already on the To review sheet whose name has the words typed
  (sheetSearch, from two characters, once typing settles), then 'New company
  "..."' for a name that is not there. Mount it inside the popover.

  "New company" is offered only once the search for exactly the text typed
  has answered, and never when a company it found has the typed name's key
  (other capitals, spaces or accents), so Enter cannot pick a new spelling
  of a company that exists. The server stores an existing company's own
  spelling anyway (ingestion.setSheetLabels).
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { dashboardCompanyKey } from "../../../../shared/dashboardProjection";
  import ImportNameList from "./ImportNameList.svelte";
  import { bandName, searchText } from "./importFormat";

  let {
    current = null,
    onPick,
  }: {
    /** The company the files are in now, by name. */
    current?: string | null;
    onPick: (name: string) => void;
  } = $props();

  let query = $state("");
  let settled = $state<string | null>(null);
  $effect(() => {
    const next = searchText(query);
    if (next === null) {
      settled = null;
      return;
    }
    if (next === untrack(() => settled)) return;
    const timer = setTimeout(() => (settled = next), 200);
    return () => clearTimeout(timer);
  });

  const searchQ = useQuery(api.ingestion.sheetSearch, () => (settled === null ? "skip" : { tab: "review" as const, text: settled }));
  const companies = $derived(settled === null ? [] : (searchQ.data?.companies ?? []));
  const options = $derived(companies.map((company) => ({ value: bandName(company), label: bandName(company) })));
  /** The search for exactly what is typed has answered, and found no company with its key. */
  const canOfferNew = $derived.by(() => {
    const typed = searchText(query);
    if (typed === null || settled !== typed || searchQ.data === undefined || searchQ.data === null) return false;
    const key = dashboardCompanyKey(typed);
    return !companies.some((company) => company.companyKey === key);
  });
</script>

<ImportNameList
  label="Company"
  placeholder="Find or type a company"
  {options}
  {current}
  bind:query
  filter={false}
  loading={settled !== null && searchQ.data === undefined}
  hint="Type at least two letters of a company name."
  newText={(typed) => `New company "${typed}"`}
  {canOfferNew}
  {onPick}
/>

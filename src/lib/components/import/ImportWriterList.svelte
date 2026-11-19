<!--
  The writer picker's list (board ao5): the firm's people from the team
  roster (users.listTeam, the bounded roster the app's people pickers read),
  then 'Use "..."' for a writer who is not on it. Read only while a picker is
  open: mount it inside the popover.

  Only real names are offered (phase 3b fixes): the roster's label falls
  back to an email address or "Unknown team member" for a person with no
  name, and neither is a writer. A typed email address is refused in words
  (the server refuses it too, labelPatchFields).
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { looksLikeEmail, rosterWriterName } from "../../../../shared/importSheetRules";
  import ImportNameList from "./ImportNameList.svelte";

  let {
    current = null,
    onPick,
  }: {
    current?: string | null;
    onPick: (name: string) => void;
  } = $props();

  const teamQ = useQuery(api.users.listTeam, () => ({}));
  // One entry per name: two people listed under one name would be one writer here.
  const options = $derived.by(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const person of teamQ.data ?? []) {
      const name = rosterWriterName(person);
      if (name === null || seen.has(name)) continue;
      seen.add(name);
      out.push({ value: name, label: name });
    }
    return out;
  });
</script>

<ImportNameList
  label="Writer"
  placeholder="Find or type a writer"
  {options}
  {current}
  loading={teamQ.data === undefined && !teamQ.error}
  hint="Type the writer's name."
  newText={(typed) => `Use "${typed}"`}
  refuseTyped={(typed) => (looksLikeEmail(typed) ? "Type the writer's name, not an email address." : null)}
  {onPick}
/>

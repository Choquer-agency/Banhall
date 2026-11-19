<!--
  The PD number picker's list (Greptile fix, 2026-11-17), in the look of the
  writer and company lists: a search field, PD 1 to PD 20, a check on the
  file's own number, then 'Use "PD 12a"' for a number with a letter. A
  typed number is checked by the server's own rule (shared/importSheetRules
  normalizePdNumber): "04" is PD 4, "PD 7" is PD 7, and anything that is not
  1 to 20 with an optional letter is refused in the server's words. The body
  of a popover: mount it when the popover opens.
-->
<script lang="ts">
  import { MAX_PD_NUMBER, normalizePdNumber, PD_NUMBER_RULE } from "../../../../shared/importSheetRules";
  import ImportNameList from "./ImportNameList.svelte";

  let {
    current = null,
    onPick,
  }: {
    /** The file's PD number now, or null for one whose name gave none. */
    current?: string | null;
    /** The number to save, as it is stored ("4", "12a"). */
    onPick: (pdNumber: string) => void;
  } = $props();

  const NUMBERS = Array.from({ length: MAX_PD_NUMBER }, (_, index) => String(index + 1));
  let query = $state("");

  /** A typed number as stored, "PD 7" read as 7; null when it is not one. */
  const numberOf = (typed: string) => normalizePdNumber(typed.trim().replace(/^pd\s*/i, ""));
  const fold = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

  const all = $derived(
    (current && !NUMBERS.includes(current) ? [current, ...NUMBERS] : NUMBERS).map((value) => ({ value, label: `PD ${value}` }))
  );
  const typed = $derived(query.trim());
  const typedNumber = $derived(typed ? numberOf(typed) : null);
  const options = $derived(
    typed ? all.filter((option) => option.value === typedNumber || fold(option.label).includes(fold(typed))) : all
  );
</script>

<ImportNameList
  label="PD number"
  placeholder="Find or type a PD number"
  bind:query
  {options}
  {current}
  filter={false}
  canOfferNew={typedNumber !== null && !all.some((option) => option.value === typedNumber)}
  refuseTyped={() => (typedNumber === null && options.length === 0 ? PD_NUMBER_RULE : null)}
  hint="Type a PD number, for example 4 or 12a."
  newText={(text) => `Use "PD ${numberOf(text) ?? text}"`}
  onPick={(value) => onPick(numberOf(value) ?? value)}
/>

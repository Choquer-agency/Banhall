<script lang="ts">
  /**
   * A company's usual fiscal year end, a month and a day with no year
   * (February 29 allowed), as two selects that may both be "Not set". Shared
   * by New company and Edit company (2026-10-28). A day past the chosen
   * month's end moves to its last day.
   */
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import { formSelect } from "$lib/components/ui/formDialog";
  import { DAYS_IN_MONTH, MONTH_NAMES } from "$lib/companies/companies";

  let {
    month = $bindable(""),
    day = $bindable(""),
    idPrefix,
    labelId,
    ariaPrefix,
    onValueChange = undefined,
  }: {
    /** "1" to "12", or "" for not set. */
    month?: string;
    /** "1" to "31", or "" for not set. */
    day?: string;
    /** Ids of the two selects: `${idPrefix}-month` and `${idPrefix}-day`. */
    idPrefix: string;
    /** The visible label's id, for the group's name. */
    labelId: string;
    /** The selects' names: "<ariaPrefix> month", "<ariaPrefix> day". */
    ariaPrefix: string;
    onValueChange?: () => void;
  } = $props();

  const MONTH_ITEMS = [{ value: "", label: "Not set" }, ...MONTH_NAMES.map((label, index) => ({ value: String(index + 1), label }))];

  const dayItems = $derived([
    { value: "", label: "Not set" },
    ...Array.from({ length: month ? DAYS_IN_MONTH[Number(month) - 1] : 31 }, (_, index) => ({
      value: String(index + 1),
      label: String(index + 1),
    })),
  ]);

  $effect(() => {
    if (!month || !day) return;
    const last = DAYS_IN_MONTH[Number(month) - 1];
    if (Number(day) > last) day = String(last);
  });
</script>

<div class="flex gap-2" role="group" aria-labelledby={labelId} data-filled={month && day ? "" : undefined}>
  <SelectInput
    id={`${idPrefix}-month`}
    bind:value={month}
    items={MONTH_ITEMS}
    placeholder="Month"
    ariaLabel={`${ariaPrefix} month`}
    class={`min-w-0 flex-1 ${formSelect}`}
    {onValueChange}
  />
  <SelectInput
    id={`${idPrefix}-day`}
    bind:value={day}
    items={dayItems}
    placeholder="Day"
    ariaLabel={`${ariaPrefix} day`}
    class={`w-28 shrink-0 ${formSelect}`}
    {onValueChange}
  />
</div>

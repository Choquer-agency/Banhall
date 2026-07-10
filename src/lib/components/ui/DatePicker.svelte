<!--
  Shared single-date picker: friendly-formatted trigger ("July 9, 2026")
  opening a bits-ui Calendar in a popover. Binds a yyyy-mm-dd string
  ("" = unset) so callers keep plain-string state. Sibling of
  DateRangePicker.svelte — same styling, no range machinery.
-->
<script lang="ts">
  import { Popover, Calendar } from "bits-ui";
  import { parseDate, getLocalTimeZone, type DateValue } from "@internationalized/date";

  let {
    value = $bindable(""),
    id,
    placeholder = "Choose a date",
    size = "md",
    disabled = false,
  }: {
    /** yyyy-mm-dd, or "" when unset. */
    value?: string;
    id?: string;
    placeholder?: string;
    /** "md" — 42px form field; "sm" — compact toolbar chip. */
    size?: "md" | "sm";
    disabled?: boolean;
  } = $props();

  let open = $state(false);

  const parsed = $derived.by(() => {
    try {
      return value ? parseDate(value) : undefined;
    } catch {
      return undefined;
    }
  });

  const label = $derived(
    parsed
      ? parsed.toDate(getLocalTimeZone()).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : ""
  );

  function onValueChange(next: DateValue | undefined) {
    value = next ? next.toString() : "";
    if (next) open = false;
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    {id}
    {disabled}
    class={`flex w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-left transition-colors hover:border-gray-300 disabled:opacity-50 data-[state=open]:border-navy ${
      size === "md" ? "h-[42px] px-3.5 text-sm" : "h-8 rounded-md px-2.5 text-xs"
    }`}
  >
    <svg class={`flex-none text-gray-400 ${size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
    <span class={`min-w-0 flex-1 truncate ${label ? "text-gray-900" : "text-gray-400"}`}>
      {label || placeholder}
    </span>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      side="bottom"
      align="start"
      sideOffset={6}
      class="z-50 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
    >
      <Calendar.Root
        type="single"
        value={parsed}
        {onValueChange}
        weekdayFormat="short"
        class="select-none"
      >
        {#snippet children({ months, weekdays })}
          <Calendar.Header class="mb-2 flex items-center justify-between">
            <Calendar.PrevButton
              class="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-primary-wash hover:text-navy"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Calendar.PrevButton>
            <Calendar.Heading class="text-sm font-semibold text-navy" />
            <Calendar.NextButton
              class="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-primary-wash hover:text-navy"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Calendar.NextButton>
          </Calendar.Header>
          {#each months as month (month.value.toString())}
            <Calendar.Grid class="w-full border-collapse space-y-1">
              <Calendar.GridHead>
                <Calendar.GridRow class="flex justify-between">
                  {#each weekdays as day (day)}
                    <Calendar.HeadCell class="w-8 text-center text-[11px] font-medium text-gray-400">
                      {day.slice(0, 2)}
                    </Calendar.HeadCell>
                  {/each}
                </Calendar.GridRow>
              </Calendar.GridHead>
              <Calendar.GridBody>
                {#each month.weeks as weekDates (weekDates[0].toString())}
                  <Calendar.GridRow class="flex justify-between">
                    {#each weekDates as date (date.toString())}
                      <Calendar.Cell {date} month={month.value} class="p-0">
                        <Calendar.Day
                          class="flex h-8 w-8 items-center justify-center rounded-md text-xs text-gray-700 transition-colors
                            hover:bg-primary-wash
                            data-disabled:pointer-events-none data-disabled:text-gray-300
                            data-outside-month:pointer-events-none data-outside-month:text-transparent
                            data-selected:bg-primary-selected data-selected:font-semibold data-selected:text-white
                            data-today:font-semibold data-today:not-data-selected:text-primary-dark"
                        />
                      </Calendar.Cell>
                    {/each}
                  </Calendar.GridRow>
                {/each}
              </Calendar.GridBody>
            </Calendar.Grid>
          {/each}
        {/snippet}
      </Calendar.Root>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

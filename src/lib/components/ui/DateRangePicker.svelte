<!--
  Shared date-range picker: a friendly-formatted trigger ("Jun 10 – Jul 9, 2026")
  opening a two-month bits-ui RangeCalendar in a popover. Values bind as
  yyyy-mm-dd strings (null = unbounded), so callers keep plain-string state.
-->
<script lang="ts">
  import { Popover, RangeCalendar } from "bits-ui";
  import { CalendarDate, parseDate, today, getLocalTimeZone } from "@internationalized/date";
  import type { DateRange } from "bits-ui";

  let {
    start = $bindable(null),
    end = $bindable(null),
    placeholder = "All time",
  }: {
    /** yyyy-mm-dd, or null for an open bound. */
    start?: string | null;
    end?: string | null;
    placeholder?: string;
  } = $props();

  let open = $state(false);

  const parsed = $derived.by(() => {
    try {
      return {
        start: start ? parseDate(start) : undefined,
        end: end ? parseDate(end) : undefined,
      };
    } catch {
      return { start: undefined, end: undefined };
    }
  });

  // The in-progress selection lives here while the popover is open; the bound
  // start/end only commit once BOTH endpoints are picked, so a half-finished
  // range never fires the caller's filter.
  let pending = $state<DateRange>({ start: undefined, end: undefined });
  function onOpenChange(next: boolean) {
    if (next) pending = { start: parsed.start, end: parsed.end };
  }

  const friendly = (d: CalendarDate) =>
    d.toDate(getLocalTimeZone()).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const label = $derived.by(() => {
    const { start: s, end: e } = parsed;
    if (!s && !e) return placeholder;
    if (s && e) {
      // Single-day range → just the one date.
      if (s.compare(e) === 0) return friendly(s);
      // Same year → "Jun 10 – Jul 9, 2026"
      if (s.year === e.year) {
        const sShort = s.toDate(getLocalTimeZone()).toLocaleDateString("en-CA", {
          month: "short",
          day: "numeric",
        });
        return `${sShort} – ${friendly(e)}`;
      }
      return `${friendly(s)} – ${friendly(e)}`;
    }
    return s ? `From ${friendly(s)}` : `Until ${friendly(e as CalendarDate)}`;
  });

  function onValueChange(range: DateRange) {
    pending = range;
    if (range.start && range.end) {
      start = range.start.toString();
      end = range.end.toString();
      open = false;
    }
  }
</script>

<Popover.Root bind:open {onOpenChange}>
  <Popover.Trigger
    class="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-700 transition-colors hover:border-gray-300 data-[state=open]:border-navy"
  >
    <svg class="h-3.5 w-3.5 flex-none text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
    <span class={start || end ? "font-medium text-navy" : "text-gray-500"}>{label}</span>
    {#if start || end}
      <!-- Clear back to the open range without opening the calendar -->
      <span
        role="button"
        tabindex="0"
        aria-label="Clear date range"
        onclick={(e) => {
          e.stopPropagation();
          start = null;
          end = null;
        }}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            start = null;
            end = null;
          }
        }}
        class="ml-0.5 rounded p-0.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
      >
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    {/if}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      side="bottom"
      align="end"
      sideOffset={6}
      class="z-50 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
    >
      <RangeCalendar.Root
        value={pending}
        {onValueChange}
        maxValue={today(getLocalTimeZone())}
        numberOfMonths={2}
        weekdayFormat="short"
        class="select-none"
      >
        {#snippet children({ months, weekdays })}
          <RangeCalendar.Header class="mb-2 flex items-center justify-between">
            <RangeCalendar.PrevButton
              class="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-primary-wash hover:text-navy"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </RangeCalendar.PrevButton>
            <RangeCalendar.Heading class="text-sm font-semibold text-navy" />
            <RangeCalendar.NextButton
              class="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-primary-wash hover:text-navy"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </RangeCalendar.NextButton>
          </RangeCalendar.Header>
          <div class="flex flex-col gap-4 sm:flex-row">
            {#each months as month (month.value.toString())}
              <RangeCalendar.Grid class="w-full border-collapse space-y-1">
                <RangeCalendar.GridHead>
                  <RangeCalendar.GridRow class="flex justify-between">
                    {#each weekdays as day (day)}
                      <RangeCalendar.HeadCell class="w-8 text-center text-[11px] font-medium text-gray-400">
                        {day.slice(0, 2)}
                      </RangeCalendar.HeadCell>
                    {/each}
                  </RangeCalendar.GridRow>
                </RangeCalendar.GridHead>
                <RangeCalendar.GridBody>
                  {#each month.weeks as weekDates (weekDates[0].toString())}
                    <RangeCalendar.GridRow class="flex justify-between">
                      {#each weekDates as date (date.toString())}
                        <RangeCalendar.Cell {date} month={month.value} class="p-0">
                          <RangeCalendar.Day
                            class="flex h-8 w-8 items-center justify-center rounded-md text-xs text-gray-700 transition-colors
                              hover:bg-primary-wash
                              data-disabled:pointer-events-none data-disabled:text-gray-300
                              data-outside-month:pointer-events-none data-outside-month:text-transparent
                              data-highlighted:bg-primary-wash data-highlighted:rounded-none
                              data-selection-start:rounded-md data-selection-start:bg-primary-selected data-selection-start:font-semibold data-selection-start:text-white
                              data-selection-end:rounded-md data-selection-end:bg-primary-selected data-selection-end:font-semibold data-selection-end:text-white
                              data-today:font-semibold data-today:not-data-selected:text-primary-dark"
                          />
                        </RangeCalendar.Cell>
                      {/each}
                    </RangeCalendar.GridRow>
                  {/each}
                </RangeCalendar.GridBody>
              </RangeCalendar.Grid>
            {/each}
          </div>
        {/snippet}
      </RangeCalendar.Root>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

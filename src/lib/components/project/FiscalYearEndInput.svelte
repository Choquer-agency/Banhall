<script lang="ts">
  /** Labeled fiscal year-end field for the create-project form; the picker
   *  itself is the shared ui/DatePicker (friendly display, brand calendar). */
  import DatePicker from "$lib/components/ui/DatePicker.svelte";

  let {
    id = "fiscalYearEnd",
    value = $bindable(""),
  }: {
    id?: string;
    value?: string;
  } = $props();
</script>

<div class="flex flex-col gap-1.5">
  <label for={id} class="text-sm font-medium text-gray-700">
    Fiscal year-end <span class="font-normal text-gray-400">(optional)</span>
  </label>
  <DatePicker {id} bind:value placeholder="Choose fiscal year-end" />
</div>

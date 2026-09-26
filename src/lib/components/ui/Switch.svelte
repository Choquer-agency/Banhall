<script lang="ts">
  // TEMPORARY STUB (WS2 branch): WS1 owns Switch (bits-ui, 32x18 track, fir
  // on) and replaces it on rebase.
  import { Switch } from "bits-ui";

  let {
    checked = $bindable(false),
    disabled = false,
    id = undefined,
    onCheckedChange = undefined,
    "aria-label": ariaLabel = undefined,
    "aria-describedby": ariaDescribedby = undefined,
  }: {
    checked?: boolean;
    disabled?: boolean;
    id?: string;
    onCheckedChange?: (checked: boolean) => void;
    "aria-label"?: string;
    "aria-describedby"?: string;
  } = $props();
</script>

<Switch.Root
  bind:checked
  {disabled}
  {id}
  {onCheckedChange}
  aria-label={ariaLabel}
  aria-describedby={ariaDescribedby}
  class="inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full bg-gray-300 p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-fir"
>
  <Switch.Thumb class="block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[14px]" />
</Switch.Root>

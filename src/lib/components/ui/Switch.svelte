<script lang="ts">
  /**
   * Round 2 switch (I2, I3): bits-ui Switch drawn as the boards' 32x18 track,
   * primary-selected when on and gray-300 when off, with a 14px white thumb.
   * Coarse pointers get a 44px hit area around the track.
   */
  import { Switch } from "bits-ui";

  let {
    checked = $bindable(false),
    disabled = false,
    label,
    onCheckedChange = undefined,
    id = undefined,
    class: className = "",
  }: {
    checked?: boolean;
    disabled?: boolean;
    /** Accessible name (the row label). */
    label: string;
    onCheckedChange?: (checked: boolean) => void;
    id?: string;
    class?: string;
  } = $props();
</script>

<Switch.Root
  bind:checked
  {disabled}
  {id}
  aria-label={label}
  onCheckedChange={(value) => onCheckedChange?.(value)}
  data-switch
  class={`group relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none data-[state=checked]:bg-primary-selected data-[state=unchecked]:bg-gray-300 pointer-coarse:before:absolute pointer-coarse:before:-inset-x-1.5 pointer-coarse:before:-inset-y-[13px] pointer-coarse:before:content-[''] ${className}`}
>
  <Switch.Thumb
    class="pointer-events-none block size-3.5 rounded-full bg-surface transition-transform duration-150 ease-out motion-reduce:transition-none data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0"
  />
</Switch.Root>

<script lang="ts">
  /**
   * Round 2 switch. bits-ui Switch in the boards' two sizes:
   * - "sm" (I3 Notifications): 32x18 track, primary-selected when on, 14px thumb.
   * - "md" (I2 Writing preferences): 36x20 track, fir when on, 16px thumb.
   * Both are gray-300 when off, with 2px padding. Coarse pointers get a 44px
   * hit area around the track.
   */
  import { Switch } from "bits-ui";

  let {
    checked = $bindable(false),
    disabled = false,
    label,
    size = "sm",
    onCheckedChange = undefined,
    id = undefined,
    class: className = "",
  }: {
    checked?: boolean;
    disabled?: boolean;
    /** Accessible name (the row label). */
    label: string;
    size?: "sm" | "md";
    onCheckedChange?: (checked: boolean) => void;
    id?: string;
    class?: string;
  } = $props();

  const trackStyles = {
    sm: "h-[18px] w-8 data-[state=checked]:bg-primary-selected pointer-coarse:before:-inset-x-1.5 pointer-coarse:before:-inset-y-[13px]",
    md: "h-5 w-9 data-[state=checked]:bg-fir pointer-coarse:before:-inset-x-1 pointer-coarse:before:-inset-y-3",
  } as const;
  const thumbStyles = {
    sm: "size-3.5 data-[state=checked]:translate-x-3.5",
    md: "size-4 data-[state=checked]:translate-x-4",
  } as const;
</script>

<Switch.Root
  bind:checked
  {disabled}
  {id}
  aria-label={label}
  onCheckedChange={(value) => onCheckedChange?.(value)}
  data-switch={size}
  class={`group relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none data-[state=unchecked]:bg-gray-300 pointer-coarse:before:absolute pointer-coarse:before:content-[''] ${trackStyles[size]} ${className}`}
>
  <Switch.Thumb
    class={`pointer-events-none block rounded-full bg-surface transition-transform duration-150 ease-out motion-reduce:transition-none data-[state=unchecked]:translate-x-0 ${thumbStyles[size]}`}
  />
</Switch.Root>

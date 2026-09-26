<script lang="ts">
  // J5 live rule row: a success check once the password is long enough.
  import { CheckIcon } from "phosphor-svelte";

  let { met, label = "At least 8 characters" }: { met: boolean; label?: string } = $props();
</script>

<div data-password-rule={met ? "met" : "unmet"} class="flex items-center gap-2">
  <span
    aria-hidden="true"
    class={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${met ? "bg-success-soft text-success" : "border-[1.5px] border-gray-300"}`}
  >
    {#if met}<CheckIcon size={10} weight="bold" />{/if}
  </span>
  <span class={`text-xs leading-4 ${met ? "text-success-ink-muted" : "text-ink-muted"}`}>
    {label}<span class="sr-only">{met ? ", done" : ", not yet"}</span>
  </span>
</div>

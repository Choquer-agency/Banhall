<script lang="ts">
  // J5, J9 live rule row: a 16px circle and a 12px line; once the password is
  // long enough the circle fills success-soft with a 9px success-ink check
  // and the line turns success-ink.
  import { IconCheck } from "$lib/components/icons";

  let { met, label = "At least 8 characters" }: { met: boolean; label?: string } = $props();
</script>

<div data-password-rule={met ? "met" : "unmet"} class="flex items-center gap-2">
  <span
    aria-hidden="true"
    data-password-rule-mark
    class={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${met ? "bg-success-soft text-success-ink" : "border-[1.5px] border-gray-300"}`}
  >
    {#if met}<IconCheck size={9} strokeWidth={3.2} />{/if}
  </span>
  <span class={`text-xs leading-4 ${met ? "text-success-ink" : "text-ink-muted"}`}>
    {label}<span class="sr-only">{met ? ", done" : ", not yet"}</span>
  </span>
</div>

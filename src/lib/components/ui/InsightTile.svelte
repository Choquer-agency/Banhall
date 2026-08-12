<script lang="ts">
  // Compact loaded-only Home insight. Mono is confined to the numeric value;
  // labels, qualifiers, and loading language remain in the UI sans family.
  let {
    id,
    label,
    value,
    suffix = "",
    qualifier = null,
    tone = "default",
    loading = false,
  }: {
    id: string;
    label: string;
    value: number;
    suffix?: "" | "+";
    qualifier?: string | null;
    tone?: "default" | "alert";
    loading?: boolean;
  } = $props();
</script>

<span data-home-insight={id} class="inline-flex items-baseline gap-1.5">
  {#if loading}
    <span class="text-sm text-ink-muted" role="status" aria-label={`${label} loading`}>Loading {label}</span>
  {:else}
    <span class={`font-mono text-[1.0625rem] tabular-nums ${tone === "alert" && value > 0 ? "font-semibold text-red-700" : "text-ink"}`}>{value}{suffix}</span>
    <span class={`text-sm ${tone === "alert" && value > 0 ? "font-medium text-red-700" : "text-ink-secondary"}`}>{label}</span>
    {#if qualifier}<span class="sr-only">{qualifier}</span>{/if}
  {/if}
</span>

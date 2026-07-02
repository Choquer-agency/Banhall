<script lang="ts">
  import { SUPPORTED_LABEL } from "$lib/parseDocument";

  /** Inline warning shown when a writer attaches a file type we can't parse. */
  let { names }: { names: string[] } = $props();
</script>

{#if names.length > 0}
  <div class="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
    <svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
    <span>
      <span class="font-medium">Not added — unsupported file type:</span>
      {names.join(", ")}.
      <span class="text-amber-700">Supported: {SUPPORTED_LABEL}.</span>
    </span>
  </div>
{/if}

<script lang="ts">
  // TEMPORARY STUB (WS2 branch): WS1 owns Avatar and replaces it on rebase.
  // Same prop contract: name, initials, imageUrl, size, tone.
  let {
    name,
    initials,
    imageUrl = null,
    size = 24,
    tone = "fir",
    class: className = "",
  }: {
    name: string;
    initials: string;
    imageUrl?: string | null;
    size?: number;
    tone?: "fir" | "primary";
    class?: string;
  } = $props();

  const fill = $derived(tone === "primary" ? "bg-primary-selected" : "bg-fir");
</script>

{#if imageUrl}
  <img src={imageUrl} alt={name} class={`shrink-0 rounded-full object-cover ${className}`} style={`width:${size}px;height:${size}px`} />
{:else}
  <span
    aria-hidden="true"
    data-avatar
    class={`inline-flex shrink-0 items-center justify-center rounded-full text-white ${fill} ${className}`}
    style={`width:${size}px;height:${size}px;font-size:${Math.max(10, Math.round(size * 0.4))}px`}
  >{initials}</span>
{/if}

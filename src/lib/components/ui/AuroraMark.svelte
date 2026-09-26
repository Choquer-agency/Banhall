<script lang="ts">
  /**
   * The Aurora conic AI mark (ui-design-final.md section 1): rounded square,
   * conic gradient with a soft glint, white glyph at 60% of the size.
   * `glyph="sparkle"` marks an AI surface, `"check"` marks AI work that has
   * finished, `"spinner"` shows AI work in progress (stops under reduced motion).
   */
  import ChatIcon from "./ChatIcon.svelte";

  let {
    size = 16,
    glyph = "sparkle",
    label,
    class: className = "",
  }: {
    size?: number;
    glyph?: "sparkle" | "check" | "spinner";
    /** Accessible name; decorative when omitted. */
    label?: string;
    class?: string;
  } = $props();

  const radius = $derived(Math.max(4, Math.round(size * 0.3)));
  const glyphSize = $derived(Math.round(size * 0.6));
</script>

{#if glyph === "spinner"}
  <span
    data-ai-mark="aurora"
    data-ai-mark-glyph="spinner"
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : "true"}
    class={`relative inline-block shrink-0 ${className}`}
    style={`width:${size}px;height:${size}px`}
  >
    <span
      class="aurora-spin absolute inset-0 rounded-full"
      style="background:var(--aurora-conic);-webkit-mask:radial-gradient(circle, transparent 55%, #000 57%);mask:radial-gradient(circle, transparent 55%, #000 57%)"
    ></span>
  </span>
{:else}
  <span
    data-ai-mark="aurora"
    data-ai-mark-glyph={glyph}
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : "true"}
    class={`relative inline-flex shrink-0 items-center justify-center text-white ${className}`}
    style={`width:${size}px;height:${size}px;border-radius:${radius}px;background:var(--aurora-glint),var(--aurora-conic);box-shadow:var(--aurora-shadow)`}
  >
    {#if glyph === "check"}
      <svg
        viewBox="0 0 24 24"
        width={glyphSize}
        height={glyphSize}
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg
      >
    {:else}
      <span style={`width:${glyphSize}px;height:${glyphSize}px`} class="inline-flex">
        <ChatIcon class="h-full w-full" />
      </span>
    {/if}
  </span>
{/if}

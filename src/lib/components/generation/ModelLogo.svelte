<!--
  Provider logo chip (official mark; rounding is baked into the SVG). A
  provider the model catalog added without a bundled mark gets its initial on
  a neutral chip instead of another provider's logo.
-->
<script lang="ts">
  import { providerLogo } from "../../../../shared/generationModels";

  let {
    size = "md",
    provider = "Anthropic",
  }: { size?: "sm" | "md"; provider?: string } = $props();

  const src = $derived(providerLogo(provider));
</script>

{#if src}
  <img
    {src}
    width="512"
    height="512"
    alt={provider}
    class={`shrink-0 object-contain ${size === "md" ? "size-6" : "size-4"}`}
  />
{:else}
  <span
    role="img"
    aria-label={provider}
    class={`inline-flex shrink-0 items-center justify-center rounded bg-chrome font-medium text-gray-600 ${
      size === "md" ? "size-6 text-xs" : "size-4 text-[10px]"
    }`}
  >
    {provider.charAt(0).toUpperCase()}
  </span>
{/if}

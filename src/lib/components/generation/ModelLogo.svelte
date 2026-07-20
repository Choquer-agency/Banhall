<!-- Provider logo chip (official mark; rounding is baked into the SVG). -->
<script lang="ts">
  import {
    PROVIDER_LOGOS,
    type ModelProvider,
  } from "../../../../shared/generationModels";

  let {
    size = "md",
    provider = "Anthropic",
  }: { size?: "sm" | "md"; provider?: ModelProvider } = $props();
</script>

<img
  src={PROVIDER_LOGOS[provider] ?? PROVIDER_LOGOS.Anthropic}
  width="512"
  height="512"
  alt={provider}
  class={`shrink-0 object-contain ${size === "md" ? "size-6" : "size-4"}`}
/>

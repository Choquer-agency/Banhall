<!-- Provider logo chip (official mark; rounding is baked into the SVG). -->
<script lang="ts">
  import { PROVIDER_LOGO_URL } from "../../../../shared/generationModels";

  let { size = "md", alt = "Anthropic" }: { size?: "sm" | "md"; alt?: string } = $props();
</script>

<img
  src={PROVIDER_LOGO_URL}
  width="512"
  height="512"
  {alt}
  class={`shrink-0 object-contain ${size === "md" ? "size-6" : "size-4"}`}
/>

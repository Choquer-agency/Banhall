<!--
  Small Aurora spinner (boards 4.4 and 4.5): a grey track ring with a quarter
  arc in the Aurora teal-to-violet gradient, turning while QA runs. The turn
  stops under prefers-reduced-motion (the `aurora-spin` class).
-->
<script lang="ts">
  let { size = 12 }: { size?: number } = $props();

  const uid = $props.id();
  const gradientId = `aurora-ring-${uid}`;
</script>

<svg
  data-ai-mark="aurora"
  data-ai-mark-glyph="spinner"
  aria-hidden="true"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  class="aurora-spin shrink-0"
>
  <defs>
    <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2FD2C4" />
      <stop offset="100%" stop-color="#8438FF" />
    </linearGradient>
  </defs>
  <circle cx="12" cy="12" r="9" stroke="var(--aurora-track)" stroke-width="3" />
  <path d="M12 3a9 9 0 0 1 9 9" stroke={`url(#${gradientId})`} stroke-width="3" stroke-linecap="round" />
</svg>

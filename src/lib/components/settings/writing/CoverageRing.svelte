<script lang="ts">
  // I2 ring: the AI gradient arc over a line-soft track, proportional to the
  // covered areas, with "3/6" in the middle.
  let { covered, total, size = 64 }: { covered: number; total: number; size?: number } = $props();
  const percent = $derived(total > 0 ? Math.round((Math.min(covered, total) / total) * 100) : 0);
</script>

<div
  data-coverage-ring={`${covered}/${total}`}
  role="img"
  aria-label={`${covered} of ${total} areas covered`}
  class="relative flex shrink-0 items-center justify-center rounded-full bg-line-soft"
  style={`width:${size}px;height:${size}px`}
>
  <span
    aria-hidden="true"
    class="absolute inset-0 rounded-full"
    style={`background:var(--aurora-conic);-webkit-mask:conic-gradient(#000 0 ${percent}%, transparent ${percent}% 100%);mask:conic-gradient(#000 0 ${percent}%, transparent ${percent}% 100%)`}
  ></span>
  <span
    class="relative flex items-center justify-center rounded-full bg-surface text-[15px] leading-[18px] font-medium text-ink"
    style={`width:${size - 14}px;height:${size - 14}px`}
  >{covered}/{total}</span>
</div>

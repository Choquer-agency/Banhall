<script lang="ts">
  import { boardRem } from "$lib/rootScale";
  // I2 ring: 72px, the AI gradient (teal, blue, violet, pink) drawn over the
  // covered share of the circle from the top, the aurora track for the rest,
  // and a 58px white centre with "3/6" in 15px/500.
  let { covered, total, size = 72 }: { covered: number; total: number; size?: number } = $props();
  const percent = $derived(total > 0 ? Math.round((Math.min(covered, total) / total) * 1000) / 10 : 0);
  const ring = $derived(
    `conic-gradient(in oklab from 0deg at 50% 50%, var(--color-settings-ring-teal) 0%, var(--color-settings-ring-blue) ${percent * 0.36}%, var(--color-settings-ring-violet) ${percent * 0.7}%, var(--color-settings-ring-pink) ${percent}%, var(--aurora-track) ${percent}%, var(--aurora-track) 100%)`
  );
</script>

<div
  data-coverage-ring={`${covered}/${total}`}
  role="img"
  aria-label={`${covered} of ${total} areas covered`}
  class="relative flex shrink-0 items-center justify-center rounded-full"
  style={`width:${boardRem(size)};height:${boardRem(size)};background-image:${ring}`}
>
  <span
    class="relative flex items-center justify-center rounded-full bg-surface text-[0.9375rem] leading-[1.125rem] font-medium text-ink"
    style={`width:${boardRem(size - 14)};height:${boardRem(size - 14)}`}
  >{covered}/{total}</span>
</div>

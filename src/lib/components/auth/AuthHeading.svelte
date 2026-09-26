<script lang="ts">
  // Serif display heading (36px line) and the 15px subtitle, centred.
  let { title, subtitle = undefined }: { title: string; subtitle?: string } = $props();
</script>

<div class="flex flex-col items-center gap-1.5 text-center">
  <h1 class="font-serif text-[28px] leading-9 text-balance text-ink">{title}</h1>
  {#if subtitle}
    <p class="text-[15px] leading-[22px] text-pretty text-ink-secondary">{subtitle}</p>
  {/if}
</div>

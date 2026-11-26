<script lang="ts">
  // Display heading (24px, 32px line) and the optional 14px subtitle,
  // centred. Serif by default; the sign-in page uses the sans face.
  let {
    title,
    subtitle = undefined,
    serif = true,
  }: { title: string; subtitle?: string; serif?: boolean } = $props();
</script>

<div class="flex flex-col items-center gap-1.5 text-center">
  <h1
    class={`text-2xl leading-[calc(4/3)] text-balance text-ink ${serif ? "font-serif" : "font-sans font-medium tracking-[-0.02em]"}`}
  >
    {title}
  </h1>
  {#if subtitle}
    <p class="text-sm leading-[calc(10/7)] text-pretty text-ink-secondary">{subtitle}</p>
  {/if}
</div>

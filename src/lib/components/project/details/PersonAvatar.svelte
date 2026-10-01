<script lang="ts">
  import { boardRem } from "$lib/rootScale";
  /** Round initial for a teammate; the viewer is always fir, others take a stable tone. */
  let {
    initials,
    seed,
    isYou = false,
    size = 20,
  }: { initials: string; seed: string; isYou?: boolean; size?: number } = $props();

  const TONES = ["bg-violet-600", "bg-amber-600", "bg-sky-600", "bg-teal-600", "bg-rose-600", "bg-indigo-600"];
  const tone = $derived.by(() => {
    if (isYou) return "bg-fir";
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return TONES[hash % TONES.length];
  });
</script>

<span
  aria-hidden="true"
  class={`inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white ${tone}`}
  style={`width:${boardRem(size)};height:${boardRem(size)};font-size:${boardRem(Math.max(9, Math.round(size * 0.5)))}`}
>{(initials || "?").slice(0, 1).toUpperCase()}</span>

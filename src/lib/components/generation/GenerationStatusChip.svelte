<script lang="ts">
  import type { GenerationStatus } from "$lib/generation/recovery";

  let {
    status,
    candidatesDone = 0,
    candidatesFailed = 0,
    surface = "dark",
  }: {
    status: GenerationStatus;
    candidatesDone?: number;
    candidatesFailed?: number;
    /** "dark" for the saturated fir app bar; "light" for the final top bar. */
    surface?: "dark" | "light";
  } = $props();

  const config = $derived.by(() => {
    if (status === "reserved" || status === "running") {
      return { label: "AI generating", tone: "bg-white/15 text-white", dot: "bg-white/70" };
    }
    if (status === "failed") {
      return { label: "AI generation needs attention", tone: "bg-white/15 text-white", dot: "bg-red-300" };
    }
    if (status === "awaiting_selection" && candidatesFailed > 0) {
      return {
        label: candidatesDone > 0 ? "Some drafts need a retry" : "AI generation needs attention",
        tone: "bg-white/15 text-white",
        dot: "bg-amber-300",
      };
    }
    if (status === "awaiting_selection" || status === "awaiting_input") {
      return {
        label:
          status === "awaiting_selection"
            ? "Action needed: choose a draft"
            : "Action needed: review a section",
        tone: "bg-white/15 text-white",
        dot: "bg-white/70",
      };
    }
    // CAP-7: the pre-retry half of a recovery generation. The project page
    // follows the recovery run instead, so this only shows for exact-id views.
    if (status === "superseded") {
      return { label: "Replaced by a retry", tone: "bg-white/15 text-white", dot: "bg-white/70" };
    }
    return { label: "Generation complete", tone: "bg-white/15 text-white", dot: "bg-white/70" };
  });
  // The light top bar reads the same states in secondary ink on the chrome
  // fill; the dot keeps each state's colour.
  const LIGHT_DOTS: Record<string, string> = {
    "bg-white/70": "bg-ink-muted",
    "bg-red-300": "bg-red-500",
    "bg-amber-300": "bg-amber-500",
  };
  const tone = $derived(surface === "light" ? "bg-chrome text-ink-secondary" : config.tone);
  const dot = $derived(
    surface === "light"
      ? status === "reserved" || status === "running"
        ? "bg-primary"
        : (LIGHT_DOTS[config.dot] ?? "bg-ink-muted")
      : config.dot
  );
</script>

<span role="status" data-surface={surface} class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
  <span aria-hidden="true" class={`h-1.5 w-1.5 rounded-full ${dot}`}></span>
  {config.label}
</span>

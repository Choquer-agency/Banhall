<script lang="ts">
  let {
    status,
    candidatesDone = 0,
    candidatesFailed = 0,
  }: {
    status: "reserved" | "running" | "awaiting_selection" | "awaiting_input" | "completed" | "failed";
    candidatesDone?: number;
    candidatesFailed?: number;
  } = $props();

  const config = $derived.by(() => {
    if (status === "reserved" || status === "running") {
      return { label: "AI · Generating", tone: "bg-white/15 text-white", dot: "bg-white/70" };
    }
    if (status === "failed") {
      return { label: "AI generation needs attention", tone: "bg-white/15 text-white", dot: "bg-red-300" };
    }
    if (status === "awaiting_selection" && candidatesFailed > 0) {
      return {
        label: candidatesDone > 0 ? "AI · Some drafts need retry" : "AI generation needs attention",
        tone: "bg-white/15 text-white",
        dot: "bg-amber-300",
      };
    }
    if (status === "awaiting_selection" || status === "awaiting_input") {
      return {
        label:
          status === "awaiting_selection"
            ? "Action needed · Choose draft"
            : "Action needed · Review section",
        tone: "bg-white/15 text-white",
        dot: "bg-white/70",
      };
    }
    return { label: "AI · Generation complete", tone: "bg-white/15 text-white", dot: "bg-white/70" };
  });
</script>

<span role="status" class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.tone}`}>
  <span aria-hidden="true" class={`h-1.5 w-1.5 rounded-full ${config.dot}`}></span>
  {config.label}
</span>

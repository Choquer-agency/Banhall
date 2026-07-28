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
      return { label: "Generating", tone: "bg-blue-50 text-blue-700", dot: "bg-blue-500" };
    }
    if (status === "failed") {
      return { label: "Generation needs attention", tone: "bg-red-50 text-red-700", dot: "bg-red-500" };
    }
    if (status === "awaiting_selection" && candidatesFailed > 0) {
      return {
        label: candidatesDone > 0 ? "Some drafts need retry" : "Generation needs attention",
        tone: "bg-amber-50 text-amber-800",
        dot: "bg-amber-500",
      };
    }
    if (status === "awaiting_selection" || status === "awaiting_input") {
      return { label: "Ready for your review", tone: "bg-purple-50 text-purple-700", dot: "bg-purple-500" };
    }
    return { label: "Generation complete", tone: "bg-green-50 text-green-800", dot: "bg-green-500" };
  });
</script>

<span class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.tone}`}>
  <span aria-hidden="true" class={`h-1.5 w-1.5 rounded-full ${config.dot}`}></span>
  {config.label}
</span>

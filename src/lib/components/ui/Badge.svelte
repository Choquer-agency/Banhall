<script lang="ts">
  const statusConfig: Record<string, { label: string; className: string; dotColor: string }> = {
    draft: { label: "Draft", className: "bg-gray-100 text-gray-600", dotColor: "bg-gray-400" },
    generating: {
      label: "Generating",
      className: "bg-blue-50 text-blue-600 animate-pulse",
      dotColor: "bg-blue-500",
    },
    awaiting: {
      label: "Awaiting Selection",
      className: "bg-purple-50 text-purple-600",
      dotColor: "bg-purple-500",
    },
    review: { label: "Review", className: "bg-amber-50 text-amber-700", dotColor: "bg-amber-500" },
    client_review: {
      label: "Client Review",
      className: "bg-red-50 text-red-600",
      dotColor: "bg-red-500",
    },
    final: { label: "Final", className: "bg-primary/15 text-navy", dotColor: "bg-primary" },
  };

  let { status, dot = false }: { status: string; dot?: boolean } = $props();

  const config = $derived(
    statusConfig[status] ?? {
      label: status,
      className: "bg-gray-100 text-gray-600",
      dotColor: "bg-gray-400",
    }
  );
</script>

<span
  class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
>
  {#if dot}
    <span aria-hidden="true" class={`h-1.5 w-1.5 rounded-full ${config.dotColor}`}></span>
  {/if}
  {config.label}
</span>

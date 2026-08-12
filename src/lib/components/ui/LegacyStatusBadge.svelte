<script lang="ts">
  let {
    label = "Legacy status",
    shape = "pill",
  }: {
    label?: string;
    shape?: "pill" | "square";
  } = $props();
</script>

<span
  data-legacy-status-badge
  class={`inline-flex items-center gap-1.5 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 ${shape === "square" ? "rounded-md" : "rounded-full"}`}
>
  <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" aria-hidden="true"></span>
  {label}
</span>

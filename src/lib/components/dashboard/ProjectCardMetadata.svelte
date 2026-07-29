<script lang="ts">
  let {
    writer = null,
    updatedDate,
  }: {
    writer?: string | null;
    updatedDate: string;
  } = $props();
</script>

<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 pr-14 text-xs">
  <span class="min-w-0 truncate">Created by {writer || "—"}</span>
  <span class="whitespace-nowrap">Updated {updatedDate}</span>
</div>

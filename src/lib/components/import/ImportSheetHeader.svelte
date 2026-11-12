<!--
  The Import sheet's column header (board ao5): 36px on the gray-50 fill
  with rounded corners, 12px muted names, a light rule at the left of each
  fixed column. "File" lines up with the file names, two indents in.
-->
<script lang="ts">
  import { FIXED_CELL, SHEET_GRID, SHEET_SMALL } from "./sheetLayout";

  const COLUMNS = ["Fiscal year", "Version", "Writer", "Science code"] as const;
</script>

<div role="rowgroup">
  <div role="row" data-import-sheet-header class={`${SHEET_GRID} h-9 rounded-lg bg-gray-50 ${SHEET_SMALL} text-ink-muted`}>
    <div role="columnheader" class="flex min-w-0 items-center pl-12">File</div>
    {#each COLUMNS as column (column)}
      <div role="columnheader" class={FIXED_CELL}>{column}</div>
    {/each}
  </div>
</div>

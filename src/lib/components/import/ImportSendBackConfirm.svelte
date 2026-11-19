<!--
  What Send back to review does, said before anything happens (2026-11-17,
  docs/product-domain.md): the four lines of SEND_BACK_NOTES, then one
  button that names how many files go ("Send back 6 files"). The same words
  in the Approved row's menu, the selection bar and the file view. Its
  holder (a popover, or the file view) decides where it shows.
-->
<script lang="ts">
  import { SEND_BACK_NOTES, sendBackLine } from "./importApproved";
  import { CONFIRM_LINE } from "./sheetLayout";

  let {
    count,
    busy = false,
    onConfirm,
  }: {
    count: number;
    busy?: boolean;
    onConfirm: () => void;
  } = $props();
</script>

<div data-import-send-back-confirm class="flex flex-col">
  <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink">Send back to review?</p>
  <ul data-import-send-back-notes class="mt-1.5 flex flex-col gap-1 text-xs leading-[1.5] text-ink-muted">
    {#each SEND_BACK_NOTES as line (line)}<li>{line}</li>{/each}
  </ul>
  <button type="button" disabled={busy} data-import-send-back-go onclick={onConfirm} class={`mt-2.5 ${CONFIRM_LINE}`}>
    {sendBackLine(count)}
  </button>
</div>

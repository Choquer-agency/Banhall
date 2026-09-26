<script module lang="ts">
  /** Board C1, D3, D5: toast top 820 on a 900 tall board, a 39px card. */
  export const TOAST_BOTTOM_OFFSET = 41;
</script>

<script lang="ts">
  /**
   * The app's one global notifier, mounted by `src/routes/+layout.svelte`
   * (and the toast test harness). Round 2 (C1, D3, D5): one dark card at the
   * bottom centre, its top 820px down a 900px window (41px above the bottom
   * edge), a plain 15px tick for success and the close button inside the
   * card on the right. Errors stay red and warnings amber (layout.css).
   */
  import { Toaster } from "svelte-sonner";
  import { IconClose } from "$lib/components/icons";
  import ToastCheckIcon from "./ToastCheckIcon.svelte";
</script>

<Toaster
  richColors
  closeButton
  position="bottom-center"
  offset={TOAST_BOTTOM_OFFSET}
  toastOptions={{ class: "font-sans" }}
>
  {#snippet successIcon()}<ToastCheckIcon />{/snippet}
  {#snippet closeIcon()}<IconClose size={14} strokeWidth={2} />{/snippet}
</Toaster>

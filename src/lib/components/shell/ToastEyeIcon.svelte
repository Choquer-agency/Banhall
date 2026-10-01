<script lang="ts">
  import { IconEye } from "$lib/components/icons";

  /**
   * The D3 "Now viewing as" toast eye: 15px at stroke 1.6. svelte-sonner
   * renders a toast icon with no props, so this fixes the board size and
   * stroke.
   */
</script>

<IconEye size={15} strokeWidth={1.6} data-toast-icon="eye" />

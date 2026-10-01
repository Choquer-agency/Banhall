<script lang="ts">
  import { IconCheck } from "$lib/components/icons";

  /**
   * The D5 and C1 toast tick: 15px at stroke 2. svelte-sonner renders a
   * toast icon with no props, so this fixes the board size and stroke.
   */
</script>

<IconCheck size={15} strokeWidth={2} data-toast-icon="check" />

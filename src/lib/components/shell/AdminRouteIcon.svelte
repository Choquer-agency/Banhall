<script lang="ts">
  import {
    IconBarChart,
    IconBook,
    IconBrain,
    IconCloudDownload,
    IconDollarCircle,
    IconShieldCheck,
    IconSliders,
    IconTable,
    IconTag,
    IconUser,
    IconUsers,
  } from "$lib/components/icons";
  import type { AdminRouteIcon } from "$lib/dashboard/adminRoutes";

  /**
   * Admin page icons as the A5 flyout draws them (15px, stroke 1.5). The
   * three palette-only pages are not on the boards; they borrow the closest
   * board icon (table for the paired comparisons, one person for the
   * ownership review, people for users and roles).
   */
  let { icon, size = 15 }: { icon: AdminRouteIcon; size?: number } = $props();

  const ICONS = {
    "house-rules": IconBook,
    tags: IconTag,
    brain: IconBrain,
    ingestion: IconCloudDownload,
    models: IconSliders,
    reviews: IconShieldCheck,
    learning: IconBarChart,
    usage: IconDollarCircle,
    comparisons: IconTable,
    backfill: IconUser,
    users: IconUsers,
  } as const;

  const Icon = $derived(ICONS[icon]);
</script>

<Icon {size} strokeWidth={icon === "comparisons" ? 1.3 : 1.5} data-admin-route-icon={icon} class="shrink-0" />

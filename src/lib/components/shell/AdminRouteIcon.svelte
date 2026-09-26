<script lang="ts">
  import {
    BrainIcon,
    ChartBarIcon,
    CloudArrowDownIcon,
    CurrencyCircleDollarIcon,
    NotebookIcon,
    ScalesIcon,
    ShieldCheckIcon,
    SlidersHorizontalIcon,
    TagIcon,
    UserGearIcon,
    UserSwitchIcon,
  } from "phosphor-svelte";
  import type { AdminRouteIcon } from "$lib/dashboard/adminRoutes";

  let { icon, size = 15 }: { icon: AdminRouteIcon; size?: number } = $props();

  const ICONS = {
    "house-rules": NotebookIcon,
    tags: TagIcon,
    brain: BrainIcon,
    ingestion: CloudArrowDownIcon,
    models: SlidersHorizontalIcon,
    reviews: ShieldCheckIcon,
    learning: ChartBarIcon,
    usage: CurrencyCircleDollarIcon,
    comparisons: ScalesIcon,
    backfill: UserSwitchIcon,
    users: UserGearIcon,
  } as const;

  const Icon = $derived(ICONS[icon]);
</script>

<Icon {size} aria-hidden="true" class="shrink-0" />

<script lang="ts">
  /**
   * The fixed labelled rail (the page frame, owner 2026-10-28; Paper S9,
   * S11, A1): 80px on the gray page, no resize and no collapse (owner answer
   * 4). Each item is a 64px column, a 40 by 36 tile (radius 10) over a 12/16
   * label; the active tile takes `frame-tile`, its label ink at 500, its icon
   * the active duotone. Projects, Companies and Team (team.view), the spacer,
   * then Admin (settings.configure) and Settings. Every choice reads the
   * effective viewer, so View as hides what the role cannot open. Below
   * 1024px the shell hides it; the drawer keeps today's rail.
   */
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { ADMIN_LANDING_PATH } from "$lib/dashboard/adminRoutes";
  import { companiesPath } from "$lib/companies/companies";
  import { canSeeAdmin, frameRailItems, selectedFrameRailItem, type FrameRailItem } from "$lib/shell/navigation";
  import { effectiveViewer } from "$lib/shell/viewAs.svelte";
  import FrameIcon from "./FrameIcon.svelte";

  let { projectsHref, class: className = "" }: { projectsHref: string; class?: string } = $props();

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const viewer = $derived(effectiveViewer(userQ.data));
  const attentionQ = useQuery(api.adminAttention.getAttention, () =>
    auth.isAuthenticated && canSeeAdmin(viewer) ? {} : "skip"
  );

  const items = $derived(
    frameRailItems(
      viewer,
      {
        projectsHref,
        // The Companies section (2026-10-28): All companies.
        companiesHref: companiesPath(resolve("/")),
        teamHref: `${resolve("/")}team`,
        adminHref: resolve(ADMIN_LANDING_PATH as "/"),
        settingsHref: resolve("/settings"),
      },
      { adminAttention: attentionQ.data?.total ?? 0 }
    )
  );
  const selected = $derived(selectedFrameRailItem(page.url.pathname));

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir";
</script>

{#snippet railItem(item: FrameRailItem)}
  {@const active = selected === item.id}
  <a
    href={item.href}
    data-rail-item={item.id}
    aria-current={active ? "page" : undefined}
    aria-label={item.attention ? `${item.label}, needs a look` : undefined}
    class={`group flex w-16 shrink-0 flex-col items-center gap-1 rounded-[0.625rem] ${focusRing}`}
  >
    <span
      data-rail-tile
      class={`relative flex h-9 w-10 shrink-0 items-center justify-center rounded-[0.625rem] transition-colors duration-150 ease-out motion-reduce:transition-none ${
        active ? "bg-frame-tile" : "group-hover:bg-frame-tile/60"
      }`}
    >
      <FrameIcon name={item.id} {active} />
      {#if item.attention}
        <span data-rail-attention aria-hidden="true" class="absolute right-1.5 top-1 size-[0.4375rem] rounded-full border-[1.5px] border-frame bg-stale-dot"></span>
      {/if}
    </span>
    <span
      data-rail-label
      class={`whitespace-nowrap text-xs leading-[calc(4/3)] ${active ? "font-medium text-ink" : "text-ink-secondary group-hover:text-ink"}`}
    >{item.label}</span>
  </a>
{/snippet}

<nav
  aria-label="Workspace"
  data-frame-rail
  class={`flex min-h-0 w-20 shrink-0 flex-col items-center gap-1.5 overflow-y-auto px-2 pb-3.5 pt-2.5 scrollbar-hidden ${className}`}
>
  {#each items.top as item (item.id)}
    {@render railItem(item)}
  {/each}
  <div data-rail-spacer aria-hidden="true" class="min-h-4 flex-1"></div>
  {#each items.bottom as item (item.id)}
    {@render railItem(item)}
  {/each}
</nav>

<script lang="ts">
  /**
   * The Settings section sidebar (the page frame, owner 2026-10-28, answer
   * 1): Account, Notifications, Shortcuts and Writing, each its own route.
   * It replaces the settings tabs from 768px; a phone keeps the tabs.
   */
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { IconBell, IconPencil, IconUser } from "$lib/components/icons";
  import { settingsSectionForPath, type SettingsSectionKey } from "$lib/settings/sections";
  import SectionSidebar from "../SectionSidebar.svelte";
  import SectionSidebarLink from "../SectionSidebarLink.svelte";
  import FrameIcon from "../FrameIcon.svelte";

  const ROWS: { key: SettingsSectionKey; label: string; path: `/settings/${SettingsSectionKey}` }[] = [
    { key: "account", label: "Account", path: "/settings/account" },
    { key: "notifications", label: "Notifications", path: "/settings/notifications" },
    { key: "shortcuts", label: "Shortcuts", path: "/settings/shortcuts" },
    { key: "writing", label: "Writing", path: "/settings/writing" },
  ];

  const active = $derived(settingsSectionForPath(page.url.pathname).key);
</script>

<SectionSidebar section="settings" title="Settings">
  <nav aria-label="Settings sections" class="flex shrink-0 flex-col gap-0.5 pt-3">
    {#each ROWS as row (row.key)}
      <SectionSidebarLink href={resolve(row.path)} label={row.label} data-settings-sidebar={row.key} active={active === row.key}>
        {#snippet icon()}
          {#if row.key === "account"}
            <IconUser size={16} strokeWidth={1.7} class="shrink-0" />
          {:else if row.key === "notifications"}
            <IconBell size={16} strokeWidth={1.7} class="shrink-0" />
          {:else if row.key === "shortcuts"}
            <FrameIcon name="keyboard" />
          {:else}
            <IconPencil size={16} strokeWidth={1.7} class="shrink-0" />
          {/if}
        {/snippet}
      </SectionSidebarLink>
    {/each}
  </nav>
</SectionSidebar>

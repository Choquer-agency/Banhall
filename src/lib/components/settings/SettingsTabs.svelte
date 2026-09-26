<script lang="ts">
  /**
   * Settings tabs (I1 to I5): a segmented bar on `chrome`, padding 4, radius
   * 10, gap 4. Tabs are links (real routes), 30px, radius 7, 13px/500. Active
   * is the primary fill with white text; inactive is secondary ink with a
   * primary-wash hover (AGENTS rule). Scrolls sideways on narrow screens.
   */
  let {
    tabs,
    activeKey,
  }: {
    tabs: { key: string; label: string; href: string }[];
    activeKey: string;
  } = $props();
</script>

<nav aria-label="Settings sections" class="-m-1 max-w-full overflow-x-auto p-1">
  <ul data-settings-tabs class="inline-flex gap-1 rounded-[10px] bg-chrome p-1">
    {#each tabs as tab (tab.key)}
      {@const current = tab.key === activeKey}
      <li>
        <a
          href={tab.href}
          aria-current={current ? "page" : undefined}
          data-settings-tab={tab.key}
          class={`flex h-[30px] items-center whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium leading-[18px] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11 ${
            current ? "bg-primary-selected text-white" : "text-ink-secondary hover:bg-primary-wash hover:text-ink"
          }`}
        >{tab.label}</a>
      </li>
    {/each}
  </ul>
</nav>

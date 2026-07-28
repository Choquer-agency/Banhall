<script lang="ts">
  import * as Drawer from "$lib/components/ui/drawer/index.js";
  import type { Role } from "../../../../shared/roles";
  import {
    ASSIGNABLE_ROLES,
    ROLE_DESCRIPTION_NOTE,
    ROLE_DESCRIPTIONS,
  } from "$lib/roles/roleDescriptions";
  import RoleDetail from "./RoleDetail.svelte";

  let {
    open = $bindable(false),
    role = $bindable<Role>("writer"),
  }: {
    open?: boolean;
    role?: Role;
  } = $props();

  const componentId = $props.id();

  function tabId(item: Role) {
    return `${componentId}-${item}-tab`;
  }

  function panelId(item: Role) {
    return `${componentId}-${item}-panel`;
  }

  function handleTabKeydown(event: KeyboardEvent, currentIndex: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % ASSIGNABLE_ROLES.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + ASSIGNABLE_ROLES.length) % ASSIGNABLE_ROLES.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = ASSIGNABLE_ROLES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    role = ASSIGNABLE_ROLES[nextIndex];
    document.getElementById(tabId(role))?.focus();
  }
</script>

<Drawer.Root bind:open direction="right" shouldScaleBackground={false}>
    <Drawer.Content
      class="z-[110] border-line bg-white text-ink shadow-2xl data-[vaul-drawer-direction=bottom]:max-h-[85svh] data-[vaul-drawer-direction=bottom]:rounded-t-xl data-[vaul-drawer-direction=right]:h-dvh data-[vaul-drawer-direction=right]:max-h-dvh data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:max-w-[30rem] data-[vaul-drawer-direction=right]:rounded-l-xl"
    >
      <Drawer.Header class="flex-none border-b border-line px-5 pt-5 pb-4 text-left sm:px-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <Drawer.Title class="text-title">Role guide</Drawer.Title>
            <Drawer.Description class="mt-1 text-sm leading-relaxed text-ink-muted">
              Compare access levels before assigning or changing a role.
            </Drawer.Description>
          </div>
          <Drawer.Close
            aria-label="Close role guide"
            class="-mr-1 flex h-8 w-8 flex-none items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-primary-wash hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <svg aria-hidden="true" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Drawer.Close>
        </div>

      <div
        role="tablist"
        aria-label="Roles"
        class="mt-4 grid grid-flow-col auto-cols-fr gap-0.5 rounded-lg bg-chrome p-0.5"
      >
        {#each ASSIGNABLE_ROLES as item, index (item)}
          {@const selected = role === item}
          <button
            type="button"
            role="tab"
            id={tabId(item)}
            aria-selected={selected}
            aria-controls={panelId(item)}
            tabindex={selected ? 0 : -1}
            onclick={() => (role = item)}
            onkeydown={(event) => handleTabKeydown(event, index)}
            class={`min-h-10 rounded-md px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              selected
                ? "bg-white text-navy shadow-sm"
                : "text-ink-secondary hover:bg-primary-wash hover:text-navy"
            }`}
          >
            {ROLE_DESCRIPTIONS[item].label}
          </button>
        {/each}
      </div>
    </Drawer.Header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
      {#each ASSIGNABLE_ROLES as item (item)}
        <div
          role="tabpanel"
          id={panelId(item)}
          aria-labelledby={tabId(item)}
          tabindex="0"
          hidden={role !== item}
          class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4"
        >
          <RoleDetail role={item} />
        </div>
      {/each}
      <p class="mt-8 border-t border-line-soft pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] text-xs leading-relaxed text-ink-muted">
        {ROLE_DESCRIPTION_NOTE}
      </p>
    </div>
    </Drawer.Content>
</Drawer.Root>

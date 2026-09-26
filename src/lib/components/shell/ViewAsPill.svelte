<script lang="ts">
  /**
   * D3 viewing pill, layered by the shell over the centre of the 56px top
   * bar: "Viewing as [role]" with a role menu that switches directly, and
   * Exit. Only renders while a developer is viewing as another role.
   */
  import { DropdownMenu } from "bits-ui";
  import { CaretDownIcon, CheckIcon, EyeIcon } from "phosphor-svelte";
  import { VIEW_AS_LABELS, VIEW_AS_ROLES, viewAs, type ViewAsRole } from "$lib/shell/viewAs.svelte";
  import { exitViewAsWithToast } from "$lib/shell/viewAsActions";

  let { role }: { role: ViewAsRole } = $props();
  let menuOpen = $state(false);
</script>

<div
  data-view-as-pill
  role="status"
  class="pointer-events-auto flex h-9 items-center gap-1 rounded-full border border-warning-line bg-warning-surface pl-3 pr-1 max-lg:w-full max-lg:justify-center"
>
  <EyeIcon size={14} class="shrink-0 text-warning-ink" aria-hidden="true" />
  <span class="pl-1 pr-1.5 text-[13px] leading-[18px] text-warning-ink">Viewing as</span>
  <DropdownMenu.Root bind:open={menuOpen}>
    <DropdownMenu.Trigger
      data-view-as-role-trigger
      aria-label={`Viewing as ${VIEW_AS_LABELS[role]}. Switch role`}
      class="flex h-[26px] items-center gap-1 rounded-full border border-warning-line bg-surface px-2 text-[13px] font-medium leading-[18px] text-ink transition-colors hover:bg-warning-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none"
    >
      {VIEW_AS_LABELS[role]}
      <CaretDownIcon size={12} weight="bold" class="text-warning-ink" aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        side="bottom"
        align="center"
        sideOffset={6}
        class="z-[130] w-44 rounded-xl border border-line bg-surface p-1.5 shadow-menu"
      >
        <DropdownMenu.RadioGroup
          value={role}
          onValueChange={(value) => viewAs.switchTo(value as ViewAsRole)}
          aria-label="View as"
        >
          {#each VIEW_AS_ROLES as option (option)}
            <DropdownMenu.RadioItem
              value={option}
              data-view-as-option={option}
              class="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-ink-secondary outline-none data-highlighted:bg-chrome data-highlighted:text-ink pointer-coarse:h-11"
            >
              {#snippet children({ checked })}
                <span class="flex-1">{VIEW_AS_LABELS[option]}</span>
                {#if checked}<CheckIcon size={14} class="text-primary-selected" aria-hidden="true" />{/if}
              {/snippet}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
  <button
    type="button"
    data-view-as-pill-exit
    onclick={exitViewAsWithToast}
    class="flex h-[26px] items-center rounded-full px-2.5 text-[13px] font-medium leading-[18px] text-warning-ink underline decoration-1 underline-offset-2 transition-colors hover:bg-warning-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none"
  >Exit</button>
</div>

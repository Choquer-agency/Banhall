<!--
  Science code picker (ui-design-final.md section 8, board 5.1y A3): a
  searchable list grouped by field, the code in muted mono before the name, a
  check on the current code. Group headers show the field name only.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Command, Popover } from "bits-ui";
  import { CheckIcon, MagnifyingGlassIcon } from "phosphor-svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { scienceCodeGroups } from "./detailsFormat";

  let {
    value,
    open = $bindable(false),
    trigger,
    onSelect,
    onSuggest,
  }: {
    value: string | null;
    open?: boolean;
    /** The fact row value; spread `props` onto a button. */
    trigger: Snippet<[{ props: Record<string, unknown> }]>;
    onSelect: (code: string | null) => void | Promise<void>;
    /** Optional AI suggestion; the host saves the suggested code. */
    onSuggest?: () => void | Promise<void>;
  } = $props();

  let query = $state("");
  const groups = $derived(scienceCodeGroups(query));
  $effect(() => {
    if (!open) query = "";
  });

  function choose(code: string | null) {
    open = false;
    void onSelect(code);
  }

  const itemClass =
    "flex min-h-8 w-full cursor-default items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-ink outline-none data-[selected]:bg-primary-wash";
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      {@render trigger({ props })}
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      side="bottom"
      align="end"
      sideOffset={6}
      collisionPadding={12}
      class="z-[120] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-lg outline-none"
    >
      <Command.Root shouldFilter={false} loop label="Science code" class="flex max-h-[min(24rem,calc(100dvh-8rem))] flex-col">
        <div class="relative shrink-0 border-b border-line-soft p-2">
          <MagnifyingGlassIcon size={14} aria-hidden="true" class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Command.Input
            bind:value={query}
            placeholder="Search by name or code"
            aria-label="Search science codes"
            class="input-chromeless h-8 w-full rounded-md bg-transparent pl-7 pr-2 text-[13px] text-ink placeholder:text-ink-faint"
          />
        </div>
        <Command.List class="min-h-0 flex-1 overflow-y-auto p-1.5">
          <Command.Viewport>
            {#each groups as group (group.field)}
              <Command.Group>
                <Command.GroupHeading class="px-2 pb-1 pt-2 text-[11px] uppercase tracking-wide text-ink-muted">{group.field}</Command.GroupHeading>
                <Command.GroupItems>
                  {#each group.items as item (item.code)}
                    <Command.Item
                      value={item.code}
                      onSelect={() => choose(item.code)}
                      class={itemClass}
                      aria-current={item.code === value ? "true" : undefined}
                    >
                      <span class="w-14 shrink-0 font-mono text-xs text-ink-muted">{item.code}</span>
                      <span class="min-w-0 flex-1">{item.label}</span>
                      {#if item.code === value}
                        <CheckIcon size={14} aria-label="Current code" class="shrink-0 text-primary-selected" />
                      {/if}
                    </Command.Item>
                  {/each}
                </Command.GroupItems>
              </Command.Group>
            {:else}
              <p class="px-2 py-4 text-center text-[13px] text-ink-muted" role="status">No code matches.</p>
            {/each}
          </Command.Viewport>
        </Command.List>
        {#if onSuggest || value}
          <div class="flex shrink-0 items-center gap-1 border-t border-line-soft p-1.5">
            {#if onSuggest}
              <button
                type="button"
                onclick={() => {
                  open = false;
                  void onSuggest?.();
                }}
                class="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
              >
                <AuroraMark size={16} />
                Suggest with AI
              </button>
            {/if}
            {#if value}
              <button
                type="button"
                onclick={() => choose(null)}
                class="ml-auto flex h-8 items-center rounded-md px-2 text-[13px] text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
              >
                Clear
              </button>
            {/if}
          </div>
        {/if}
      </Command.Root>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

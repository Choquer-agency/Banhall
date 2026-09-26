<script lang="ts">
  /**
   * D2: pick the role to view Banhall as (developers only). View as is
   * presentation only (decision 53): it changes navigation and page gates in
   * this tab; every query and mutation still runs with the developer's real
   * access, so "See exactly what they see" holds for navigation and gates,
   * not for data the server filters by the real role.
   */
  import { Dialog, RadioGroup } from "bits-ui";
  import { CheckIcon, MinusIcon, XIcon } from "phosphor-svelte";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import { modalPop, overlayFade } from "$lib/motion";
  import { VIEW_AS_LABELS, viewAs, type ViewAsRole } from "$lib/shell/viewAs.svelte";
  import { enterViewAsWithToast } from "$lib/shell/viewAsActions";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const CARDS: { role: ViewAsRole; lines: { text: string; sees: boolean }[] }[] = [
    { role: "owner", lines: [{ text: "Team and invites", sees: true }, { text: "Admin", sees: true }] },
    { role: "manager", lines: [{ text: "Team and invites", sees: true }, { text: "Admin", sees: false }] },
    {
      role: "consultant",
      lines: [
        { text: "Home, Projects, Companies", sees: true },
        { text: "Team and Admin", sees: false },
      ],
    },
    { role: "admin", lines: [{ text: "Team and roles", sees: true }, { text: "Admin", sees: true }] },
  ];

  let selected = $state<ViewAsRole>("consultant");
  $effect(() => {
    if (open) selected = viewAs.role ?? "consultant";
  });

  function confirm() {
    open = false;
    enterViewAsWithToast(selected);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}
          <div {...props} transition:overlayFade class="fixed inset-0 z-[120] bg-navy/35"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[120] flex items-end justify-center sm:items-center sm:p-4">
      <Dialog.Content forceMount>
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              data-view-as-dialog
              transition:modalPop
              class="pointer-events-auto w-full overflow-hidden rounded-t-2xl border border-line bg-surface shadow-dialog sm:max-w-[600px] sm:rounded-2xl"
            >
              <div class="flex items-start gap-4 pl-7 pr-5 pt-6">
                <div class="flex flex-1 flex-col gap-1.5">
                  <Dialog.Title class="text-lg font-medium leading-6 text-ink">View Banhall as another role</Dialog.Title>
                  <Dialog.Description class="text-sm leading-5 text-ink-muted">
                    See exactly what they see. Anything you do still uses your Developer access.
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  aria-label="Close"
                  class="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-chrome hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11"
                >
                  <XIcon size={18} aria-hidden="true" />
                </Dialog.Close>
              </div>

              <RadioGroup.Root
                bind:value={() => selected, (value) => (selected = value as ViewAsRole)}
                aria-label="Role to view as"
                class="grid grid-cols-1 gap-2.5 px-7 pb-1 pt-[18px] sm:grid-cols-2"
              >
                {#each CARDS as card (card.role)}
                  <RadioGroup.Item
                    value={card.role}
                    data-view-as-card={card.role}
                    class="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3.5 text-left outline-none transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir data-[state=checked]:border-fir data-[state=checked]:bg-primary-wash data-[state=checked]:shadow-[inset_0_0_0_0.5px_var(--color-fir)] motion-reduce:transition-none"
                  >
                    <RoleChip kind={card.role} class="self-start" />
                    <span class="flex flex-col gap-1">
                      {#each card.lines as line (line.text)}
                        <span class="flex items-center gap-1.5 text-xs leading-4">
                          {#if line.sees}
                            <CheckIcon size={11} weight="bold" aria-hidden="true" class="shrink-0 text-ink-secondary" />
                            <span class="text-ink-secondary">{line.text}</span>
                          {:else}
                            <MinusIcon size={11} weight="bold" aria-hidden="true" class="shrink-0 text-ink-faint" />
                            <span class="text-ink-muted"><span class="sr-only">{"Not "}</span>{line.text}</span>
                          {/if}
                        </span>
                      {/each}
                    </span>
                  </RadioGroup.Item>
                {/each}
              </RadioGroup.Root>

              <div class="flex flex-col-reverse gap-2 pb-5 pl-7 pr-5 pt-[18px] sm:flex-row sm:items-center">
                <p class="flex-1 text-xs leading-4 text-ink-muted">Exit any time from the pill at the top.</p>
                <!-- Round 2 filled destructive Cancel (Button variant destructive-soft tokens). -->
                <Dialog.Close
                  class="inline-flex h-9 items-center justify-center rounded-md bg-destructive-soft px-3.5 text-sm font-medium text-destructive-soft-ink transition-colors hover:bg-destructive-soft-hover hover:text-destructive-soft-ink-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger motion-reduce:transition-none pointer-coarse:h-11"
                >Cancel</Dialog.Close>
                <button
                  type="button"
                  data-view-as-confirm
                  onclick={confirm}
                  class="inline-flex h-9 items-center justify-center rounded-md bg-fir px-4 text-sm font-medium text-white transition-colors hover:bg-navy-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
                >View as {VIEW_AS_LABELS[selected]}</button>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>

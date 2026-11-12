<!--
  The version menu under a file's Version cell (board ao5): the three stages
  in words ("T - to be submitted", "S - submitted", "R - in review"), then
  the numbers 1 to 9. Pick the stage (it starts on the file's own), then the
  number, which sets both at once and closes the menu. Final PDs, drafts and
  review copies only.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Popover } from "bits-ui";
  import { CheckIcon } from "phosphor-svelte";
  import { VERSION_CODES, VERSION_NUMBERS, type VersionCode } from "./importEdit";
  import { CHOICE_ROW, POPOVER_CARD, SHEET_SMALL } from "./sheetLayout";

  let {
    code,
    number,
    trigger,
    onPick,
  }: {
    code: VersionCode | undefined;
    number: number | undefined;
    trigger: Snippet<[{ props: Record<string, unknown> }]>;
    onPick: (version: { code: VersionCode; number: number }) => void;
  } = $props();

  let open = $state(false);
  let stage = $state<VersionCode>("T");
  $effect.pre(() => {
    if (open) stage = code ?? "T";
  });

  function pickNumber(value: number) {
    open = false;
    if (stage === code && value === number) return;
    onPick({ code: stage, number: value });
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      {@render trigger({ props })}
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content side="bottom" align="start" sideOffset={4} collisionPadding={12} class={`${POPOVER_CARD} w-[13.5rem] p-1.5`} data-import-version-menu>
      <p class={`px-2 pb-1 pt-1 ${SHEET_SMALL} text-ink-muted`}>Stage</p>
      <div role="group" aria-label="Stage" class="flex flex-col">
        {#each VERSION_CODES as entry (entry.code)}
          <button
            type="button"
            aria-pressed={stage === entry.code}
            data-import-version-code={entry.code}
            onclick={() => (stage = entry.code)}
            class={CHOICE_ROW}
          >
            <span class="min-w-0 flex-1">{entry.label}</span>
            {#if stage === entry.code}<CheckIcon size="0.875rem" aria-hidden="true" class="shrink-0 text-primary-selected" />{/if}
          </button>
        {/each}
      </div>
      <div class="mx-1 my-1.5 h-px bg-line-soft" aria-hidden="true"></div>
      <p class={`px-2 pb-1 ${SHEET_SMALL} text-ink-muted`}>Number</p>
      <div role="group" aria-label="Number" class="grid grid-cols-9 gap-0.5 px-1 pb-1">
        {#each VERSION_NUMBERS as value (value)}
          {@const now = stage === code && value === number}
          <button
            type="button"
            aria-label={`${stage}${value}`}
            aria-pressed={now}
            data-import-version-number={value}
            onclick={() => pickNumber(value)}
            class={`flex h-7 items-center justify-center rounded-md text-[0.8125rem] leading-[calc(18/13)] tabular-nums outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11 ${now ? "bg-primary-selected text-white" : "text-ink hover:bg-primary-wash"}`}
          >{value}</button>
        {/each}
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

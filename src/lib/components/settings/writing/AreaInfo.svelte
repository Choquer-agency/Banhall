<script lang="ts">
  // 2026-10-19 meeting: the "i" beside each Writing preferences area. A
  // bits-ui Popover: a click, a tap, Enter or Space opens it; Escape or a
  // click outside closes it and focus goes back to the button. It says what
  // the house rule checks, gives one example and says what the area's switch
  // changes. The copy is STYLE_OVERRIDE_META, shared with the admin pages.
  import { Popover } from "bits-ui";
  import { IconInfo } from "$lib/components/icons";
  import type { WritingArea } from "$lib/settings/writingAreas";
  import { houseRuleModeNote, type HouseRuleMode } from "../../../../../shared/styleOverrides";

  let { area, mode }: { area: WritingArea; mode: HouseRuleMode } = $props();

  const uid = $props.id();
  const titleId = `area-info-${uid}`;
  const note = $derived(houseRuleModeNote(mode));
</script>

<Popover.Root>
  <Popover.Trigger
    data-area-info={area.key}
    aria-label={`About ${area.label}`}
    class="relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-faint transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:text-ink motion-reduce:transition-none pointer-coarse:before:absolute pointer-coarse:before:-inset-3.5 pointer-coarse:before:content-['']"
  >
    <IconInfo size={14} strokeWidth={1.8} />
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      data-area-info-panel={area.key}
      role="dialog"
      aria-labelledby={titleId}
      side="bottom"
      align="start"
      sideOffset={6}
      collisionPadding={16}
      class="z-[110] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2.5 rounded-xl border border-line bg-surface p-4 shadow-md outline-none"
    >
      <p id={titleId} class="text-sm leading-5 font-medium text-ink">{area.label}</p>
      <dl class="flex flex-col gap-2.5">
        <div class="flex flex-col gap-0.5">
          <dt class="text-xs leading-4 font-medium text-ink-muted">House rule</dt>
          <dd data-area-info-rule class="text-[0.8125rem] leading-5 text-ink-secondary">{area.houseRule}</dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="text-xs leading-4 font-medium text-ink-muted">Example</dt>
          <dd data-area-info-example class="text-[0.8125rem] leading-5 text-ink-secondary">{area.example}</dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="text-xs leading-4 font-medium text-ink-muted">When your switch is on</dt>
          <dd data-area-info-on class="text-[0.8125rem] leading-5 text-ink-secondary">{area.whenOn}</dd>
        </div>
      </dl>
      {#if note}
        <p data-area-info-mode class="border-t border-line-soft pt-2.5 text-xs leading-4 text-ink-muted">{note}</p>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

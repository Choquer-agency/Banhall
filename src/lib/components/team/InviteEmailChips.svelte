<script lang="ts">
  // C3 "Email addresses": commas, spaces, Enter and paste turn text into
  // chips; an invalid address becomes a danger chip with "Check this
  // address"; duplicates collapse; Backspace in an empty field removes the
  // last chip.
  import { XIcon } from "phosphor-svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { addChips, splitEmails, type EmailChip } from "$lib/team/inviteEmails";

  let {
    chips = $bindable([]),
    id = "invite-emails",
    disabled = false,
  }: { chips?: EmailChip[]; id?: string; disabled?: boolean } = $props();

  let draft = $state("");
  let input: HTMLInputElement | undefined = $state();

  function commit(text = draft) {
    const values = splitEmails(text);
    if (values.length) chips = addChips(chips, values);
    draft = "";
  }

  /** Called by the dialog before sending, so a typed but uncommitted address counts. */
  export function flush() {
    commit();
  }

  function remove(index: number) {
    chips = chips.filter((_, i) => i !== index);
    input?.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === "," || event.key === " " || event.key === ";") {
      if (draft.trim()) {
        event.preventDefault();
        commit();
      } else if (event.key !== "Enter") {
        event.preventDefault();
      }
    } else if (event.key === "Backspace" && draft === "" && chips.length) {
      chips = chips.slice(0, -1);
    }
  }

  function onpaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData("text") ?? "";
    if (!/[\s,;]/.test(text.trim())) return;
    event.preventDefault();
    commit(draft + text);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  data-invite-email-chips
  onclick={() => input?.focus()}
  class="flex min-h-11 cursor-text flex-wrap items-center gap-1.5 rounded-[10px] border-[1.5px] border-line bg-surface p-2 focus-within:border-primary-selected"
>
  {#each chips as chip, index (chip.value)}
    {#if chip.valid}
      <span data-email-chip="valid" class="flex h-7 items-center gap-1.5 rounded-md bg-chrome pl-2.5 pr-1.5 text-[13px] leading-[18px] text-ink">
        {chip.value}
        <button type="button" {disabled} aria-label={`Remove ${chip.value}`} onclick={(event) => { event.stopPropagation(); remove(index); }} class="flex h-4 w-4 items-center justify-center rounded text-ink-muted hover:text-ink">
          <XIcon size={14} aria-hidden="true" />
        </button>
      </span>
    {:else}
      <Tooltip text="Check this address" delayDuration={200}>
        {#snippet children({ props })}
          <span {...props} data-email-chip="invalid" tabindex="-1" class="flex h-7 items-center gap-1.5 rounded-md bg-danger-soft pl-2.5 pr-1.5 text-[13px] leading-[18px] text-danger-ink">
            {chip.value}
            <span class="sr-only">Check this address</span>
            <button type="button" {disabled} aria-label={`Remove ${chip.value}`} onclick={(event) => { event.stopPropagation(); remove(index); }} class="flex h-4 w-4 items-center justify-center rounded text-danger-ink hover:text-danger-ink-muted">
              <XIcon size={14} aria-hidden="true" />
            </button>
          </span>
        {/snippet}
      </Tooltip>
    {/if}
  {/each}
  <input
    bind:this={input}
    {id}
    {disabled}
    type="text"
    inputmode="email"
    autocomplete="off"
    spellcheck="false"
    bind:value={draft}
    {onkeydown}
    {onpaste}
    onblur={() => commit()}
    placeholder={chips.length ? "Add more, separate with commas" : "name@banhall.com, separate with commas"}
    class="h-7 min-w-[12rem] flex-1 border-0 bg-transparent pl-1 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:ring-0"
  />
</div>

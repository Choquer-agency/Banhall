<script lang="ts">
  import { onMount, tick } from "svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { SOMETHING_ELSE } from "$lib/chat/writerQuestion";

  /**
   * Owner 2026-10-28 (Paper row 37): numbered options that take the message
   * box's place. "Assistant needs you" when the AI asks a question; "Get
   * started" for a new conversation. The last option, "Something else…",
   * turns into a text field for the writer's own answer. Picking an option
   * sends it at once. Up and down move, a number picks, Enter selects, Esc
   * skips back to the message box. With `onType` (owner 2026-10-29, "Get
   * started" in every new conversation), typing goes back to the message box
   * with what was typed, digits included, so a message that starts with a
   * number never picks an option; number picks stay on the AI's question.
   */
  interface Props {
    label: string;
    question: string;
    options: string[];
    disabled?: boolean;
    onSelect: (text: string) => void;
    onSkip: () => void;
    onType?: (text: string) => void;
  }

  let { label, question, options, disabled = false, onSelect, onSkip, onType }: Props = $props();

  const componentId = $props.id();
  const questionId = `${componentId}-question`;
  const rows = $derived([...options, SOMETHING_ELSE]);
  const otherIndex = $derived(rows.length - 1);
  let active = $state(0);
  let typing = $state(false);
  let ownAnswer = $state("");
  let listEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  // Take the keyboard only from the message box this panel replaces, or from
  // nowhere: never from the report or anything else the writer is using.
  onMount(() => {
    const active = document.activeElement;
    const free = !active || active === document.body || !!active.closest?.("[data-assistant-panel]");
    if (free) listEl?.focus({ preventScroll: true });
  });

  async function choose(index: number) {
    if (disabled) return;
    active = index;
    if (index === otherIndex) {
      typing = true;
      await tick();
      inputEl?.focus();
      return;
    }
    onSelect(rows[index]);
  }

  function sendOwn() {
    const text = ownAnswer.trim();
    if (!text || disabled) return;
    onSelect(text);
  }

  function onListKeydown(event: KeyboardEvent) {
    // Keys typed into the "Something else…" field are the writer's words.
    if (event.defaultPrevented || event.target === inputEl) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = (active + step + rows.length) % rows.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      void choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onSkip();
    } else if (onType && typed(event)) {
      // A printable key lands in the message box. Space, a dead key or an
      // input method's first key only moves there, so the next keys type.
      const printable = event.key.length === 1 && event.key !== " " && !event.isComposing;
      if (printable) event.preventDefault();
      onType(printable ? event.key : "");
    } else if (/^[1-9]$/.test(event.key) && Number(event.key) <= rows.length) {
      event.preventDefault();
      void choose(Number(event.key) - 1);
    }
  }

  /** A key that writes text: not a shortcut (AltGr and Option still type). */
  function typed(event: KeyboardEvent): boolean {
    if (event.metaKey || (event.ctrlKey && !event.getModifierState?.("AltGraph"))) return false;
    return event.key.length === 1 || event.key === "Dead" || event.key === "Process" || event.isComposing;
  }

  function onInputKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendOwn();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      typing = false;
      ownAnswer = "";
      listEl?.focus();
    }
  }
</script>

<div class="flex flex-col rounded-2xl border border-primary-line bg-primary-wash px-1 pb-1" data-composer-options>
  <div class="flex h-[2.375rem] shrink-0 items-center gap-2 px-2">
    <AuroraMark size={20} />
    <span class="text-[0.8125rem] font-medium leading-[calc(18/13)] text-primary-selected">{label}</span>
  </div>
  <div class="flex flex-col rounded-xl border border-primary-line-soft bg-white">
    <p id={questionId} class="px-3.5 pb-1.5 pt-3 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{question}</p>
    <div bind:this={listEl} role="listbox" tabindex="0" aria-labelledby={questionId}
      aria-activedescendant={`${componentId}-option-${active}`}
      class="flex flex-col gap-0.5 px-1.5 pb-1.5 outline-none" onkeydown={onListKeydown}>
      {#each rows as option, index (index)}
        {@const selected = index === active}
        <div id={`${componentId}-option-${index}`} role="option" aria-selected={selected} tabindex="-1"
          class="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg p-2 {selected ? 'bg-gray-50' : 'hover:bg-gray-50'} pointer-coarse:min-h-11"
          onclick={() => void choose(index)}
          onkeydown={() => {}}
          onmouseenter={() => { if (!typing) active = index; }}
          data-composer-option>
          <span class="flex size-[1.375rem] shrink-0 items-center justify-center rounded-md text-xs leading-[calc(4/3)] text-ink-muted {selected ? 'border border-line-soft bg-white' : 'bg-gray-50'}" aria-hidden="true">{index + 1}</span>
          {#if index === otherIndex && typing}
            <input bind:this={inputEl} bind:value={ownAnswer} onkeydown={onInputKeydown} {disabled}
              aria-label="Your own answer" placeholder={SOMETHING_ELSE}
              class="input-chromeless min-w-0 flex-1 bg-transparent text-sm leading-[calc(10/7)] text-ink outline-none placeholder:text-ink-faint" />
          {:else}
            <span class="min-w-0 flex-1 text-sm leading-[calc(10/7)] {index === otherIndex ? 'text-ink-faint' : 'text-ink'}">{option}</span>
          {/if}
        </div>
      {/each}
    </div>
    <div class="flex h-10 shrink-0 items-center gap-1.5 border-t border-line-soft pl-3.5 pr-2.5">
      <button type="button" class="flex items-center gap-1.5 rounded-md text-xs leading-[calc(4/3)] text-ink-muted hover:text-ink pointer-coarse:min-h-11" onclick={onSkip} data-composer-options-skip>
        Skip
        <span class="inline-flex h-5 items-center rounded-[0.3125rem] bg-gray-50 px-1.5" aria-hidden="true">esc</span>
      </button>
      <span class="flex-1"></span>
      <button type="button" class="flex items-center gap-1.5 rounded-md text-xs leading-[calc(4/3)] text-ink-muted hover:text-ink disabled:opacity-50 pointer-coarse:min-h-11"
        {disabled} onclick={() => (typing ? sendOwn() : void choose(active))} data-composer-options-select>
        Select
        <span class="inline-flex h-5 w-6 items-center justify-center rounded-[0.3125rem] bg-gray-50" aria-hidden="true">
          <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4v7a4 4 0 0 1-4 4H4M9 10l-5 5 5 5" /></svg>
        </span>
      </button>
    </div>
  </div>
</div>

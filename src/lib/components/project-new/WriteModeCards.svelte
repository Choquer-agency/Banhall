<script lang="ts" module>
  export type WriteMode = "iterative" | "single" | "compare";

  export const WRITE_MODES: ReadonlyArray<{
    id: WriteMode;
    label: string;
    description: string;
    shortDescription: string;
    recommended?: boolean;
  }> = [
    {
      id: "iterative",
      label: "Step by step",
      description: "Pick the ideas first. We write after.",
      shortDescription: "Pick the ideas first. We write after.",
      recommended: true,
    },
    {
      id: "single",
      label: "Single draft",
      description: "One full draft, straight to the editor.",
      shortDescription: "One full draft",
    },
    {
      id: "compare",
      label: "Compare two drafts",
      description: "Two drafts. You keep the better one.",
      shortDescription: "Two drafts, keep one",
    },
  ];
</script>

<script lang="ts">
  /**
   * "How should we write it?" (boards E1, H1, H2): three radio cards. The
   * selected card takes a 1.5px lagoon border, the #F7FCFB fill and the
   * filled radio. `layout="row"` is the tablet strip (H1): no radio dot, the
   * short descriptions in 12px muted ink. `layout="phone"` (H2) stacks the
   * cards and shows the description on the selected card only.
   */
  let {
    value = $bindable<WriteMode>("iterative"),
    layout = "stack",
  }: {
    value?: WriteMode;
    layout?: "stack" | "row" | "phone";
  } = $props();

  function onKeydown(event: KeyboardEvent, index: number) {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const next = WRITE_MODES[(index + step + WRITE_MODES.length) % WRITE_MODES.length];
    value = next.id;
    const group = (event.currentTarget as HTMLElement).parentElement;
    group?.querySelector<HTMLElement>(`[data-write-mode="${next.id}"]`)?.focus();
  }

  const row = $derived(layout === "row");
</script>

<div
  role="radiogroup"
  aria-label="Draft generation mode"
  data-write-mode-cards
  class={row ? "grid grid-cols-3 gap-2.5" : "flex flex-col gap-3"}
>
  {#each WRITE_MODES as mode, index (mode.id)}
    {@const selected = value === mode.id}
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabindex={selected ? 0 : -1}
      data-write-mode={mode.id}
      onclick={() => (value = mode.id)}
      onkeydown={(event) => onKeydown(event, index)}
      class={`flex w-full rounded-[10px] py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11 ${
        row ? "flex-col gap-1 px-3.5" : "gap-2.5 pr-3.5 pl-3"
      } ${
        selected
          ? "border-[1.5px] border-primary-selected bg-write-mode-selected"
          : "border border-line bg-surface hover:bg-primary-wash"
      }`}
    >
      {#if !row}
        <span class="flex pt-0.5" aria-hidden="true">
          <span
            data-write-mode-radio
            class={`size-4 shrink-0 rounded-full bg-surface ${
              selected ? "border-[5px] border-primary-selected" : "border-[1.5px] border-line"
            }`}
          ></span>
        </span>
      {/if}
      <span class={row ? "contents" : "flex min-w-0 flex-1 flex-col gap-0.5"}>
        <span class={`flex flex-wrap items-center ${row ? "gap-1.5" : "gap-2"}`}>
          <span class="text-sm leading-5 font-medium text-ink">{mode.label}</span>
          {#if mode.recommended}
            <span
              data-recommended
              class={`flex items-center rounded-[5px] bg-recommended px-1.5 text-[11px] font-medium text-recommended-ink ${
                row ? "h-[18px] leading-[14px]" : "h-5 leading-4"
              }`}
            >
              Recommended
            </span>
          {/if}
        </span>
        {#if row}
          <span data-write-mode-description class="text-xs leading-4 text-ink-muted">{mode.shortDescription}</span>
        {:else if layout === "stack" || selected}
          <span data-write-mode-description class="text-[13px] leading-[18px] text-ink-secondary">{mode.description}</span>
        {/if}
      </span>
    </button>
  {/each}
</div>

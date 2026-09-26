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
      shortDescription: "Pick the ideas first",
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
   * "How should we write it?" (board E1): three radio cards. The selected
   * card takes a 1.5px lagoon border and the filled radio. `layout="row"` is
   * the tablet strip (H1) with the short descriptions.
   */
  let {
    value = $bindable<WriteMode>("iterative"),
    layout = "stack",
  }: {
    value?: WriteMode;
    layout?: "stack" | "row";
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
</script>

<div
  role="radiogroup"
  aria-label="Draft generation mode"
  data-write-mode-cards
  class={layout === "row" ? "grid grid-cols-3 gap-3" : "flex flex-col gap-3"}
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
      class={`flex min-h-16 w-full gap-2.5 rounded-[10px] py-3 pr-3.5 pl-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11 ${
        selected
          ? "border-[1.5px] border-primary-selected bg-primary-wash"
          : "border border-line bg-surface hover:bg-primary-wash"
      }`}
    >
      <span class="flex pt-0.5" aria-hidden="true">
        <span
          class={`size-4 shrink-0 rounded-full bg-surface ${
            selected ? "border-[5px] border-primary-selected" : "border-[1.5px] border-line"
          }`}
        ></span>
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex flex-wrap items-center gap-2">
          <span class="text-sm leading-5 font-medium text-ink">{mode.label}</span>
          {#if mode.recommended}
            <span data-recommended class="flex h-5 items-center rounded-[5px] bg-recommended px-1.5 text-xs leading-4 font-medium text-recommended-ink">
              Recommended
            </span>
          {/if}
        </span>
        <span class="text-[13px] leading-[18px] text-ink-secondary">
          {layout === "row" ? mode.shortDescription : mode.description}
        </span>
      </span>
    </button>
  {/each}
</div>

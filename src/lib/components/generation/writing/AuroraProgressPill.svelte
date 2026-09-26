<script lang="ts">
  /**
   * The Aurora progress pill (ui-design-final.md section 6, board F2): a
   * rounded pill whose 2px border fills left to right in the Aurora gradient
   * over the grey track, with a small glint travelling to the leading edge.
   * Shared by the writing pill (SeedDraftingView) and "Reading the interview".
   * The host owns the forward-only percent and the content.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    percent,
    progressLabel,
    valueText,
    shadow = "var(--shadow-toast-soft), 0 0 14px #8438FF29",
    innerClass = "h-[42px] gap-3 pl-3 pr-[5px]",
    element = $bindable(null),
    class: className = "",
    children,
    ...rest
  }: {
    /** 0 to 100; the host keeps it moving forward only. */
    percent: number;
    /** Accessible name of the progress bar. */
    progressLabel: string;
    valueText?: string;
    shadow?: string;
    /** Size and padding of the white inner pill. */
    innerClass?: string;
    element?: HTMLElement | null;
    class?: string;
    children: Snippet;
  } & Omit<HTMLAttributes<HTMLDivElement>, "children" | "class"> = $props();

  const TRACK = "var(--aurora-track)";
</script>

<div
  bind:this={element}
  {...rest}
  class={`relative overflow-hidden rounded-full p-[2px] outline-none ${className}`}
  style={`background:${TRACK};box-shadow:${shadow}`}
>
  <!-- Border progress: the Aurora fill scales from the left edge. -->
  <span
    data-pill-progress
    role="progressbar"
    aria-label={progressLabel}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(percent)}
    aria-valuetext={valueText}
    class="absolute inset-0 origin-left transition-transform duration-500 ease-out motion-reduce:transition-none"
    style={`background:var(--aurora-linear);transform:scaleX(${percent / 100})`}
  ></span>
  <!-- Glint travelling to the leading edge. -->
  <span
    aria-hidden="true"
    class="absolute inset-0 transition-transform duration-500 ease-out motion-reduce:transition-none"
    style={`transform:translateX(${percent - 100}%)`}
  >
    <span class="absolute inset-y-0 right-0 w-12 overflow-hidden">
      <span
        data-pill-glint
        class="aurora-glint block h-full w-full"
        style="background:linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.95))"
      ></span>
    </span>
  </span>
  <div class={`relative flex items-center rounded-full bg-surface ${innerClass}`}>
    {@render children()}
  </div>
</div>

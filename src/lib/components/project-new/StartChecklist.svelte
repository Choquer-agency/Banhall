<script lang="ts">
  /**
   * "Before you start" (boards E1, E5, E6): the checklist, the start button
   * and the line under it. A blocking row disables the button. Row actions
   * ("Fix", "Check") scroll the page to what needs attention.
   *
   * `variant="plain"` is Review a written PD (E4): no box and no heading,
   * a 36px full-width start button without the arrow, and only the rows that
   * block the start or flag a problem, so a disabled start always says why.
   */
  import { IconAlertCircle, IconArrowRight, IconCheckCircle, IconClock } from "$lib/components/icons";
  import type { ChecklistRow } from "./newProjectChecklist";
  import { startBlocked } from "./newProjectChecklist";

  let {
    rows,
    startLabel,
    busy = false,
    busyLabel = null,
    note,
    onStart,
    onAction,
    startButton = $bindable(null),
    variant = "box",
  }: {
    rows: ChecklistRow[];
    startLabel: string;
    busy?: boolean;
    /** Replaces the note while a start is under way ("Reading X, then starting..."). */
    busyLabel?: string | null;
    note: string;
    onStart: () => void;
    onAction: (target: string) => void;
    startButton?: HTMLButtonElement | null;
    variant?: "box" | "plain";
  } = $props();

  const blocked = $derived(startBlocked(rows));
  const plain = $derived(variant === "plain");
  // Plain (E4) keeps only what stops the start or needs a look.
  const shownRows = $derived(
    plain ? rows.filter((row) => row.blocking || row.state === "danger" || row.state === "warning") : rows
  );

  const iconColor: Record<ChecklistRow["state"], string> = {
    done: "text-success",
    pending: "text-ink-faint",
    reading: "text-ink-faint",
    danger: "text-danger",
    warning: "text-warning",
  };
  const actionColor: Record<ChecklistRow["state"], string> = {
    done: "text-ink",
    pending: "text-ink",
    reading: "text-ink",
    danger: "text-danger-ink-muted",
    warning: "text-warning-ink-muted",
  };
</script>

<div
  data-start-checklist={variant}
  class={plain
    ? "flex flex-col gap-2"
    : "flex flex-col gap-3.5 rounded-[14px] border border-line-soft bg-surface p-[18px]"}
>
  {#if !plain}
    <p class="text-xs leading-4 font-medium text-ink-muted">Before you start</p>
  {/if}
  {#if shownRows.length}
    <ul class="flex flex-col gap-1.5">
      {#each shownRows as row (row.id)}
        <li data-checklist-row={row.id} data-state={row.state} class="flex min-h-7 items-center gap-2.5">
          {#if row.state === "done"}
            <IconCheckCircle size={16} strokeWidth={1.8} class={`shrink-0 ${iconColor.done}`} />
          {:else if row.state === "danger" || row.state === "warning"}
            <IconAlertCircle size={16} strokeWidth={1.8} class={`shrink-0 ${iconColor[row.state]}`} />
          {:else}
            <IconClock size={16} strokeWidth={1.8} class={`shrink-0 ${iconColor[row.state]}`} />
          {/if}
          <span
            class={`min-w-0 flex-1 text-[13px] leading-[19px] ${
              row.state === "danger" || row.state === "warning"
                ? "text-ink"
                : row.state === "pending" || row.state === "reading"
                  ? "text-ink-muted"
                  : "text-ink-secondary"
            }`}
          >
            <span class="sr-only">{row.state === "done" ? "Done: " : row.state === "danger" ? "Problem: " : row.state === "warning" ? "Check: " : "To do: "}</span>{row.text}
          </span>
          {#if row.action}
            <button
              type="button"
              data-checklist-action={row.action.target}
              onclick={() => onAction(row.action!.target)}
              class={`shrink-0 rounded px-1 text-[13px] leading-[18px] font-medium hover:underline focus-visible:outline-2 focus-visible:outline-fir pointer-coarse:min-h-11 ${actionColor[row.state]}`}
            >
              {row.action.label}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <button
    type="button"
    bind:this={startButton}
    data-start-button
    disabled={blocked || busy}
    onclick={onStart}
    class={`flex shrink-0 items-center justify-center gap-2 bg-fir text-sm leading-5 font-medium text-white transition-colors hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fir focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
      plain ? "h-9 w-full rounded-lg px-4" : "mt-1 h-[42px] rounded-[10px]"
    }`}
  >
    {startLabel}
    {#if !plain}<IconArrowRight size={14} strokeWidth={1.8} />{/if}
  </button>
  <p
    data-start-note
    role={busyLabel ? "status" : undefined}
    class={`text-center text-xs text-ink-muted ${plain ? "leading-4" : "leading-[17px]"}`}
  >{busyLabel ?? note}</p>
</div>

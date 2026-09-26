<script lang="ts">
  /**
   * "Before you start" (boards E1, E5, E6): the checklist, the start button
   * and the line under it. A blocking row disables the button. Row actions
   * ("Fix", "Check") scroll the page to what needs attention.
   */
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
  } = $props();

  const blocked = $derived(startBlocked(rows));

  const iconColor: Record<ChecklistRow["state"], string> = {
    done: "var(--color-success)",
    pending: "var(--color-ink-faint)",
    reading: "var(--color-ink-faint)",
    danger: "var(--color-danger)",
    warning: "var(--color-warning)",
  };
  const actionColor: Record<ChecklistRow["state"], string> = {
    done: "text-ink",
    pending: "text-ink",
    reading: "text-ink",
    danger: "text-danger-ink-muted",
    warning: "text-warning-ink-muted",
  };
</script>

<div data-start-checklist class="flex flex-col gap-3.5 rounded-[14px] border border-line-soft bg-surface p-[18px]">
  <p class="text-xs leading-4 font-medium text-ink-muted">Before you start</p>
  <ul class="flex flex-col gap-1.5">
    {#each rows as row (row.id)}
      <li data-checklist-row={row.id} data-state={row.state} class="flex min-h-7 items-center gap-2.5">
        <svg width="16" height="16" viewBox="0 0 24 24" class="shrink-0" aria-hidden="true">
          {#if row.state === "done"}
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M8.5 12.3l2.4 2.4 4.6-4.9" fill="none" stroke={iconColor.done} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          {:else if row.state === "danger" || row.state === "warning"}
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7.5v5.5 M12 16.3v.2" fill="none" stroke={iconColor[row.state]} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          {:else}
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2" fill="none" stroke={iconColor[row.state]} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          {/if}
        </svg>
        <span
          class={`min-w-0 flex-1 text-[13px] leading-[19px] ${
            row.state === "danger"
              ? "text-danger-ink"
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
            class={`shrink-0 rounded px-1 text-[13px] leading-[19px] font-medium hover:underline focus-visible:outline-2 focus-visible:outline-fir pointer-coarse:min-h-11 ${actionColor[row.state]}`}
          >
            {row.action.label}
          </button>
        {/if}
      </li>
    {/each}
  </ul>
  <button
    type="button"
    bind:this={startButton}
    data-start-button
    disabled={blocked || busy}
    onclick={onStart}
    class="mt-1 flex h-[42px] shrink-0 items-center justify-center gap-2 rounded-[10px] bg-fir text-sm leading-5 font-medium text-white transition-colors hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fir focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
  >
    {startLabel}
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15 M13.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
  <p data-start-note role={busyLabel ? "status" : undefined} class="text-center text-xs leading-[17px] text-ink-muted">{busyLabel ?? note}</p>
</div>

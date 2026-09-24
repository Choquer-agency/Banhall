<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PdSubsectionRoleId } from "../../../../shared/pdSubsections";
  import type { SeedOutlineRow } from "./types";

  let {
    rows,
    activeRoleId,
    onOpen,
    usageNotice = null,
    footer,
  }: {
    rows: SeedOutlineRow[];
    activeRoleId: PdSubsectionRoleId;
    onOpen: (roleId: PdSubsectionRoleId) => void;
    /** Quiet usage note when the run has used many seed requests. */
    usageNotice?: string | null;
    /** The step's approval actions, pinned below the list. */
    footer?: Snippet;
  } = $props();

  const sections: Array<{ id: SeedOutlineRow["section"]; label: string }> = [
    { id: "s242", label: "242" },
    { id: "s244", label: "244" },
    { id: "s246", label: "246" },
  ];

  // A step is decided once it is approved or skipped; the ring and "n of 13"
  // count decided steps only.
  const decided = $derived(rows.filter((row) => row.state === "approved" || row.state === "skipped").length);
  const total = $derived(rows.length);
  const RING = 2 * Math.PI * 6;

  type RowIcon = "untouched" | "optional" | "open" | "approved" | "skipped" | "generating" | "failed";

  function iconOf(row: SeedOutlineRow): RowIcon {
    switch (row.state) {
      case "approved":
        return "approved";
      case "skipped":
        return "skipped";
      case "generating":
        return "generating";
      case "failed":
        return "failed";
      case "in_progress":
        return "open";
      default:
        return row.kind === "optional" ? "optional" : "untouched";
    }
  }

  // The accessible state of a row. A count read within the server's safe
  // processing limit is a lower bound, never presented as definitive (A4).
  function stateText(row: SeedOutlineRow) {
    const parts: string[] = [];
    switch (row.state) {
      case "approved":
        parts.push("approved");
        break;
      case "skipped":
        parts.push("skipped");
        break;
      case "generating":
        parts.push("writing seeds");
        break;
      case "failed":
        parts.push("seeds failed");
        break;
      case "in_progress":
        parts.push("open");
        break;
      default:
        parts.push(row.kind === "optional" ? "optional, not started" : "not started");
    }
    if (row.stale) parts.push("stale");
    else if (row.outdated) parts.push("outdated");
    if (row.selectedCount > 0 && row.state !== "skipped") {
      parts.push(
        row.countsComplete
          ? `${row.selectedCount} selected`
          : `at least ${row.selectedCount} selected, partial read`
      );
    }
    return parts.join(", ");
  }

  function countText(row: SeedOutlineRow) {
    if (row.selectedCount === 0 || row.state === "skipped") return "";
    return row.countsComplete ? String(row.selectedCount) : `${row.selectedCount}+`;
  }
</script>

{#snippet stateIcon(kind: RowIcon, active: boolean)}
  <span class="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true" data-row-icon={kind}>
    {#if kind === "approved"}
      <svg viewBox="0 0 16 16" class="size-4"><circle cx="8" cy="8" r="7" fill="var(--color-primary-selected)" /><path d="M5 8.2 7 10.2 11 6" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    {:else if kind === "open"}
      <svg viewBox="0 0 16 16" class="size-4"><circle cx="8" cy="8" r="6.25" fill="none" stroke={active ? "var(--color-primary-selected)" : "var(--color-gray-400)"} stroke-width="1.5" /><circle cx="8" cy="8" r="2.5" fill={active ? "var(--color-primary-selected)" : "var(--color-gray-400)"} /></svg>
    {:else if kind === "optional"}
      <svg viewBox="0 0 16 16" class="size-4"><circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--color-gray-300)" stroke-width="1.5" stroke-dasharray="2.2 2.2" /></svg>
    {:else if kind === "skipped"}
      <svg viewBox="0 0 16 16" class="size-4"><circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--color-gray-300)" stroke-width="1.5" stroke-dasharray="2.2 2.2" /><path d="M5.5 8h5" stroke="var(--color-gray-400)" stroke-width="1.5" stroke-linecap="round" /></svg>
    {:else if kind === "generating"}
      <svg viewBox="0 0 16 16" class="aurora-spin size-4"><circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--color-gray-200)" stroke-width="1.5" /><path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="var(--color-primary)" stroke-width="1.5" stroke-linecap="round" /></svg>
    {:else if kind === "failed"}
      <svg viewBox="0 0 16 16" class="size-4"><circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--color-gap-text)" stroke-width="1.5" /><path d="M8 4.8v3.6" stroke="var(--color-gap-text)" stroke-width="1.5" stroke-linecap="round" /><circle cx="8" cy="10.9" r="0.9" fill="var(--color-gap-text)" /></svg>
    {:else}
      <svg viewBox="0 0 16 16" class="size-4"><circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--color-gray-300)" stroke-width="1.5" /></svg>
    {/if}
  </span>
{/snippet}

<aside aria-label="Seed outline" class="flex h-full min-h-0 flex-col bg-surface">
  <header class="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-5">
    <h2 class="text-sm font-medium text-ink">Outline</h2>
    <span class="inline-flex items-center gap-2 text-xs text-ink-secondary" data-outline-progress={`${decided}/${total}`}>
      <svg viewBox="0 0 16 16" class="size-4 -rotate-90" aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-gray-200)" stroke-width="1.75" />
        {#if decided > 0}
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="var(--color-primary)"
            stroke-width="1.75"
            stroke-linecap={decided < total ? "round" : "butt"}
            stroke-dasharray={`${(decided / total) * RING} ${RING}`}
          />
        {/if}
      </svg>
      <span>{decided} of {total}</span>
    </span>
  </header>
  {#if usageNotice}
    <p class="mx-5 mb-1 w-fit rounded-full bg-gap-bg px-2 py-0.5 text-xs text-gap-text!">{usageNotice}</p>
  {/if}
  <nav aria-label="PD subsections" class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
    {#each sections as section (section.id)}
      <p class="px-2 pb-1.5 pt-4 text-xs text-ink-faint">{section.label}</p>
      {#each rows.filter((row) => row.section === section.id) as row (row.roleId)}
        {@const active = row.roleId === activeRoleId}
        {@const kind = iconOf(row)}
        {@const count = countText(row)}
        <button
          type="button"
          aria-current={active ? "step" : undefined}
          onclick={() => onOpen(row.roleId)}
          data-row-state={row.state}
          class={`mb-0.5 flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary motion-reduce:transition-none pointer-coarse:h-11 ${
            active ? "bg-primary-wash" : "hover:bg-gray-50"
          }`}
        >
          {@render stateIcon(kind, active)}
          <span
            class={`min-w-0 flex-1 truncate text-sm ${
              active ? "font-medium text-ink" : row.state === "skipped" ? "text-ink-faint" : "text-ink-secondary"
            }`}
          >{row.title}</span>
          <span class="sr-only">, {stateText(row)}</span>
          {#if row.stale || row.outdated}
            <span class="inline-flex shrink-0 items-center gap-1 text-xs text-gap-text!" aria-hidden="true" data-row-marker={row.stale ? "stale" : "outdated"}>
              <span class="size-1.5 rounded-full bg-gap-text"></span>{row.stale ? "stale" : "outdated"}
            </span>
          {:else if count}
            <span
              class="shrink-0 text-xs text-ink-faint"
              aria-hidden="true"
              data-counts-complete={row.countsComplete}
            >{count}</span>
          {/if}
        </button>
      {/each}
    {/each}
  </nav>
  {#if footer}
    <div class="shrink-0 border-t border-line-soft px-5 py-4" data-outline-footer>
      {@render footer()}
    </div>
  {/if}
</aside>

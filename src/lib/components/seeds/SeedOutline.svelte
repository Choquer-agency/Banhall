<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PdSubsectionRoleId } from "../../../../shared/pdSubsections";
  import type { SeedOutlineRow } from "./types";
  import { seedProgress } from "./seedProgress";

  let {
    rows,
    activeRoleId,
    onOpen,
    usageNotice = null,
    footer,
    expectedMs = 20_000,
    now = Date.now(),
  }: {
    rows: SeedOutlineRow[];
    activeRoleId: PdSubsectionRoleId;
    onOpen: (roleId: PdSubsectionRoleId) => void;
    /** Quiet usage note when the run has used many seed requests. */
    usageNotice?: string | null;
    /** The step's approval actions, pinned below the list. */
    footer?: Snippet;
    /** Round 2 (F3, F5): the run's batch pace and the host's clock. */
    expectedMs?: number;
    now?: number;
  } = $props();

  /** Estimated percent of a row whose batch is being written, else null. */
  function pendingPercent(row: SeedOutlineRow): number | null {
    const startedAt = (row as SeedOutlineRow & { pendingStartedAt?: number | null }).pendingStartedAt;
    if (!row.pendingBatchId || startedAt === null || startedAt === undefined) return null;
    return seedProgress(now, { status: "running", queuedAt: startedAt, startedAt }, expectedMs).percent;
  }

  function ringStyle(percent: number) {
    const p = Math.max(2, percent);
    return `background:conic-gradient(#2FD2C4 0%, #58BBF3 ${p * 0.35}%, #8438FF ${p * 0.72}%, #E879F9 ${p}%, var(--aurora-track) ${p}%, var(--aurora-track) 100%)`;
  }

  const sections: Array<{ id: SeedOutlineRow["section"]; label: string }> = [
    { id: "s242", label: "242" },
    { id: "s244", label: "244" },
    { id: "s246", label: "246" },
  ];

  // A step is decided once it is approved or skipped; the ring and "n of 13"
  // count decided steps only.
  const decided = $derived(rows.filter((row) => row.state === "approved" || row.state === "skipped").length);
  const total = $derived(rows.length);
  const RING = 2 * Math.PI * 9;

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
  <!-- 14px state marks (board 3.1): hairline rings in --color-line, a filled
       lagoon disc with a white check once approved. -->
  <span class="inline-flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true" data-row-icon={kind}>
    {#if kind === "approved"}
      <svg viewBox="0 0 14 14" class="size-3.5"><circle cx="7" cy="7" r="7" fill="var(--color-primary)" /><path d="M4.67 7 6.33 8.67 9.67 5.33" fill="none" stroke="white" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
    {:else if kind === "open"}
      <svg viewBox="0 0 14 14" class="size-3.5"><circle cx="7" cy="7" r="6.25" fill="none" stroke={active ? "var(--color-primary)" : "var(--color-gray-400)"} stroke-width="1.5" /><circle cx="7" cy="7" r="3" fill={active ? "var(--color-primary)" : "var(--color-gray-400)"} /></svg>
    {:else if kind === "optional"}
      <svg viewBox="0 0 14 14" class="size-3.5"><circle cx="7" cy="7" r="6.25" fill="none" stroke="var(--color-line)" stroke-width="1.5" stroke-dasharray="2 2" /></svg>
    {:else if kind === "skipped"}
      <svg viewBox="0 0 14 14" class="size-3.5"><circle cx="7" cy="7" r="6.25" fill="none" stroke="var(--color-line)" stroke-width="1.5" stroke-dasharray="2 2" /><path d="M4 7h6" stroke="var(--color-ink-faint)" stroke-width="1.5" /></svg>
    {:else if kind === "generating"}
      <svg viewBox="0 0 14 14" class="aurora-spin size-3.5"><circle cx="7" cy="7" r="6.25" fill="none" stroke="var(--color-line)" stroke-width="1.5" /><path d="M7 .75A6.25 6.25 0 0 1 13.25 7" fill="none" stroke="var(--color-primary)" stroke-width="1.5" stroke-linecap="round" /></svg>
    {:else if kind === "failed"}
      <svg viewBox="0 0 14 14" class="size-3.5"><circle cx="7" cy="7" r="6.25" fill="none" stroke="var(--color-gap-text)" stroke-width="1.5" /><path d="M7 4v3.2" stroke="var(--color-gap-text)" stroke-width="1.5" stroke-linecap="round" /><circle cx="7" cy="9.7" r="0.85" fill="var(--color-gap-text)" /></svg>
    {:else}
      <svg viewBox="0 0 14 14" class="size-3.5"><circle cx="7" cy="7" r="6.25" fill="none" stroke="var(--color-line)" stroke-width="1.5" /></svg>
    {/if}
  </span>
{/snippet}

<aside aria-label="Seed outline" class="flex h-full min-h-0 flex-col bg-surface">
  <header class="flex h-12 shrink-0 items-center gap-2 px-5">
    <h2 class="min-w-0 flex-1 text-[13px] leading-[18px] font-medium text-ink">Outline</h2>
    <span class="inline-flex h-[26px] items-center gap-1.5 px-1 text-[11px] leading-[14px] text-ink-secondary" data-outline-progress={`${decided}/${total}`}>
      <svg viewBox="0 0 24 24" class="size-5 -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-line-soft)" stroke-width="2.5" />
        {#if decided > 0}
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="var(--color-primary)"
            stroke-width="2.5"
            stroke-linecap={decided < total ? "round" : "butt"}
            stroke-dasharray={`${(decided / total) * RING} ${RING}`}
          />
        {/if}
      </svg>
      <span>{decided} of {total}</span>
    </span>
  </header>
  {#if usageNotice}
    <p class="mx-5 mb-1 w-fit rounded-full bg-gap-bg px-2 py-0.5 text-[11px] leading-[14px] text-gap-text!">{usageNotice}</p>
  {/if}
  <nav aria-label="PD subsections" class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-3 pb-3">
    {#each sections as section, sectionIndex (section.id)}
      <p class={`flex shrink-0 items-end px-2 pb-1.5 text-[11px] leading-[14px] text-ink-faint ${sectionIndex === 0 ? "h-7" : "h-8"}`}>{section.label}</p>
      {#each rows.filter((row) => row.section === section.id) as row (row.roleId)}
        {@const active = row.roleId === activeRoleId}
        {@const kind = iconOf(row)}
        {@const count = countText(row)}
        {@const writing = pendingPercent(row)}
        <button
          type="button"
          aria-current={active ? "step" : undefined}
          onclick={() => onOpen(row.roleId)}
          data-row-state={row.state}
          class={`flex h-[34px] w-full shrink-0 items-center gap-2.5 rounded-md px-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary motion-reduce:transition-none pointer-coarse:h-11 ${
            active ? "bg-primary-wash" : "hover:bg-gray-50"
          }`}
        >
          {#if writing !== null}
            <!-- Round 2 (F3, F5): a conic ring filled to the estimate. -->
            <span class="relative inline-flex size-3.5 shrink-0 items-center justify-center rounded-full" style={ringStyle(writing)} aria-hidden="true" data-row-icon="writing" data-row-percent={writing}>
              <span class="size-2.5 rounded-full bg-primary-wash"></span>
            </span>
          {:else}
            {@render stateIcon(kind, active)}
          {/if}
          <span
            class={`min-w-0 flex-1 truncate text-[13px] leading-[18px] ${
              active || writing !== null
                ? "font-medium text-ink"
                : row.state === "skipped"
                  ? "text-ink-faint"
                  : row.state === "approved"
                    ? "text-ink"
                    : "text-ink-secondary"
            }`}
          >{row.title}</span>
          <span class="sr-only">, {stateText(row)}</span>
          {#if writing !== null}
            <span class="shrink-0 text-xs leading-4 text-ink-muted" data-row-progress>{writing}%</span>
          {:else if row.stale || row.outdated}
            <span class="inline-flex shrink-0 items-center gap-1 text-[11px] leading-[14px] text-gap-text!" aria-hidden="true" data-row-marker={row.stale ? "stale" : "outdated"}>
              <span class="size-1.5 rounded-full bg-stale-dot"></span>{row.stale ? "stale" : "outdated"}
            </span>
          {:else if count}
            <span
              class={`shrink-0 text-[11px] leading-[14px] ${active ? "text-primary-selected" : "text-ink-faint"}`}
              aria-hidden="true"
              data-counts-complete={row.countsComplete}
            >{count}</span>
          {/if}
        </button>
      {/each}
    {/each}
  </nav>
  {#if footer}
    <!-- 20px inset beside the 300px Outline, 16px beside the 240px tablet one (3.5). -->
    <div class="shrink-0 border-t border-line-soft px-4 pt-3 pb-4 xl:px-5 xl:pb-5" data-outline-footer>
      {@render footer()}
    </div>
  {/if}
</aside>

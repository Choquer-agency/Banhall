<script lang="ts">
  import type { PdSubsectionRoleId } from "../../../../shared/pdSubsections";
  import type { SeedOutlineRow } from "./types";

  let {
    rows,
    activeRoleId,
    onOpen,
  }: {
    rows: SeedOutlineRow[];
    activeRoleId: PdSubsectionRoleId;
    onOpen: (roleId: PdSubsectionRoleId) => void;
  } = $props();

  const sectionTitle = (section: SeedOutlineRow["section"]) =>
    section === "s242" ? "Section 242" : section === "s244" ? "Section 244" : "Section 246";
  const sections: SeedOutlineRow["section"][] = ["s242", "s244", "s246"];

  // A count read within the server's safe processing limit is a lower bound,
  // never presented as the definitive selection count (A4).
  function stateLabel(row: SeedOutlineRow) {
    if (row.stale) return "Stale";
    if (row.outdated) return "Outdated";
    if (row.state === "approved") {
      return row.countsComplete
        ? `Approved · ${row.selectedCount}`
        : `Approved · ${row.selectedCount}+ (partial read)`;
    }
    if (row.state === "in_progress") return "In progress";
    if (row.state === "generating") return "Generating";
    if (row.state === "skipped") return "Skipped";
    if (row.state === "failed") return "Failed";
    return "Untouched";
  }
</script>

<aside aria-label="Seed outline" class="flex h-full min-h-0 flex-col bg-surface">
  <header class="shrink-0 border-b border-line-soft px-4 py-4">
    <p class="text-label text-ink-muted">Running Summary</p>
    <h2 class="mt-1 text-title">Outline</h2>
  </header>
  <nav aria-label="PD subsections" class="min-h-0 flex-1 overflow-y-auto px-2 py-3">
    {#each sections as section}
      <p class="px-3 pb-1 pt-3 text-data text-ink-faint">
        {sectionTitle(section)}
      </p>
      {#each rows.filter((row) => row.section === section) as row (row.roleId)}
        <button
          type="button"
          aria-current={row.roleId === activeRoleId ? "step" : undefined}
          onclick={() => onOpen(row.roleId)}
          class={`mb-1 flex min-h-11 w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-12 ${
            row.roleId === activeRoleId
              ? "bg-primary text-white"
              : "text-ink hover:bg-primary-wash"
          }`}
        >
          <span class="mt-0.5 text-data opacity-70">{row.order.toString().padStart(2, "0")}</span>
          <span class="min-w-0 flex-1">
            <span class={`block text-body ${row.roleId === activeRoleId ? "text-white" : ""}`}>{row.title}</span>
            <span
              class={`mt-0.5 block text-data ${row.roleId === activeRoleId ? "text-white/75" : "text-ink-muted"}`}
              data-counts-complete={row.countsComplete}
            >
              {stateLabel(row)}
            </span>
            {#if row.previewLines.length > 0}
              <span class={`mt-1 block truncate text-data ${row.roleId === activeRoleId ? "text-white/70" : "text-ink-faint"}`}>
                {row.countsComplete ? "" : "Partial · "}{row.previewLines[0]}
              </span>
            {/if}
          </span>
        </button>
      {/each}
    {/each}
  </nav>
</aside>

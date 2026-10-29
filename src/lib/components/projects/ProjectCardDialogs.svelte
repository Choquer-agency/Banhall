<!--
  The dialogs behind project cards (Paper Z7m to Z7p, 2026-10-19), shared by
  the Projects page and the company page since 2026-10-28: Edit details on a
  card, Edit details for a selection (bulk edit) and Delete. The host passes
  the card area so bulk edit follows the live selection: it holds the
  projects picked when it opened that are still selected, with their latest
  values, and closes once none is left. A host may take Edit details or bulk
  edit over with `onEditDetails` or `onBulkEdit`.
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import DeleteProjectDialog from "$lib/components/workspace/DeleteProjectDialog.svelte";
  import ProjectEditPanel from "./ProjectEditPanel.svelte";
  import BulkEditPanel from "./BulkEditPanel.svelte";
  import type { DashboardProjectionRow } from "$lib/workspace/projectRowMapping";
  import { duplicateProjectSearch } from "$lib/workspace/projectDuplicate";
  import type { CapabilityRole } from "../../../../shared/capabilities";

  type Viewer = { _id: string; role?: CapabilityRole | null; isAnonymous?: boolean } | null;

  let {
    viewer,
    area,
    onEditDetails = undefined,
    onBulkEdit = undefined,
    focusFallback = undefined,
  }: {
    viewer: Viewer;
    /** The card area (ClientArea): its live selection, and ending it once applied. */
    area: { selectedRows: () => DashboardProjectionRow[]; endSelect: () => void } | null;
    /** Edit details on a card. Default: the Edit details dialog. */
    onEditDetails?: (projectId: string) => void;
    /** Edit details for a selection. Default: the bulk edit dialog. */
    onBulkEdit?: (rows: DashboardProjectionRow[]) => void;
    /** Where focus goes after bulk edit once its bar is gone; the area's title by default. */
    focusFallback?: () => HTMLElement | null;
  } = $props();

  let deleteTarget = $state<{ id: string; title: string } | null>(null);
  let deleteOpen = $state(false);
  let bulkIds = $state<ReadonlySet<string>>(new Set());
  let bulkOpen = $state(false);
  const bulkRows = $derived.by(() => {
    if (!area) return [];
    return area.selectedRows().filter((row) => bulkIds.has(row._id));
  });
  $effect(() => {
    if (bulkOpen && bulkRows.length === 0) bulkOpen = false;
  });
  let editProjectId = $state<string | null>(null);
  let editOpen = $state(false);

  /** The card's "..." trigger, where focus goes back after the dialog. */
  function cardMenuTrigger(projectId: string | null) {
    if (projectId === null) return null;
    return document.querySelector<HTMLElement>(`[data-card-menu="${CSS.escape(projectId)}"]`);
  }

  export function editDetails(projectId: string) {
    if (onEditDetails) {
      onEditDetails(projectId);
      return;
    }
    editProjectId = projectId;
    editOpen = true;
  }

  export function duplicate(projectId: string) {
    void goto(`${resolve("/project/new")}${duplicateProjectSearch(projectId)}`);
  }

  export function requestDelete(project: { id: string; title: string }) {
    deleteTarget = project;
    deleteOpen = true;
  }

  export function bulkEdit(rows: DashboardProjectionRow[]) {
    if (onBulkEdit) {
      onBulkEdit(rows);
      return;
    }
    bulkIds = new Set(rows.map((row) => row._id));
    bulkOpen = true;
  }

  function bulkReturnFocus() {
    return (
      document.querySelector<HTMLElement>("[data-selection-edit]") ??
      (focusFallback ? focusFallback() : document.querySelector<HTMLElement>("[data-client-title]"))
    );
  }
</script>

{#if deleteTarget}
  <DeleteProjectDialog bind:open={deleteOpen} projectId={deleteTarget.id} projectTitle={deleteTarget.title} />
{/if}

{#if !onEditDetails}
  <ProjectEditPanel
    bind:open={editOpen}
    projectId={editProjectId}
    {viewer}
    returnFocus={() => cardMenuTrigger(editProjectId)}
  />
{/if}

{#if !onBulkEdit}
  <!-- Applied: clear the selection and keep the page where it is. -->
  <BulkEditPanel
    bind:open={bulkOpen}
    rows={bulkRows}
    {viewer}
    returnFocus={bulkReturnFocus}
    onApplied={() => area?.endSelect()}
  />
{/if}

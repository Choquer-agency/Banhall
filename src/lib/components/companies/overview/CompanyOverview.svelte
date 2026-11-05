<!--
  A company page's Overview tab (2026-11-04, Paper "Profile / Overview"):
  the company summary card, then the company's projects as one table.
-->
<script lang="ts">
  import CompanySummaryCard from "./CompanySummaryCard.svelte";
  import CompanyProjectsTable from "./CompanyProjectsTable.svelte";

  let {
    companyKey,
    companyName,
    clientId,
    summary,
    websiteReading = false,
    canEditSummary = false,
    canCreate = false,
  }: {
    companyKey: string;
    companyName: string;
    clientId: string | null;
    summary: {
      text: string;
      aiDraftedFrom?: string;
      aiDraftedAt?: number;
      editedByName?: string;
      editedAt?: number;
    } | null;
    websiteReading?: boolean;
    /** Managers and Admins (Edit company's rule). */
    canEditSummary?: boolean;
    canCreate?: boolean;
  } = $props();
</script>

<div data-company-overview class="flex flex-col gap-7">
  <CompanySummaryCard {clientId} {summary} canEdit={canEditSummary} {websiteReading} />
  <CompanyProjectsTable {companyKey} {companyName} {canCreate} />
</div>

<!--
  The approval line under the Import toolbar (2026-11-17, Approve on
  Import): every approval still running, whoever started it ("Robin Sample
  is approving files of Halden Foods: 40 of 300 done."), and the signed-in
  Admin's latest one until they close it, newest first, from
  approvalProgress. Each says how far it is, with a thin bar while it runs,
  then what it did with "Show why" (ImportApprovalRun).
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import ImportApprovalRun from "./ImportApprovalRun.svelte";
  import type { ApprovalProgress } from "./importApprove";

  const auth = useAuth();
  const progressQ = useQuery(api.ingestion.approvalProgress, () => (auth.isAuthenticated ? {} : "skip"));
  const runs = $derived((progressQ.data ?? []) as ApprovalProgress[]);
</script>

{#if runs.length > 0}
  <div data-import-approvals class="-mt-1 flex flex-col gap-1">
    {#each runs as progress (progress.approvalId)}
      <ImportApprovalRun {progress} />
    {/each}
  </div>
{/if}

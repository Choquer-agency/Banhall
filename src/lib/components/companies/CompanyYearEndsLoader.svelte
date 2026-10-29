<script lang="ts">
  /**
   * Reads one chunk of All companies' fallback year ends (2026-10-28): for up
   * to 25 companies with none saved, their newest project's
   * (`clients.listCompanyYearEnds`). Draws nothing; the table keeps what it
   * hands back. The host keeps `keys` the same array while the chunk's keys
   * stay the same.
   */
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";

  let {
    keys,
    onLoaded,
  }: {
    keys: string[];
    onLoaded: (entries: { key: string; fiscalYearEndMonth: number; fiscalYearEndDay: number }[]) => void;
  } = $props();

  const auth = useAuth();
  const yearEndsQ = useQuery(api.clients.listCompanyYearEnds, () =>
    auth.isAuthenticated && keys.length > 0 ? { keys } : "skip"
  );
  $effect(() => {
    const data = yearEndsQ.data;
    if (data) onLoaded(data);
  });
</script>

<script lang="ts">
  /**
   * The Projects section sidebar on its own (the page frame, owner
   * 2026-10-28): Home and the loading frame draw it without the Projects
   * page's state, so it reads the company list and the project count
   * itself (the same two reads the Projects page holds; Convex shares one
   * subscription). Company rows are plain links to Projects with that
   * company selected; no New company or merge here.
   */
  import { tick } from "svelte";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import ClientList from "./ClientList.svelte";
  import { CLIENT_PARAM, type ClientEntry } from "$lib/projects/clientList";

  let {
    current,
    homeHref,
    homeAvailable = true,
    phone = "hidden",
  }: {
    current: "home" | "projects";
    homeHref: string;
    homeAvailable?: boolean;
    /** Below 768px: hidden, or filling the card (the Projects list on a phone). */
    phone?: "hidden" | "full";
  } = $props();

  const auth = useAuth();
  // Try again drops the failed subscription for a moment and subscribes afresh.
  let retrying = $state(false);
  const clientsQ = useQuery(api.clients.listClients, () => (auth.isAuthenticated && !retrying ? {} : "skip"));
  async function retry() {
    retrying = true;
    await tick();
    retrying = false;
  }
  const facetsQ = useQuery(api.dashboard.getFacets, () => (auth.isAuthenticated ? {} : "skip"));
  const totalLabel = $derived(
    facetsQ.data ? `${facetsQ.data.total}${facetsQ.data.truncated ? "+" : ""}` : null
  );
  const selectedKey = $derived(current === "projects" ? page.url.searchParams.get(CLIENT_PARAM) || null : null);

  function hrefFor(key: string | null) {
    const base = resolve("/projects");
    return key === null ? base : `${base}?${new URLSearchParams({ [CLIENT_PARAM]: key }).toString()}`;
  }
</script>

<ClientList
  clients={(clientsQ.data?.clients ?? []) as ClientEntry[]}
  truncated={clientsQ.data?.truncated ?? false}
  loading={clientsQ.data === undefined && !clientsQ.error}
  failed={Boolean(clientsQ.error)}
  {totalLabel}
  {selectedKey}
  {current}
  {homeHref}
  {homeAvailable}
  {hrefFor}
  {phone}
  onRetry={() => void retry()}
/>

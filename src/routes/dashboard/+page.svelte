<script lang="ts">
  import { goto } from "$app/navigation";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../convex/_generated/api";
  import type { Doc } from "../../../convex/_generated/dataModel";
  import Button from "$lib/components/ui/Button.svelte";
  import ProjectCard from "$lib/components/dashboard/ProjectCard.svelte";
  import BuildStamp from "$lib/components/BuildStamp.svelte";
  import { SvelteSet } from "svelte/reactivity";

  type Project = Doc<"projects">;

  /** BNH-36: group projects company (A→Z) → fiscal year (newest first) → reports. */
  function groupByCompanyAndYear(projects: Project[]) {
    const byCompany = new Map<string, Map<string, Project[]>>();
    for (const p of projects) {
      const company = p.clientName?.trim() || "—";
      const fyKey = p.fiscalYearEnd
        ? String(new Date(p.fiscalYearEnd).getFullYear())
        : "none";
      if (!byCompany.has(company)) byCompany.set(company, new Map());
      const years = byCompany.get(company)!;
      if (!years.has(fyKey)) years.set(fyKey, []);
      years.get(fyKey)!.push(p);
    }

    return [...byCompany.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
      .map(([company, years]) => {
        const total = [...years.values()].reduce((n, a) => n + a.length, 0);
        const yearGroups = [...years.entries()]
          .sort((a, b) => {
            if (a[0] === "none") return 1;
            if (b[0] === "none") return -1;
            return Number(b[0]) - Number(a[0]);
          })
          .map(([fyKey, ps]) => {
            const withDate = ps.find((p) => p.fiscalYearEnd);
            return {
              fyKey,
              label: fyKey === "none" ? "No fiscal year set" : `Fiscal ${fyKey}`,
              dateLabel: withDate
                ? new Date(withDate.fiscalYearEnd!).toLocaleDateString("en-CA", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : null,
              projects: [...ps].sort((a, b) => b.updatedAt - a.updatedAt),
            };
          });
        return { company, total, yearGroups };
      });
  }

  type StatusFilter = "all" | "draft" | "generating" | "review" | "client_review" | "final";

  const FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "draft", label: "Draft" },
    { value: "review", label: "Review" },
    { value: "client_review", label: "Client Review" },
    { value: "final", label: "Final" },
  ];

  const auth = useAuth();
  const { signOut } = auth;

  const user = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const projectsQ = useQuery(api.projects.listProjects, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const openAlertsQ = useQuery(api.errorReports.openCount, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  let filter = $state<StatusFilter>("all");
  let search = $state("");
  const expanded = new SvelteSet<string>();

  function toggle(key: string) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
  }

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const projects = $derived(projectsQ.data);
  const openAlerts = $derived(openAlertsQ.data);

  const filtered = $derived(
    filter === "all" ? projects : projects?.filter((p) => p.status === filter)
  );
  const counts = $derived(
    projects?.reduce(
      (acc, p) => {
        acc[p.status] = (acc[p.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    )
  );
  const q = $derived(search.trim().toLowerCase());
  const searched = $derived(
    (filtered ?? []).filter(
      (p) =>
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        (p.writer ?? "").toLowerCase().includes(q)
    )
  );
  const groups = $derived(groupByCompanyAndYear(searched));
  // Default collapsed; searching forces everything open so matches are visible.
  const isOpen = (key: string) => q.length > 0 || expanded.has(key);
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <!-- Top bar — floating dark brand -->
    <div class="sticky top-0 z-50 w-full px-[10%] pt-5">
      <header class="flex items-center justify-between rounded-xl bg-navy px-5 py-5">
        <div class="flex items-center gap-5">
          <img src="/logo.png" alt="Banhall" width="89" height="89" class="-my-5 brightness-0 invert" />
          <span class="text-sm font-semibold text-white/90">Dashboard</span>
          <BuildStamp class="hidden text-white/50 lg:inline-flex" />
        </div>
        <div class="flex items-center gap-4">
          <a
            href="/alerts"
            class="relative flex items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white/90"
          >
            Alerts
            {#if openAlerts}
              <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
                {openAlerts}
              </span>
            {/if}
          </a>
          <span class="hidden text-sm text-white/60 sm:inline">
            {user.data?.name ?? user.data?.email}
          </span>
          <button
            onclick={() => signOut()}
            class="text-sm text-white/40 transition-colors hover:text-white/70"
          >
            Sign out
          </button>
        </div>
      </header>
    </div>

    <!-- Content -->
    <main class="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-xl font-semibold text-navy">Projects</h2>
          {#if projects && projects.length > 0}
            <p class="mt-0.5 text-sm text-gray-400">
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </p>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <a href="/project/questionnaire">
            <Button variant="secondary">Self-Serve</Button>
          </a>
          <a href="/project/new">
            <Button>
              <svg class="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Project
            </Button>
          </a>
        </div>
      </div>

      <!-- Search -->
      {#if projects && projects.length > 0}
        <div class="relative mt-4">
          <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            bind:value={search}
            placeholder="Search by company, project, or writer…"
            class="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>
      {/if}

      <!-- Filters -->
      {#if projects && projects.length > 0}
        <div class="mt-3 flex items-center gap-1">
          {#each FILTERS as f (f.value)}
            {@const count = f.value === "all" ? projects.length : (counts?.[f.value] ?? 0)}
            {#if f.value === "all" || count > 0}
              <button
                onclick={() => (filter = f.value)}
                class={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f.value
                    ? "bg-navy text-white"
                    : "text-gray-500 hover:bg-chrome hover:text-navy"
                }`}
              >
                {f.label}
                {#if count > 0}
                  <span class={`ml-1.5 ${filter === f.value ? "text-primary-light" : "text-gray-400"}`}>
                    {count}
                  </span>
                {/if}
              </button>
            {/if}
          {/each}
        </div>
      {/if}

      <!-- Project grid -->
      {#if projects === undefined}
        <div class="mt-12 flex justify-center">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
        </div>
      {:else if filtered && filtered.length === 0 && filter !== "all"}
        <div class="mt-12 text-center">
          <p class="text-sm text-gray-400">No {filter.replace("_", " ")} projects.</p>
          <button onclick={() => (filter = "all")} class="mt-2 text-xs text-primary hover:underline">
            Show all projects
          </button>
        </div>
      {:else if searched.length === 0 && q}
        <div class="mt-12 text-center">
          <p class="text-sm text-gray-400">No matches for “{search}”.</p>
          <button onclick={() => (search = "")} class="mt-2 text-xs text-primary hover:underline">
            Clear search
          </button>
        </div>
      {:else if filtered && filtered.length === 0}
        <div class="mt-16 text-center">
          <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-chrome">
            <svg class="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p class="font-medium text-navy">No projects yet.</p>
          <p class="mt-1 text-sm text-gray-400">Create your first project to get started.</p>
          <a href="/project/new" class="mt-4 inline-block">
            <Button>Create your first project</Button>
          </a>
        </div>
      {:else}
        <!-- BNH-36: company (A→Z) → fiscal year → report cards -->
        <div class="mt-5 flex flex-col gap-2">
          {#each groups as g (g.company)}
            {@const companyOpen = isOpen(g.company)}
            <div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <button
                onclick={() => toggle(g.company)}
                class="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50"
              >
                <svg class={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${companyOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span class="text-sm font-semibold text-navy">{g.company}</span>
                <span class="text-xs text-gray-400">
                  {g.total} report{g.total !== 1 ? "s" : ""}
                </span>
              </button>

              {#if companyOpen}
                <div class="border-t border-gray-100">
                  {#each g.yearGroups as yg (yg.fyKey)}
                    {@const yearKey = `${g.company}|${yg.fyKey}`}
                    {@const yearOpen = isOpen(yearKey)}
                    <div class="border-b border-gray-50 last:border-0">
                      <button
                        onclick={() => toggle(yearKey)}
                        class="flex w-full items-center gap-2 px-4 py-2.5 pl-7 text-left transition-colors hover:bg-gray-50"
                      >
                        <svg class={`h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform ${yearOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <span class="text-sm font-medium text-gray-700">{yg.label}</span>
                        {#if yg.dateLabel}
                          <span class="text-xs text-gray-400">· {yg.dateLabel}</span>
                        {/if}
                        <span class="ml-auto text-xs text-gray-400">{yg.projects.length}</span>
                      </button>
                      {#if yearOpen}
                        <div class="grid gap-3 px-4 pb-4 pl-10 pt-1 sm:grid-cols-2">
                          {#each yg.projects as project (project._id)}
                            <ProjectCard {project} />
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </main>
  </div>
{/if}

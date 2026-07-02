<script lang="ts">
  import { goto } from "$app/navigation";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../convex/_generated/api";
  import BuildStamp from "$lib/components/BuildStamp.svelte";

  function scoreColor(n: number) {
    if (n >= 80) return "text-green-700";
    if (n >= 60) return "text-amber-700";
    return "text-red-700";
  }

  const auth = useAuth();

  const dataQ = useQuery(api.reviews.listWriterReviews, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const data = $derived(dataQ.data);
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <div class="w-full shrink-0 px-[10%] pt-5">
      <header class="flex items-center gap-4 rounded-xl bg-navy px-5 py-4">
        <a href="/dashboard" class="flex-shrink-0">
          <img src="/logo.png" alt="Banhall" width="89" height="89" class="-my-5 brightness-0 invert" />
        </a>
        <BuildStamp class="hidden text-white/50 lg:inline-flex" />
        <div class="ml-auto flex items-center gap-3">
          <a href="/dashboard" class="text-sm text-white/60 transition-colors hover:text-white/80">
            Dashboard
          </a>
          <svg class="h-3 w-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span class="text-sm font-medium text-white">Writer QA reviews</span>
        </div>
      </header>
    </div>

    <main class="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 class="text-2xl font-bold text-gray-900">Writer QA reviews</h1>
      <p class="mt-1 text-sm text-gray-500">
        Human quality scores writers gave generated reports, alongside the AI QA
        score. For your review only — never auto-applied to the brain.
      </p>

      {#if data === undefined}
        <div class="mt-10 flex justify-center">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
        </div>
      {:else if data === null}
        <p class="mt-8 text-sm text-gray-400">Sign in to view writer reviews.</p>
      {:else if data.rows.length === 0}
        <p class="mt-8 text-sm text-gray-400">No writer reviews yet.</p>
      {:else}
        <!-- Summary -->
        <div class="mt-6 grid grid-cols-3 gap-3">
          <div class="rounded-xl border border-gray-200 bg-white p-4">
            <p class="text-xs uppercase tracking-wide text-gray-400">Reviews</p>
            <p class="mt-1 text-2xl font-bold text-navy">{data.total}</p>
          </div>
          <div class="rounded-xl border border-gray-200 bg-white p-4">
            <p class="text-xs uppercase tracking-wide text-gray-400">Avg writer score</p>
            <p class="mt-1 text-2xl font-bold text-navy">{data.avgHuman ?? "—"}</p>
          </div>
          <div class="rounded-xl border border-gray-200 bg-white p-4">
            <p class="text-xs uppercase tracking-wide text-gray-400">Avg gap (writer − AI)</p>
            <p class={`mt-1 text-2xl font-bold ${data.avgGap != null && data.avgGap < 0 ? "text-red-700" : "text-navy"}`}>
              {data.avgGap == null ? "—" : `${data.avgGap > 0 ? "+" : ""}${data.avgGap}`}
            </p>
          </div>
        </div>

        <!-- Table -->
        <div class="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th class="px-4 py-2.5 font-medium">Project</th>
                <th class="px-4 py-2.5 font-medium">Writer</th>
                <th class="px-4 py-2.5 text-center font-medium">Score</th>
                <th class="px-4 py-2.5 text-center font-medium">AI</th>
                <th class="px-4 py-2.5 font-medium">Comment</th>
              </tr>
            </thead>
            <tbody>
              {#each data.rows as r (r._id)}
                <tr class="border-b border-gray-50 align-top last:border-0">
                  <td class="px-4 py-2.5">
                    <p class="font-medium text-gray-800">{r.projectTitle}</p>
                    <p class="text-xs text-gray-400">
                      {r.clientName}{r.reportVersion != null ? ` · v${r.reportVersion}` : ""}
                    </p>
                  </td>
                  <td class="px-4 py-2.5 text-gray-600">{r.writerName}</td>
                  <td class={`px-4 py-2.5 text-center font-bold ${scoreColor(r.score)}`}>
                    {r.score}
                  </td>
                  <td class={`px-4 py-2.5 text-center font-semibold ${r.aiScore != null ? scoreColor(r.aiScore) : "text-gray-300"}`}>
                    {r.aiScore ?? "—"}
                  </td>
                  <td class="px-4 py-2.5 text-gray-600">
                    {#if r.comment}
                      <span>{r.comment}</span>
                    {:else}
                      <span class="text-gray-300">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </main>
  </div>
{/if}

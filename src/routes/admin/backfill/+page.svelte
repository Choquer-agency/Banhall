<script lang="ts">
  import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  const auth = useAuth();
  const currentUserQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const isAdmin = $derived(currentUserQ.data?.role === "admin");
  const queueQ = useQuery(api.ownerBackfill.listReviewQueue, () =>
    auth.isAuthenticated && isAdmin ? {} : "skip"
  );
  const assignOwner = useMutation(api.ownerBackfill.assignOwnerFromReview);
  const confirmFallback = useMutation(api.ownerBackfill.confirmFallbackOwner);

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto(resolve("/login"), { replaceState: true });
    }
  });

  const rows = $derived(queueQ.data?.rows ?? []);
  const rosterItems = $derived(
    (queueQ.data?.roster ?? []).map((member) => ({
      value: member.userId,
      label: member.email ? `${member.label} — ${member.email}` : member.label,
    }))
  );

  let selectedOwners = $state<Record<string, string>>({});
  let busyProjectId = $state<string | null>(null);
  let rowErrors = $state<Record<string, string>>({});

  function selectedOwner(projectId: Id<"projects">) {
    return selectedOwners[projectId] ?? "";
  }

  function setSelectedOwner(projectId: Id<"projects">, userId: string) {
    selectedOwners[projectId] = userId;
  }

  function setRowError(projectId: Id<"projects">, message: string) {
    if (message) rowErrors[projectId] = message;
    else delete rowErrors[projectId];
  }

  function reasonLabel(reason: "no_match" | "ambiguous" | "now_matched") {
    if (reason === "ambiguous") return "Multiple exact matches";
    if (reason === "now_matched") return "Exact match now available";
    return "No account match";
  }

  function reasonDescription(reason: "no_match" | "ambiguous" | "now_matched") {
    if (reason === "ambiguous") {
      return "More than one team account matches the historical consultant label. Choose the correct person.";
    }
    if (reason === "now_matched") {
      return "A team account now matches the historical consultant label and can be assigned directly.";
    }
    return "No team account exactly matches the historical consultant label. Confirm the creator or choose another owner.";
  }

  async function handleAssign(
    projectId: Id<"projects">,
    expectedOwnerId: Id<"users">,
    toUserId: Id<"users">
  ) {
    if (busyProjectId) return;
    busyProjectId = projectId;
    setRowError(projectId, "");
    try {
      await assignOwner({ projectId, expectedOwnerId, toUserId });
      delete selectedOwners[projectId];
    } catch (cause) {
      setRowError(
        projectId,
        userErrorCode(cause) === "STALE_REVISION"
          ? "The owner changed while you were reviewing. The latest row will refresh automatically."
          : userErrorMessage(cause, "The owner could not be assigned.")
      );
    } finally {
      busyProjectId = null;
    }
  }

  async function handleKeepCurrent(
    projectId: Id<"projects">,
    expectedOwnerId: Id<"users">
  ) {
    if (busyProjectId) return;
    busyProjectId = projectId;
    setRowError(projectId, "");
    try {
      await confirmFallback({ projectId, expectedOwnerId });
    } catch (cause) {
      setRowError(
        projectId,
        userErrorCode(cause) === "STALE_REVISION"
          ? "The owner changed while you were reviewing. The latest row will refresh automatically."
          : userErrorMessage(cause, "The fallback owner could not be confirmed.")
      );
    } finally {
      busyProjectId = null;
    }
  }
</script>

<AdminWorkspacePage
  title="Resolve project ownership"
  description="Review projects that could not be matched confidently to a team account, then confirm or assign the accountable owner."
>

    {#if currentUserQ.isLoading || auth.isLoading}
      <div class="flex min-h-48 items-center justify-center" role="status">
        <Spinner size="sm" />
        <span class="ml-2 text-sm text-ink-muted">Checking access…</span>
      </div>
    {:else if !isAdmin}
      <section class="mt-6 border-y border-line-soft py-8">
        <h2 class="text-base font-semibold text-ink">Administrator access required</h2>
        <p class="mt-1 text-sm text-ink-muted">Only administrators can resolve ownership backfill exceptions.</p>
      </section>
    {:else if queueQ.isLoading}
      <div class="flex min-h-48 items-center justify-center" role="status">
        <Spinner size="sm" />
        <span class="ml-2 text-sm text-ink-muted">Loading ownership review…</span>
      </div>
    {:else if queueQ.error}
      <section class="mt-6 border-y border-red-200 bg-red-50 px-4 py-6">
        <h2 class="text-sm font-semibold text-red-700">The ownership queue could not be loaded</h2>
        <p class="mt-1 text-sm text-red-600">{userErrorMessage(queueQ.error, "Refresh the page and try again.")}</p>
      </section>
    {:else if rows.length === 0}
      <section class="mt-6 border-y border-line-soft py-10 text-center">
        <h2 class="text-base font-semibold text-ink">No projects need review</h2>
        <p class="mt-1 text-sm text-ink-muted">Every backfilled owner has been confirmed or assigned.</p>
      </section>
    {:else}
      <section class="mt-8 max-w-5xl" aria-labelledby="review-heading">
        <div class="flex flex-col gap-2 border-b border-line-strong pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="review-heading" class="text-title">
              {rows.length} {rows.length === 1 ? "decision" : "decisions"} remaining
            </h2>
            <p class="mt-1 text-body">Resolving a project removes it from this queue.</p>
          </div>
          {#if queueQ.data?.truncated}
            <p class="text-sm font-medium text-amber-700">Showing the first 200 projects.</p>
          {/if}
        </div>

        <div class="mt-4 space-y-4">
          {#each rows as row, index (row.projectId)}
            <article class="card overflow-hidden" aria-labelledby={`project-${row.projectId}`}>
              <header class="flex flex-col gap-3 border-b border-line-soft px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                <div class="min-w-0">
                  <p class="text-data text-ink-muted">Decision {index + 1} of {rows.length}</p>
                  <a
                    id={`project-${row.projectId}`}
                    href={resolve(`/project/${row.projectId}`)}
                    class="mt-1 inline-flex min-h-11 items-center text-title text-navy transition-colors hover:text-primary"
                  >
                    {row.title}
                  </a>
                  <p class="text-sm text-ink-muted">{row.clientName}</p>
                </div>
                <span
                  class={`w-fit rounded-md px-2.5 py-1 text-xs font-semibold ${row.reason === "now_matched" ? "bg-primary-wash text-primary-selected" : "bg-amber-50 text-amber-800"}`}
                >
                  {reasonLabel(row.reason)}
                </span>
              </header>

              <div class="grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
                <div class="px-4 py-5 sm:px-5">
                  <h3 class="text-label">Why this needs review</h3>
                  <p class="mt-2 max-w-2xl text-body">{reasonDescription(row.reason)}</p>

                  <dl class="mt-5 grid gap-4 sm:grid-cols-2">
                    <div class="min-w-0 border-t border-line-soft pt-3">
                      <dt class="text-label">Historical consultant</dt>
                      <dd class="mt-1 break-words text-sm font-semibold text-ink">{row.legacyWriter}</dd>
                    </div>
                    <div class="min-w-0 border-t border-line-soft pt-3">
                      <dt class="text-label">Current fallback</dt>
                      <dd class="mt-1 text-sm font-semibold text-ink">{row.currentOwnerLabel}</dd>
                      <dd class="mt-0.5 text-xs text-ink-muted">Project creator: {row.creatorLabel}</dd>
                    </div>
                  </dl>

                  {#if row.candidates.length}
                    <div class="mt-5 border-t border-line-soft pt-4">
                      <h3 class="text-sm font-semibold text-ink">Suggested exact {row.candidates.length === 1 ? "match" : "matches"}</h3>
                      <p class="mt-1 text-xs text-ink-muted">Matched by the historical {row.candidates[0]?.matchedBy === "email" ? "email address" : "name"}.</p>
                      <div class="mt-3 flex flex-wrap gap-2">
                        {#each row.candidates as candidate (candidate.userId)}
                          <Button
                            variant="primary-outline"
                            size="sm"
                            class="min-h-11"
                            disabled={busyProjectId !== null}
                            aria-label={`Assign ${candidate.label} as owner of ${row.title}`}
                            onclick={() => handleAssign(row.projectId, row.currentOwnerId, candidate.userId)}
                          >
                            {busyProjectId === row.projectId ? "Saving…" : `Assign ${candidate.label}`}
                          </Button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>

                <div class="border-t border-line-soft bg-gray-50 px-4 py-5 sm:px-5 lg:border-t-0 lg:border-l">
                  <h3 class="text-title">Choose the owner</h3>
                  <p class="mt-1 text-sm text-ink-muted">Select one of the two options below.</p>

                  <div class="mt-4">
                    <label class="text-sm font-semibold text-ink" for={`owner-${row.projectId}`}>
                      Assign a different team member
                    </label>
                    <select
                      id={`owner-${row.projectId}`}
                      value={selectedOwner(row.projectId)}
                      disabled={busyProjectId !== null}
                      onchange={(event) => setSelectedOwner(row.projectId, event.currentTarget.value)}
                      class="mt-2 h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-base text-ink transition-colors hover:border-gray-300 focus-visible:border-navy focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-navy disabled:opacity-50 sm:text-sm"
                    >
                      <option value="">Choose a team member</option>
                      {#each rosterItems as member (member.value)}
                        <option value={member.value} disabled={member.value === row.currentOwnerId}>
                          {member.label}{member.value === row.currentOwnerId ? " — current fallback" : ""}
                        </option>
                      {/each}
                    </select>
                    <Button
                      variant="primary"
                      class="mt-2 min-h-11 w-full"
                      disabled={busyProjectId !== null || !selectedOwner(row.projectId)}
                      onclick={() =>
                        handleAssign(
                          row.projectId,
                          row.currentOwnerId,
                          selectedOwner(row.projectId) as Id<"users">
                        )}
                    >
                      {busyProjectId === row.projectId ? "Saving…" : "Assign selected owner"}
                    </Button>
                  </div>

                  <div class="my-5 flex items-center gap-3" aria-hidden="true">
                    <span class="h-px flex-1 bg-line-soft"></span>
                    <span class="text-xs font-medium text-ink-muted">or</span>
                    <span class="h-px flex-1 bg-line-soft"></span>
                  </div>

                  <Button
                    variant="secondary"
                    class="min-h-11 w-full"
                    disabled={busyProjectId !== null}
                    aria-label={`Confirm ${row.currentOwnerLabel} as owner of ${row.title}`}
                    onclick={() => handleKeepCurrent(row.projectId, row.currentOwnerId)}
                  >
                    {busyProjectId === row.projectId ? "Saving…" : `Confirm ${row.currentOwnerLabel}`}
                  </Button>
                  <p class="mt-2 text-xs leading-relaxed text-ink-muted">
                    This keeps the project creator as the accountable owner and removes the project from review.
                  </p>

                  {#if rowErrors[row.projectId]}
                    <p class="mt-4 border-t border-red-200 pt-3 text-sm text-red-600" role="alert">
                      {rowErrors[row.projectId]}
                    </p>
                  {/if}
                </div>
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/if}
 </AdminWorkspacePage>

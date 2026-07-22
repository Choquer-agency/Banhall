<script lang="ts">
  import { useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../convex/_generated/dataModel";
  import ProposedEditCard from "$lib/components/chat/ProposedEditCard.svelte";
  import {
    ChainOfThought,
    ChainOfThoughtContent,
    ChainOfThoughtItem,
    ChainOfThoughtStep,
    ChainOfThoughtTrigger,
    FeedbackBar,
    Message,
    MessageContent,
    Source,
    SourceContent,
    SourceTrigger,
  } from "$lib/components/chat/primitives";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  interface Props {
    reportId: Id<"reports">;
    onReferenceText?: (texts: string[], scrollTo?: string) => void;
    onPreviewProposal?: (
      pairs: { find: string; replaceWith: string }[],
      on: boolean
    ) => void;
    onCopyToComposer?: (text: string) => void;
  }
  type ResearchStep = {
    title: string;
    detail: string;
    status: "complete" | "active" | "pending" | "failed";
  };

  let {
    reportId,
    onReferenceText,
    onPreviewProposal,
    onCopyToComposer,
  }: Props = $props();

  const sessionsQ = useQuery(api.research.listSessions, () => ({ reportId }));
  const cancelResearch = useMutation(api.research.cancelResearch);
  const rejectProposal = useMutation(api.chatV2.rejectProposal);
  const applyProposal = useMutation(api.chatV2.applyProposal);
  const submitResearchFeedback = useMutation(api.research.submitFeedback);

  let selectedId = $state<Id<"researchSessions"> | null>(null);
  let showHistory = $state(false);
  let feedbackBusy = $state(false);
  // Keyed by session so switching sessions naturally resets both — no
  // synchronization effect needed.
  let feedbackHiddenFor = $state<Id<"researchSessions"> | null>(null);
  let feedbackErrorFor = $state<Id<"researchSessions"> | null>(null);

  const sessions = $derived(sessionsQ.data ?? []);
  const selectedSummary = $derived(
    sessions.find((session) => session._id === selectedId) ?? sessions[0] ?? null
  );
  const selectedSessionId = $derived(selectedSummary?._id ?? null);
  const detailsQ = useQuery(api.research.getSessionDetails, () =>
    selectedSessionId ? { sessionId: selectedSessionId } : "skip"
  );
  const details = $derived(detailsQ.data ?? null);
  const externalSources = $derived(
    details?.sources.filter((source) => source.kind === "external") ?? []
  );
  // Persisted on the session, so a remounted panel can't rate twice.
  const feedbackValue = $derived(
    details?.session.feedback
      ? details.session.feedback.rating === "helpful"
        ? (1 as const)
        : (-1 as const)
      : null
  );
  const feedbackHidden = $derived(feedbackHiddenFor === selectedSessionId);
  let claimsOpenFor = $state<Id<"researchSessions"> | null>(null);
  const claimsOpen = $derived(claimsOpenFor === selectedSessionId);
  const sourcesById = $derived(
    new Map((details?.sources ?? []).map((source) => [source._id as string, source]))
  );

  // Support verdicts from the reviewer, worst-news-first colors.
  const SUPPORT_BADGES: Record<
    string,
    { label: string; class: string }
  > = {
    supported: { label: "Supported", class: "bg-green-50 text-green-700" },
    qualified: { label: "Qualified", class: "bg-amber-50 text-amber-800" },
    conflicting: { label: "Conflicting", class: "bg-red-50 text-red-700" },
    unsupported: { label: "Unsupported", class: "bg-gray-100 text-gray-600" },
  };
  const feedbackError = $derived(
    feedbackErrorFor === selectedSessionId
      ? "Your feedback didn't send. Try again."
      : null
  );

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString("en-CA", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function truncate(value: string, maximum = 80): string {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1)}…`;
  }

  function isActive(status: string): boolean {
    return status === "queued" || status === "researching" || status === "reviewing";
  }

  function researchSteps(): ResearchStep[] {
    // Progress is driven by the backend's own phase transitions (session
    // status); runs only refine the failure detail. No assumptions here about
    // how many researchers the workflow fans out to.
    const status = details?.session.status ?? selectedSummary?.status ?? "queued";
    const searchRuns = details?.runs.filter((run) => run.provider !== "reviewer") ?? [];
    const failedSearches = searchRuns.filter((run) => run.status === "failed").length;
    const allSearchesFailed = searchRuns.length > 0 && failedSearches === searchRuns.length;

    return [
      {
        title: "Prepare the selected passage",
        detail: "Direct identifiers are removed before any external search.",
        status: status === "queued" ? "active" : "complete",
      },
      {
        title: "Search and compare evidence",
        detail: failedSearches
          ? "Available evidence was retained; one search path was unavailable."
          : "Independent search paths are compared without sharing drafts.",
        status:
          status === "queued"
            ? "pending"
            : status === "researching"
              ? "active"
              : allSearchesFailed
                ? "failed"
                : "complete",
      },
      {
        title: "Check claims against sources",
        detail: "Claims are matched to supporting excerpts and project evidence.",
        status:
          status === "reviewing"
            ? "active"
            : status === "completed"
              ? "complete"
              : status === "failed"
                ? "failed"
                : "pending",
      },
      {
        title: "Draft a supported suggestion",
        detail: "The result keeps citations separate from the proposed report wording.",
        status:
          status === "completed"
            ? "complete"
            : status === "failed"
              ? "failed"
              : "pending",
      },
    ];
  }

  function proposalPairs(proposal: Doc<"chatProposals">) {
    return proposal.replacements?.length
      ? proposal.replacements
      : proposal.targetText
        ? [{ find: proposal.targetText, replaceWith: proposal.newText ?? "" }]
        : [];
  }

  async function submitFeedback(rating: "helpful" | "not_helpful") {
    if (!details || feedbackBusy || feedbackValue !== null) return;
    feedbackBusy = true;
    feedbackErrorFor = null;
    try {
      await submitResearchFeedback({ sessionId: details.session._id, rating });
    } catch {
      feedbackErrorFor = details.session._id;
    } finally {
      feedbackBusy = false;
    }
  }
</script>
{#snippet briefIcon()}
  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path stroke-linecap="round" stroke-linejoin="round" d="M14 2v6h6M8 13h8M8 17h5" />
  </svg>
{/snippet}

{#snippet searchIcon()}
  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path stroke-linecap="round" d="m21 21-4.3-4.3" />
  </svg>
{/snippet}

{#snippet lightbulbIcon()}
  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="M15 14c.2-1 .7-1.7 1.5-2.5A5 5 0 1 0 8 11.5c.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4" />
  </svg>
{/snippet}

{#snippet targetIcon()}
  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
{/snippet}


{#if selectedSummary}
  <div class="space-y-3" aria-label="Contextual research">
    <Message role="user">
      <MessageContent>
        <p class="font-medium">Research this passage</p>
        <p class="mt-1 border-t border-white/40 pt-1.5 font-serif text-xs italic text-navy/80">
          “{truncate(selectedSummary.selectedText, 220)}”
        </p>
        {#if selectedSummary.instruction}
          <p class="mt-1.5 text-xs">{selectedSummary.instruction}</p>
        {/if}
      </MessageContent>
    </Message>

    <Message role="assistant" class="group">
      <div class="min-w-0 space-y-3">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-navy">Research</span>
          <span class="text-[11px] text-ink-muted">{formatTimestamp(selectedSummary.createdAt)}</span>
          {#if isActive(selectedSummary.status)}
            <Spinner size="sm" class="ml-auto border-primary/25 border-t-primary" />
          {/if}
        </div>

        {#if sessions.length > 1}
          <button
            type="button"
            aria-expanded={showHistory}
            onclick={() => (showHistory = !showHistory)}
            class="text-[11px] font-medium text-ink-muted transition-colors hover:text-navy"
          >
            {showHistory ? "Hide earlier research" : `${sessions.length - 1} earlier research request${sessions.length === 2 ? "" : "s"}`}
          </button>
          {#if showHistory}
            <div class="flex gap-1.5 overflow-x-auto pb-1">
              {#each sessions as session (session._id)}
                <button
                  type="button"
                  onclick={() => {
                    selectedId = session._id;
                    showHistory = false;
                  }}
                  class={`min-w-32 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    selectedSessionId === session._id
                      ? "bg-primary-wash text-navy"
                      : "bg-gray-50 text-ink-muted hover:bg-primary-wash hover:text-navy"
                  }`}
                >
                  <span class="block truncate text-[11px] font-medium">{truncate(session.selectedText, 48)}</span>
                  <span class="mt-0.5 block text-[10px] opacity-70">{formatTimestamp(session.createdAt)}</span>
                </button>
              {/each}
            </div>
          {/if}
        {/if}

        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-ink-muted">
            {isActive(selectedSummary.status) ? "Researching the passage" : "How this result was built"}
          </span>
          {#if isActive(selectedSummary.status)}
            <span class="ml-auto text-[11px] text-ink-muted">Working…</span>
          {/if}
        </div>
        <ChainOfThought>
          {#each researchSteps() as step, index (step.title)}
            <ChainOfThoughtStep open={step.status === "active"}>
              <ChainOfThoughtTrigger
                status={step.status}
                leftIcon={index === 0 ? briefIcon : index === 1 ? searchIcon : index === 2 ? lightbulbIcon : targetIcon}
              >{step.title}</ChainOfThoughtTrigger>
              <ChainOfThoughtContent>
                <ChainOfThoughtItem>{step.detail}</ChainOfThoughtItem>
              </ChainOfThoughtContent>
            </ChainOfThoughtStep>
          {/each}
        </ChainOfThought>

        {#if detailsQ.data === undefined}
          <div class="flex items-center gap-2 py-2 text-xs text-ink-muted">
            <Spinner size="sm" /> Loading research…
          </div>
        {:else if details}
          {#if details.session.status === "failed"}
            <p class="rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700" role="alert">
              {details.session.errorMessage ?? "Research did not complete."}
            </p>
          {:else if details.session.status === "canceled"}
            <p class="text-xs text-ink-muted">This research request was canceled.</p>
          {:else if isActive(details.session.status)}
            <button
              type="button"
              onclick={() => cancelResearch({ sessionId: details.session._id })}
              class="text-[11px] font-medium text-ink-muted transition-colors hover:text-red-600"
            >
              Cancel research
            </button>
          {:else}
            {#if details.session.answer}
              <MessageContent markdown text={details.session.answer} />
            {/if}

            {#if details.session.evidenceBoundary}
              <p class="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                <span class="font-semibold">Evidence limit:</span> {details.session.evidenceBoundary}
              </p>
            {/if}

            {#if details.session.warnings?.length}
              <ul class="space-y-1 text-xs leading-relaxed text-ink-secondary">
                {#each details.session.warnings as warning (warning)}
                  <li class="flex gap-1.5"><span class="text-amber-500">•</span><span>{warning}</span></li>
                {/each}
              </ul>
            {/if}

            {#if details.claims.length > 0}
              <div>
                <button
                  type="button"
                  aria-expanded={claimsOpen}
                  onclick={() => (claimsOpenFor = claimsOpen ? null : selectedSessionId)}
                  class="text-[11px] font-medium text-ink-muted transition-colors hover:text-navy"
                >
                  {claimsOpen
                    ? "Hide claim support"
                    : `How ${details.claims.length} claim${details.claims.length === 1 ? " was" : "s were"} checked against sources`}
                </button>
                {#if claimsOpen}
                  <ul class="mt-2 space-y-2">
                    {#each details.claims as claim (claim._id)}
                      {@const badge = SUPPORT_BADGES[claim.support] ?? SUPPORT_BADGES.unsupported}
                      <li class="rounded-lg bg-gray-50 px-3 py-2">
                        <div class="flex items-start gap-2">
                          <span class={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.class}`}>
                            {badge.label}
                          </span>
                          <p class="min-w-0 text-xs leading-relaxed text-ink-secondary">{claim.text}</p>
                        </div>
                        {#if claim.sourceIds.length}
                          <div class="mt-1.5 flex flex-wrap gap-1.5 pl-0.5">
                            {#each claim.sourceIds as sourceId (sourceId)}
                              {@const source = sourcesById.get(sourceId)}
                              {#if source?.canonicalUrl}
                                <a
                                  href={source.canonicalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="max-w-44 truncate rounded-md bg-white px-1.5 py-0.5 text-[10px] text-ink-muted ring-1 ring-line-soft transition-colors hover:text-navy"
                                >
                                  {source.domain ?? source.title}
                                </a>
                              {:else if source}
                                <span
                                  title="Private project document"
                                  class="max-w-44 truncate rounded-md bg-white px-1.5 py-0.5 text-[10px] text-ink-muted ring-1 ring-line-soft"
                                >
                                  {source.title}
                                </span>
                              {/if}
                            {/each}
                          </div>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}

            {#if externalSources.some((source) => source.canonicalUrl)}
              <div>
                <p class="mb-2 text-xs font-semibold text-navy">Sources</p>
                <div class="flex flex-wrap gap-2">
                  {#each externalSources as source (source._id)}
                    {#if source.canonicalUrl}
                      <Source href={source.canonicalUrl}>
                        <SourceTrigger showFavicon />
                        <SourceContent
                          title={source.title}
                          description={source.excerpt ?? "Open the cited source"}
                        />
                      </Source>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}

            {#if details.proposal}
              <div class="border-t border-line-soft pt-3">
                <p class="text-xs font-semibold text-navy">Suggested revision</p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                  Replace the passage directly, or add it to chat to refine first.
                </p>
                <ProposedEditCard
                  newText={details.proposal.newText}
                  targetText={details.proposal.targetText}
                  replacements={details.proposal.replacements}
                  state={details.proposal.state}
                  onReplace={async () => {
                    await applyProposal({ proposalId: details.proposal!._id });
                  }}
                  onCopyToComposer={details.proposal.newText
                    ? () => onCopyToComposer?.(details.proposal!.newText!)
                    : undefined}
                  onReject={async () => {
                    await rejectProposal({ proposalId: details.proposal!._id });
                  }}
                  onShowInDoc={details.proposal.targetText
                    ? () => onReferenceText?.([details.proposal!.targetText!])
                    : undefined}
                  onPreviewInDoc={onPreviewProposal
                    ? (on) => onPreviewProposal(proposalPairs(details.proposal!), on)
                    : undefined}
                />
              </div>
            {/if}

            {#if !feedbackHidden}
              <FeedbackBar
                value={feedbackValue}
                disabled={feedbackBusy}
                onHelpful={() => submitFeedback("helpful")}
                onNotHelpful={() => submitFeedback("not_helpful")}
                onClose={() => (feedbackHiddenFor = selectedSessionId)}
              />
              {#if feedbackError}
                <p class="text-xs text-red-600" role="alert">{feedbackError}</p>
              {/if}
            {/if}
          {/if}
        {/if}
      </div>
    </Message>
  </div>
{/if}

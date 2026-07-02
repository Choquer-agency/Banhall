<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { PUBLIC_AGENT_CHAT } from "$env/static/public";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import Badge from "$lib/components/ui/Badge.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import IconAction from "$lib/components/ui/IconAction.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import GenerationProgress from "$lib/components/generation/GenerationProgress.svelte";
  import CandidateSelection from "$lib/components/generation/CandidateSelection.svelte";
  import Editor from "$lib/components/editor/Editor.svelte";
  import type { CommentRange } from "$lib/components/editor/types";
  import QAScorePanel from "$lib/components/editor/QAScorePanel.svelte";
  import ChronologyTable from "$lib/components/editor/ChronologyTable.svelte";
  import FilesPanel from "$lib/components/editor/FilesPanel.svelte";
  import LogsPanel from "$lib/components/editor/LogsPanel.svelte";
  import CommentOverlay from "$lib/components/comments/CommentOverlay.svelte";
  import ChatPanel from "$lib/components/chat/ChatPanel.svelte";
  import AgentChatPanel from "$lib/components/chat/AgentChatPanel.svelte";
  import VersionHistory from "$lib/components/history/VersionHistory.svelte";
  import EditableText from "$lib/components/project/EditableText.svelte";
  import IndustryField from "$lib/components/project/IndustryField.svelte";
  import FiscalYearField from "$lib/components/project/FiscalYearField.svelte";

  // BNH-10 P2 parallel-run: flip chat to the streaming @convex-dev/agent backend.
  const AGENT_CHAT = PUBLIC_AGENT_CHAT === "1";

  const auth = useAuth();
  const projectId = $derived(page.params.id as Id<"projects">);

  const projectQ = useQuery(api.projects.getProject, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const reportQ = useQuery(api.reports.getLatestReport, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const generationQ = useQuery(api.generations.getLatestGeneration, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const transcriptQ = useQuery(api.transcripts.getTranscript, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const userQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const commentsQ = useQuery(api.comments.listComments, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const viewSummaryQ = useQuery(api.reportViews.getViewSummary, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );

  const generateReport = useMutation(api.projects.scheduleGenerateReport);
  const updateReport = useMutation(api.reports.updateReportContent);
  const createSnapshot = useMutation(api.snapshots.createManualSnapshot);
  const markEditApplied = useMutation(api.chat.markProposedEditApplied);
  const markProposalApplied = useMutation(api.chatV2.markProposalApplied);
  const updateTitles = useMutation(api.projects.updateProjectTitles);

  const project = $derived(projectQ.data);
  const report = $derived(reportQ.data);
  const generation = $derived(generationQ.data);
  const transcript = $derived(transcriptQ.data);
  const user = $derived(userQ.data);
  const viewSummary = $derived(viewSummaryQ.data);

  let editorRef: Editor | null = $state(null);
  let lastSnapshotAt = 0;
  let saving = $state(false);
  let showHistory = $state(false);
  let pendingHighlight = $state<{
    from: number;
    to: number;
    text: string;
    x?: number;
    y?: number;
  } | null>(null);
  let copied = $state(false);
  let exporting = $state(false);
  let hoveredCommentId = $state<string | null>(null);
  let pendingChatHighlight = $state<{
    from: number;
    to: number;
    text: string;
  } | null>(null);

  // BNH-30: one-by-one replace-and-scan-next session.
  type ReplaceMatch = { from: number; to: number; replaceWith: string; text: string };
  type ReplaceSession = {
    pairs: { find: string; replaceWith: string }[];
    // chatMessages id (legacy chat) or chatProposals id (agent chat).
    messageId: string;
    cursor: number;
    total: number;
    position: number;
    current: ReplaceMatch | null;
    replaced: number;
  };
  let replaceSession = $state<ReplaceSession | null>(null);
  let replaceNotice = $state<string | null>(null);
  function notifyReplace(msg: string) {
    replaceNotice = msg;
    setTimeout(() => (replaceNotice = null), 4000);
  }

  // Route "mark applied" to whichever chat backend owns the id.
  function markApplied(id: string) {
    if (AGENT_CHAT) {
      return markProposalApplied({ proposalId: id as Id<"chatProposals"> });
    }
    return markEditApplied({ messageId: id as Id<"chatMessages"> });
  }

  function startReplaceReview(
    pairs: { find: string; replaceWith: string }[],
    messageId: string
  ) {
    const ed = editorRef;
    if (!ed || !report) return;
    const matches = ed.findReplaceMatches(pairs);
    if (matches.length === 0) {
      // Nothing left to replace — almost always because it's already applied.
      // Collapse the card so its buttons stop looking actionable.
      notifyReplace(
        `No remaining “${pairs[0]?.find ?? "matches"}” in the report — already applied.`
      );
      markApplied(messageId).catch(() => {});
      return;
    }
    // Snapshot once so the whole stepping pass can be undone.
    createSnapshot({ reportId: report._id, reason: "manual" }).catch(() => {});
    const first = matches[0];
    ed.highlightRange(first.from, first.to, first.text);
    replaceSession = {
      pairs,
      messageId,
      cursor: 0,
      total: matches.length,
      position: 1,
      current: first,
      replaced: 0,
    };
  }

  function advanceReplace(cursor: number, addedReplaced: number) {
    const sess = replaceSession;
    const ed = editorRef;
    if (!sess || !ed) return;
    const next =
      ed.findReplaceMatches(sess.pairs).find((m) => m.from >= cursor) ?? null;
    const replaced = sess.replaced + addedReplaced;
    if (next) {
      ed.highlightRange(next.from, next.to, next.text);
      replaceSession = { ...sess, cursor, position: sess.position + 1, current: next, replaced };
    } else {
      ed.clearHighlight();
      if (replaced > 0) markApplied(sess.messageId).catch(() => {});
      replaceSession = null;
    }
  }

  function replaceAndNext() {
    const sess = replaceSession;
    const ed = editorRef;
    if (!sess?.current || !ed) return;
    ed.replaceRange(sess.current.from, sess.current.to, sess.current.replaceWith);
    advanceReplace(sess.current.from + sess.current.replaceWith.length, 1);
  }

  function rejectAndNext() {
    const sess = replaceSession;
    if (!sess?.current) return;
    advanceReplace(sess.current.to, 0);
  }

  function replaceAllRemaining() {
    const sess = replaceSession;
    const ed = editorRef;
    if (!sess || !ed) return;
    let cursor = sess.current ? sess.current.from : sess.cursor;
    let replaced = sess.replaced;
    for (let i = 0; i < 5000; i++) {
      const m = ed.findReplaceMatches(sess.pairs).find((x) => x.from >= cursor);
      if (!m) break;
      ed.replaceRange(m.from, m.to, m.replaceWith);
      cursor = m.from + m.replaceWith.length;
      replaced++;
    }
    ed.clearHighlight();
    if (replaced > 0) markApplied(sess.messageId).catch(() => {});
    replaceSession = null;
  }

  function endReplaceReview() {
    editorRef?.clearHighlight();
    replaceSession = null;
  }

  function handleAskAI(selection: { from: number; to: number; text: string }) {
    pendingChatHighlight = selection;
  }

  // BNH-14: resizable chat panel (default 50/50). Full-screen toggle is hidden
  // for now — keep `chatFull` as a dormant flag so it's easy to re-enable.
  let chatRatio = $state(0.5);
  const chatFull = false;
  let workspaceEl: HTMLDivElement | null = $state(null);
  let dragging = false;

  $effect(() => {
    const r = sessionStorage.getItem("banhall_chat_ratio");
    if (r) chatRatio = Math.min(0.8, Math.max(0.25, parseFloat(r)));
    sessionStorage.removeItem("banhall_chat_full");
  });
  $effect(() => {
    sessionStorage.setItem("banhall_chat_ratio", String(chatRatio));
  });

  $effect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging || !workspaceEl) return;
      const rect = workspaceEl.getBoundingClientRect();
      const ratio = (rect.right - e.clientX) / rect.width;
      chatRatio = Math.min(0.8, Math.max(0.25, ratio));
    }
    function onUp() {
      if (dragging) {
        dragging = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  });

  function startDrag(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  // Build comment ranges for editor highlights (only unresolved comments)
  const commentRanges: CommentRange[] = $derived(
    (commentsQ.data ?? [])
      .filter((c) => !c.resolved)
      .map((c) => ({
        id: c._id,
        from: c.highlightFrom,
        to: c.highlightTo,
        text: c.highlightText,
        isClient: c.commenterType === "client",
      }))
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  async function handleEditorUpdate(json: string) {
    if (!report) return;
    saving = true;
    try {
      // Take a restore-point checkpoint of the prior state at most once every
      // 5 minutes of active editing (deduped + log-thinned server-side).
      const now = Date.now();
      if (now - lastSnapshotAt > 300_000) {
        lastSnapshotAt = now;
        createSnapshot({ reportId: report._id, reason: "manual" }).catch(() => {});
      }
      await updateReport({ reportId: report._id, content: json });
    } catch (e) {
      console.error("Failed to save:", e);
    } finally {
      saving = false;
    }
  }

  function handleRegenerate() {
    if (!transcript) return;
    generateReport({
      projectId,
      transcriptId: transcript._id,
    }).catch(console.error);
  }

  function handleCopyShareLink() {
    if (!project) return;
    const url = `${window.location.origin}/review/${project.shareToken}`;
    navigator.clipboard.writeText(url);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function handleComment(selection: {
    from: number;
    to: number;
    text: string;
    x?: number;
    y?: number;
  }) {
    pendingHighlight = selection;
  }

  async function handleExport() {
    if (!report || !project) return;
    exporting = true;
    try {
      const safeName = project.title
        .replace(/[^a-zA-Z0-9\s\-]/g, "")
        .replace(/\s+/g, "_");
      // Lazy import: docx/file-saver touch browser globals at module init, which
      // breaks SSR — load them only when the writer actually exports.
      const { exportToDocx } = await import("$lib/exportDocx");
      await exportToDocx(report.content, safeName);
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      exporting = false;
    }
  }

  const isGenerating = $derived(generation?.status === "running");
  const awaitingSelection = $derived(generation?.status === "awaiting_selection");
</script>

{#if auth.isLoading || !auth.isAuthenticated || project === undefined}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else if project === null}
  <div class="flex flex-1 flex-col items-center justify-center gap-2 bg-canvas">
    <p class="text-gray-500">Project not found.</p>
    <a href="/dashboard" class="text-sm text-navy hover:underline">Back to dashboard</a>
  </div>
{:else}
  <div class="flex h-screen flex-col overflow-hidden bg-canvas">
    <!-- App bar — same AppNav as everywhere; home icon + report breadcrumb -->
    <AppNav home="icon" breadcrumbs={[{ label: project.title }]}>
      {#snippet actions()}
        {#if saving}
          <span class="hidden text-xs text-white/40 sm:inline">Saving…</span>
        {/if}
        <Badge status={project.status} />
      {/snippet}
    </AppNav>

    <!-- Sub-menu (white) — icons that reveal their label on hover -->
    {#if report}
      <div class="mx-auto w-full max-w-7xl shrink-0 px-6 pt-4">
        <div class="flex justify-end">
          <nav class="hidden flex-shrink-0 items-center gap-1 rounded-xl border border-line-soft bg-white px-2 py-2 sm:flex">
            <IconAction
              label={copied ? "Copied!" : "Share"}
              title="Share"
              onclick={handleCopyShareLink}
            >
              {#snippet icon()}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              {/snippet}
            </IconAction>
            <IconAction label="History" onclick={() => (showHistory = true)}>
              {#snippet icon()}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              {/snippet}
            </IconAction>
            <IconAction
              label={exporting ? "Exporting…" : "Export .docx"}
              title="Export .docx"
              onclick={handleExport}
              disabled={exporting}
            >
              {#snippet icon()}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              {/snippet}
            </IconAction>
            <IconAction label="Financial" href={`/project/${projectId}/financial`}>
              {#snippet icon()}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              {/snippet}
            </IconAction>
          </nav>
        </div>
      </div>
    {/if}

    <!-- Generation progress -->
    {#if isGenerating || (generation && generation.status === "failed" && !report)}
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-3xl px-6 py-8">
          <GenerationProgress {projectId} />
        </div>
      </div>
    {/if}

    <!-- BNH-15: choose between candidate drafts before they become the report -->
    {#if awaitingSelection}
      <CandidateSelection {projectId} />
    {/if}

    <!-- Editor workspace + chat rail (single view, resizable — BNH-14) -->
    {#if !awaitingSelection && report}
      <div bind:this={workspaceEl} class="mx-auto flex min-h-0 w-full max-w-7xl flex-1 overflow-hidden">
        {#if !chatFull}
          <div class="min-h-0 flex-1 overflow-y-auto">
            <div class="mx-auto max-w-[760px] px-10 py-10">
              <!-- Project info header -->
              <div class="mb-8 pb-6 border-b border-gray-200">
                <h1 class="text-display">{project.title}</h1>
                <div class="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <div>
                    <span class="text-gray-400">Internal title</span>
                    <EditableText
                      value={project.title}
                      placeholder="Set internal title"
                      onSave={async (v) => {
                        await updateTitles({ projectId, title: v });
                      }}
                    />
                  </div>
                  <div>
                    <span class="text-gray-400">SR&amp;ED title</span>
                    <EditableText
                      value={project.sredTitle ?? ""}
                      placeholder="Add the formal SR&ED title (finalize at the end)"
                      onSave={async (v) => {
                        await updateTitles({ projectId, sredTitle: v });
                      }}
                    />
                  </div>
                  <div>
                    <span class="text-gray-400">Client</span>
                    <p class="text-gray-700">{project.clientName}</p>
                  </div>
                  <div>
                    <span class="text-gray-400">Writer</span>
                    <p class="text-gray-700">{project.writer || "Catherine Tremblay"}</p>
                  </div>
                  {#if project.interviewer}
                    <div>
                      <span class="text-gray-400">Interviewer</span>
                      <p class="text-gray-700">{project.interviewer}</p>
                    </div>
                  {/if}
                  <div>
                    <span class="text-gray-400">Created</span>
                    <p class="text-gray-700">{new Date(project.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
                  </div>
                  <div>
                    <span class="text-gray-400">Fiscal year-end</span>
                    <FiscalYearField
                      {projectId}
                      fiscalYearEnd={project.fiscalYearEnd ?? null}
                    />
                  </div>
                  <div>
                    <span class="text-gray-400">Industry</span>
                    <IndustryField
                      {projectId}
                      industry={project.industry ?? null}
                    />
                  </div>
                </div>
                <!-- View tracking -->
                {#if viewSummary && viewSummary.totalViews > 0}
                  <div class="mt-3 flex items-center gap-3">
                    <div class="flex items-center gap-1.5 text-xs text-gray-400">
                      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      {viewSummary.totalViews} view{viewSummary.totalViews !== 1 ? "s" : ""}
                    </div>
                    {#each viewSummary.uniqueViewers as v (`${v.name}-${v.type}`)}
                      <span class="inline-flex items-center gap-1 rounded-full bg-chrome px-2 py-0.5 text-xs text-gray-500">
                        {v.name}
                        <span class="text-gray-300">{new Date(v.lastViewed).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </span>
                    {/each}
                  </div>
                {/if}
              </div>

              <!-- Editor column -->
              <Editor
                bind:this={editorRef}
                content={report.content}
                onUpdate={handleEditorUpdate}
                onComment={handleComment}
                onAskAI={handleAskAI}
                editable={true}
                {commentRanges}
                onHoverComment={(id) => (hoveredCommentId = id)}
              />

              <!-- QA Score -->
              <div class="mt-8 mb-12">
                <QAScorePanel agentOutputs={generation?.agentOutputs} reportContent={report.content} reportId={report._id} />
                <div class="mt-4">
                  <ChronologyTable agentOutputs={generation?.agentOutputs} />
                </div>
                <div class="mt-4">
                  <FilesPanel {projectId} reportId={report._id} />
                </div>
                <LogsPanel {projectId} />
              </div>
            </div>
          </div>
        {/if}

        <!-- Draggable divider -->
        {#if !chatFull && report && user}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            onmousedown={startDrag}
            title="Drag to resize"
            class="group flex w-3 flex-none cursor-col-resize items-center justify-center"
          >
            <div class="h-10 w-1 rounded-full bg-gray-300 transition-colors group-hover:bg-primary"></div>
          </div>
        {/if}

        <!-- Chat rail — resizable / full-screen -->
        {#if report && user}
          <aside
            class="flex min-h-0 flex-none flex-col bg-canvas py-6 pl-1 pr-6"
            style={`width: ${chatFull ? "100%" : `${chatRatio * 100}%`}`}
          >
            <div class="flex h-full flex-col overflow-hidden rounded-2xl border border-chrome bg-white shadow-sm">
              {#if AGENT_CHAT}
                <AgentChatPanel
                  {projectId}
                  reportId={report._id}
                  pendingHighlight={pendingChatHighlight}
                  onClearHighlight={() => (pendingChatHighlight = null)}
                  onReferenceText={(texts, scrollTo) => editorRef?.highlightText(texts, scrollTo)}
                  onReviewReplacements={startReplaceReview}
                  reviewingId={replaceSession?.messageId ?? null}
                />
              {:else}
                <ChatPanel
                  {projectId}
                  reportId={report._id}
                  pendingHighlight={pendingChatHighlight}
                  onClearHighlight={() => (pendingChatHighlight = null)}
                  onReferenceText={(texts, scrollTo) => editorRef?.highlightText(texts, scrollTo)}
                  onReviewReplacements={startReplaceReview}
                  reviewingMessageId={(replaceSession?.messageId ?? null) as Id<"chatMessages"> | null}
                />
              {/if}
            </div>
          </aside>
        {/if}
      </div>
    {/if}

    <!-- BNH-30: one-by-one replace stepper — Word-style "replace & find next" -->
    {#if replaceSession}
      <div class="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2">
        <div class="card flex items-center gap-3 px-4 py-3 shadow-xl">
          <div class="flex flex-col">
            <span class="text-xs font-medium text-gray-400">
              Reviewing replacements
            </span>
            <span class="text-sm font-semibold text-navy">
              {replaceSession.current
                ? `Instance ${replaceSession.position} of ${replaceSession.total}`
                : "Done"}
              {#if replaceSession.current}
                <span class="ml-2 font-normal text-gray-500">
                  “{replaceSession.current.text}” →
                  <span class="text-primary-dark">
                    {replaceSession.current.replaceWith}
                  </span>
                </span>
              {/if}
            </span>
          </div>
          <div class="ml-2 flex items-center gap-1.5">
            <button
              onclick={replaceAndNext}
              class="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-600"
            >
              Replace · Next
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
            <button
              onclick={replaceAllRemaining}
              class="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-600"
            >
              Replace All
            </button>
            <button
              onclick={rejectAndNext}
              class="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-600"
            >
              Reject
            </button>
            <button
              onclick={endReplaceReview}
              title="Stop reviewing"
              class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-primary-wash hover:text-gray-600"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- BNH-30: transient notice (e.g. text not found to replace) -->
    {#if replaceNotice}
      <div class="fixed bottom-6 left-1/2 z-[85] -translate-x-1/2 rounded-lg bg-navy px-4 py-2 text-sm text-white shadow-xl">
        {replaceNotice}
      </div>
    {/if}

    <!-- Comment authoring + hover overlay (single view) -->
    {#if !awaitingSelection && report && user}
      <CommentOverlay
        {projectId}
        reportId={report._id}
        commenterId={user._id}
        commenterName={user.name ?? user.email ?? "Writer"}
        {hoveredCommentId}
        {pendingHighlight}
        onClearPending={() => (pendingHighlight = null)}
      />
    {/if}

    <!-- Version history modal -->
    {#if showHistory && report}
      <VersionHistory
        reportId={report._id}
        onClose={() => (showHistory = false)}
      />
    {/if}

    <!-- No report, not generating — show transcript -->
    {#if !report && !isGenerating && !awaitingSelection}
      <main class="mx-auto w-full max-w-3xl min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <h1 class="text-2xl font-bold text-gray-900">{project.title}</h1>
        <p class="mt-1 text-sm text-gray-500">{project.clientName}</p>

        <div class="mt-8">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Transcript
            </h2>
            {#if transcript}
              <Button onclick={handleRegenerate} class="text-xs">
                Generate Report
              </Button>
            {/if}
          </div>
          {#if transcript}
            <div class="mt-3 rounded-lg border border-gray-200 bg-white p-4">
              <p class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-700">
                {transcript.content}
              </p>
            </div>
          {:else}
            <p class="mt-3 text-sm text-gray-400">
              Loading transcript...
            </p>
          {/if}
        </div>
      </main>
    {/if}
  </div>
{/if}

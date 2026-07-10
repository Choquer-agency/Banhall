<script lang="ts">
  import { page } from "$app/state";
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import NameGate from "$lib/components/review/NameGate.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import ReadOnlyEditor from "$lib/components/review/ReadOnlyEditor.svelte";
  import MarginComments from "$lib/components/comments/MarginComments.svelte";
  import type { CommentRange } from "$lib/components/editor/types";
  type CommenterSummary = { _id: Id<"commenters">; name: string; color: string };

  // Public page — no auth; access is via the share token.
  const shareToken = $derived(page.params.shareToken ?? "");

  const projectQ = useQuery(api.projects.getProjectByShareToken, () => ({
    shareToken,
  }));
  const reportQ = useQuery(api.reports.getLatestReport, () =>
    projectQ.data ? { projectId: projectQ.data._id, shareToken } : "skip"
  );
  const commentsQ = useQuery(api.comments.listComments, () =>
    projectQ.data && reportQ.data
      ? { projectId: projectQ.data._id, reportId: reportQ.data._id, shareToken }
      : "skip"
  );

  const getOrCreateCommenter = useMutation(api.comments.getOrCreateCommenter);
  const logView = useMutation(api.reportViews.logClientView);

  let editorComponent: ReadOnlyEditor | null = $state(null);
  let scrollEl: HTMLDivElement | null = $state(null);
  let commenter = $state<CommenterSummary | null>(null);
  let pendingHighlight = $state<{ from: number; to: number; text: string } | null>(null);
  let activeCommentId = $state<string | null>(null);
  let hoveredCommentId = $state<string | null>(null);

  async function handleNameEnter(name: string) {
    const project = projectQ.data;
    if (!project) return;
    const result = await getOrCreateCommenter({
      projectId: project._id,
      name,
      shareToken,
    });
    if (result) {
      commenter = result;
      logView({
        projectId: project._id,
        shareToken,
        viewerName: name,
      }).catch(() => {});
    }
  }

  function handleComment(selection: { from: number; to: number; text: string }) {
    pendingHighlight = selection;
  }

  // Build comment ranges with commenter type info for color differentiation
  const commentRanges: CommentRange[] = $derived(
    (commentsQ.data ?? [])
      .filter((c) => !c.resolved)
      .map((c) => ({
        id: c._id,
        from: c.highlightFrom,
        to: c.highlightTo,
        active: c._id === activeCommentId,
        isClient: c.commenterType === "client",
      }))
  );
</script>

{#if projectQ.data === undefined}
  <!-- Loading -->
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else if projectQ.data === null}
  <!-- Invalid link -->
  <div class="flex flex-1 flex-col items-center justify-center bg-canvas px-4">
    <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
      <svg class="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
    </div>
    <h1 class="text-title">Report Not Found</h1>
    <p class="mt-1 text-sm text-gray-500">This review link may be invalid or expired.</p>
  </div>
{:else if !commenter}
  <!-- Name gate -->
  <NameGate
    projectTitle={projectQ.data.title}
    clientName={projectQ.data.clientName}
    onEnter={handleNameEnter}
  />
{:else if !reportQ.data}
  <!-- Report not ready -->
  <div class="flex flex-1 flex-col items-center justify-center bg-canvas px-4">
    <Spinner />
    <h1 class="text-title mt-4">{projectQ.data.title}</h1>
    <p class="mt-1 text-sm text-gray-500">The report is being prepared. This page will update automatically.</p>
  </div>
{:else}
  {@const project = projectQ.data}
  {@const report = reportQ.data}
  <div class="flex flex-1 flex-col bg-canvas">
    <!-- Top bar — public client header: same fir bar + baseline rule as AppNav,
         but no internal navigation (access is via the share token). -->
    <header class="sticky top-0 z-50 w-full">
      <div class="w-full bg-navy">
        <div class="mx-auto flex h-13 w-full max-w-[1100px] items-center justify-between gap-3 px-6">
          <div class="flex min-w-0 items-center gap-2.5">
            <img src="/logo.png" alt="Banhall" width="84" height="84" class="-my-5 flex-shrink-0 brightness-0 invert" />
            <div class="min-w-0">
              <h1 class="truncate text-sm font-semibold text-white">{project.title}</h1>
              <p class="truncate text-xs text-white/50">{project.clientName}</p>
            </div>
          </div>
          <div class="flex flex-shrink-0 items-center gap-1.5">
            <div
              class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
              style={`background-color: ${commenter.color}`}
            >
              {commenter.name[0]?.toUpperCase()}
            </div>
            <span class="hidden text-xs text-white/60 sm:inline">{commenter.name}</span>
          </div>
        </div>
      </div>
      <div class="nav-baseline h-0.5 w-full"></div>
    </header>

    <!-- Main content with margin comments — same layout as writer page -->
    <div bind:this={scrollEl} class="flex-1 overflow-y-auto">
      <div class="relative mx-auto max-w-[1100px] px-6 py-8">
        <!-- Editor column -->
        <div class="max-w-[680px]">
          <ReadOnlyEditor
            bind:this={editorComponent}
            content={report.content}
            onComment={handleComment}
            {commentRanges}
            onHoverComment={(id) => (hoveredCommentId = id)}
          />
          <p class="mt-8 text-center text-xs text-gray-300">
            Select text to leave a comment.
          </p>
        </div>

        <!-- Margin comments — positioned to the right -->
        <div class="absolute top-8 right-6" style="left: calc(680px + 2rem + 1.5rem); width: 256px">
          <MarginComments
            projectId={project._id}
            reportId={report._id}
            commenterId={commenter._id}
            commenterType="client"
            commenterName={commenter.name}
            {pendingHighlight}
            onClearPending={() => (pendingHighlight = null)}
            editorHandle={editorComponent}
            scrollContainer={scrollEl}
            {activeCommentId}
            onActiveCommentChange={(id) => (activeCommentId = id)}
            {hoveredCommentId}
            {shareToken}
          />
        </div>
      </div>
    </div>
  </div>
{/if}

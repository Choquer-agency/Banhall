<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import CommentThread from "./CommentThread.svelte";
  import CommentInput from "./CommentInput.svelte";

  /**
   * Right-hand comments sidebar (port of src/components/comments/CommentSidebar.tsx).
   *
   * Props:
   * - projectId / reportId: scope for the comment queries + new comments
   * - commenterId / commenterType / commenterName: identity of the viewer
   * - pendingHighlight: { from, to, text } selection awaiting a new comment (shows the input)
   * - onClearPending: clear the pending selection (cancel / after submit)
   * - onCommentClick: (from, to) => void — scroll the editor to the highlight
   * - isOpen / onClose: visibility control (renders nothing when closed)
   * - activeCommentId / onActiveCommentChange: selected-comment sync with the editor
   * - shareToken: client review token (passed through to queries/mutations)
   */
  let {
    projectId,
    reportId,
    commenterId,
    commenterType,
    commenterName,
    pendingHighlight = null,
    onClearPending,
    onCommentClick,
    isOpen,
    onClose,
    activeCommentId = null,
    onActiveCommentChange,
    shareToken,
  }: {
    projectId: Id<"projects">;
    reportId: Id<"reports">;
    commenterId: string;
    commenterType: "client" | "writer";
    commenterName: string;
    pendingHighlight?: { from: number; to: number; text: string } | null;
    onClearPending?: () => void;
    onCommentClick?: (from: number, to: number) => void;
    isOpen: boolean;
    onClose: () => void;
    activeCommentId?: string | null;
    onActiveCommentChange?: (id: string | null) => void;
    shareToken?: string;
  } = $props();

  const commentsQ = useQuery(api.comments.listComments, () => ({ projectId, reportId, shareToken }));
  const commentersQ = useQuery(api.comments.listCommenters, () => ({ projectId, shareToken }));
  const addComment = useMutation(api.comments.addComment);
  const resolveComment = useMutation(api.comments.resolveComment);
  const unresolveComment = useMutation(api.comments.unresolveComment);
  const acceptEdit = useMutation(api.comments.acceptEdit);
  type Comment = NonNullable<typeof commentsQ.data>[number];
  type Commenter = NonNullable<typeof commentersQ.data>[number];

  let showResolved = $state(false);

  const commenterMap = $derived.by(() => {
    const map = new Map<string, Commenter>();
    commentersQ.data?.forEach((c) => map.set(c._id, c));
    return map;
  });

  const sorted = $derived(
    [...(commentsQ.data ?? [])].sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      return a.highlightFrom - b.highlightFrom;
    })
  );

  const activeComments = $derived(sorted.filter((c) => !c.resolved));
  const resolvedComments = $derived(sorted.filter((c) => c.resolved));
  const totalActive = $derived(activeComments.length);

  async function handleSubmitComment(body: string, suggestedEdit?: string) {
    if (!pendingHighlight) return;
    await addComment({
      projectId,
      reportId,
      commenterId,
      highlightFrom: pendingHighlight.from,
      highlightTo: pendingHighlight.to,
      highlightText: pendingHighlight.text,
      body,
      ...(suggestedEdit ? { suggestedEdit } : {}),
      shareToken,
    });
    onClearPending?.();
  }

  function handleCommentClick(comment: Comment) {
    onActiveCommentChange?.(comment._id);
    onCommentClick?.(comment.highlightFrom, comment.highlightTo);
  }
</script>

{#if isOpen}
  <aside class="flex h-full w-80 flex-col border-l border-gray-200 bg-white" aria-labelledby="comments-heading">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
      <div class="flex items-center gap-2">
        <h3 id="comments-heading" class="text-sm font-semibold text-gray-900">Comments</h3>
        {#if totalActive > 0}
          <span class="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-navy px-1.5 text-[10px] font-bold text-white">
            {totalActive}
          </span>
        {/if}
      </div>
      <button
        type="button"
        onclick={onClose}
        aria-label="Close comments"
        class="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-primary-wash hover:text-gray-600"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- New comment input -->
    {#if pendingHighlight}
      <div class="border-b border-gray-100 px-4 py-3">
        <div class="mb-2 rounded-md border border-navy/20 bg-navy/5 px-2.5 py-1.5">
          <p class="text-xs leading-relaxed text-gray-600 line-clamp-3">
            &ldquo;{pendingHighlight.text}&rdquo;
          </p>
        </div>
        <CommentInput
          {commenterName}
          onSubmit={handleSubmitComment}
          onCancel={onClearPending}
          autoFocus
          highlightText={pendingHighlight.text}
        />
      </div>
    {/if}

    <!-- Comment list -->
    <div class="flex-1 overflow-y-auto">
      {#if activeComments.length === 0 && !pendingHighlight}
        <div class="px-4 py-8 text-center">
          <svg class="mx-auto h-8 w-8 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          <p class="mt-2 text-sm text-gray-400">No comments yet</p>
          <p class="mt-1 text-xs text-gray-400">
            Select text, then use the Comment toolbar action or keyboard shortcut.
          </p>
        </div>
      {/if}

      <div class="divide-y divide-gray-100">
        {#each activeComments as comment (comment._id)}
          <CommentThread
            {comment}
            commenter={commenterMap.get(comment.commenterId) ?? null}
            {commenterType}
            onResolve={commenterType === "writer" ? () => resolveComment({ commentId: comment._id }) : undefined}
            onAcceptEdit={commenterType === "writer" && comment.suggestedEdit ? () => acceptEdit({ commentId: comment._id }) : undefined}
            onClick={() => handleCommentClick(comment)}
            isActive={activeCommentId === comment._id}
          />
        {/each}
      </div>

      <!-- Resolved comments -->
      {#if resolvedComments.length > 0}
        <div class="border-t border-gray-100">
          <button
            type="button"
            aria-expanded={showResolved}
            aria-controls="resolved-comments"
            onclick={() => (showResolved = !showResolved)}
            class="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-gray-400 hover:text-gray-600"
          >
            <svg
              class={`h-3 w-3 transition-transform ${showResolved ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            {resolvedComments.length} resolved
          </button>

          {#if showResolved}
            <div id="resolved-comments" class="divide-y divide-gray-50">
              {#each resolvedComments as comment (comment._id)}
                <CommentThread
                  {comment}
                  commenter={commenterMap.get(comment.commenterId) ?? null}
                  {commenterType}
                  onUnresolve={commenterType === "writer" ? () => unresolveComment({ commentId: comment._id }) : undefined}
                  onClick={() => handleCommentClick(comment)}
                  resolved
                  isActive={activeCommentId === comment._id}
                />
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </aside>
{/if}

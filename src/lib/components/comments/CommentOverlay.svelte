<script lang="ts">
  import { rootScale } from "$lib/rootScale";
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import CommentInput from "./CommentInput.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { popoverPop } from "$lib/motion";

  /**
   * Floating comment UI for the writer editor (port of src/components/comments/CommentOverlay.tsx).
   * Renders two fixed-position layers:
   * - an authoring popover anchored to the selection (when `pendingHighlight` is set,
   *   at pendingHighlight.x/y viewport coords, z-[80])
   * - a hover card next to an existing highlight (when `hoveredCommentId` matches a
   *   [data-comment-id] element in the editor; anchored to its bounding rect, z-[70])
   *
   * Props:
   * - projectId / reportId: scope for queries + new comments
   * - commenterId / commenterName: identity of the writer
   * - hoveredCommentId: id of the highlight currently hovered in the editor (null = none)
   * - pendingHighlight: { from, to, text, x?, y? } selection awaiting a new comment
   * - onClearPending: clear the pending selection (cancel / after submit)
   */
  let {
    projectId,
    reportId,
    commenterId,
    commenterName,
    hoveredCommentId,
    pendingHighlight,
    onClearPending,
    onBeforeAcceptEdit,
  }: {
    projectId: Id<"projects">;
    reportId: Id<"reports">;
    commenterId: string;
    commenterName: string;
    hoveredCommentId: string | null;
    pendingHighlight: {
      from: number;
      to: number;
      text: string;
      x?: number;
      y?: number;
    } | null;
    onClearPending: () => void;
    onBeforeAcceptEdit?: () => Promise<unknown>;
  } = $props();

  const commentsQ = useQuery(api.comments.listComments, () => ({ projectId, reportId }));
  const commentersQ = useQuery(api.comments.listCommenters, () => ({ projectId }));
  const addComment = useMutation(api.comments.addComment);
  const resolveComment = useMutation(api.comments.resolveComment);
  const acceptEdit = useMutation(api.comments.acceptEdit);
  type Comment = NonNullable<typeof commentsQ.data>[number];
  type Commenter = NonNullable<typeof commentersQ.data>[number];

  let acceptErrors = $state<Record<string, string>>({});
  let accepting = $state<Record<string, boolean>>({});

  async function handleAcceptEdit(commentId: Id<"comments">) {
    if (accepting[commentId]) return;
    accepting = { ...accepting, [commentId]: true };
    acceptErrors = Object.fromEntries(Object.entries(acceptErrors).filter(([id]) => id !== commentId));
    try {
      if (onBeforeAcceptEdit) {
        await onBeforeAcceptEdit();
      }
      await acceptEdit({ commentId });
      activeId = null;
    } catch (error) {
      acceptErrors = {
        ...acceptErrors,
        [commentId]: userErrorMessage(error, "The suggested edit could not be applied."),
      };
    } finally {
      accepting = Object.fromEntries(Object.entries(accepting).filter(([id]) => id !== commentId));
    }
  }

  const commenterMap = $derived.by(() => {
    const map = new Map<string, Commenter>();
    commentersQ.data?.forEach((c) => map.set(c._id, c));
    return map;
  });

  // Latch the hovered comment so the card stays while the cursor moves onto it.
  let activeId = $state<string | null>(null);
  let rect = $state<DOMRect | null>(null);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (hoveredCommentId) {
      if (hideTimer) clearTimeout(hideTimer);
      const el = document.querySelector(`[data-comment-id="${hoveredCommentId}"]`);
      if (el) rect = el.getBoundingClientRect();
      activeId = hoveredCommentId;
    } else if (activeId) {
      hideTimer = setTimeout(() => (activeId = null), 220);
    }
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
    };
  });

  async function handleSubmit(body: string, suggestedEdit?: string) {
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
    });
    onClearPending();
  }

  const activeComment = $derived(
    commentsQ.data?.find((c) => c._id === activeId && !c.resolved)
  );
</script>

{#snippet commentCard(comment: Comment, commenter: Commenter | undefined)}
  {@const color = commenter?.color ?? "var(--color-ink-faint)"}
  {@const name = commenter?.name ?? "Consultant"}
  {@const isAccepting = Boolean(accepting[comment._id])}
  {@const acceptError = acceptErrors[comment._id]}
  <div class="rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
    <p class="line-clamp-1 text-xs leading-relaxed text-gray-400">
      &ldquo;{comment.highlightText}&rdquo;
    </p>
    <div class="mt-1.5 flex items-center gap-1.5">
      <div
        class="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[0.5625rem] font-medium text-white"
        style={`background-color: ${color}`}
      >
        {name[0]?.toUpperCase()}
      </div>
      <span class="text-[0.6875rem] font-medium text-gray-700">{name}</span>
      {#if comment.commenterType === "client"}
        <span class="rounded bg-purple-50 px-1 py-0.5 text-[0.5625rem] font-medium text-purple-600">
          Client
        </span>
      {/if}
    </div>
    <p class="mt-1 text-sm leading-relaxed text-gray-800">{comment.body}</p>
    {#if comment.suggestedEdit}
      <div class="mt-1.5 rounded border border-primary/20 bg-primary/5 px-2 py-1.5">
        <p class="mb-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-primary-dark">
          Suggested edit
        </p>
        <p class="text-xs text-gray-700">{comment.suggestedEdit}</p>
      </div>
    {/if}
    {#if acceptError}
      <p class="mt-1.5 text-xs text-red-600" role="alert">{acceptError}</p>
    {/if}
    <div class="mt-2 flex items-center gap-3">
      {#if comment.suggestedEdit}
        <button
          type="button"
          disabled={isAccepting}
          onclick={() => handleAcceptEdit(comment._id)}
          class="rounded bg-primary px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {isAccepting ? "Applying..." : "Accept edit"}
        </button>
      {/if}
      <button
        type="button"
        onclick={() => {
          resolveComment({ commentId: comment._id });
          activeId = null;
        }}
        class="text-xs font-medium text-gray-400 transition-colors hover:text-green-600"
      >
        Resolve
      </button>
    </div>
  </div>
{/snippet}

<!-- Authoring popover near the selection -->
{#if pendingHighlight}
  <div
    transition:popoverPop
    role="dialog"
    aria-modal="false"
    aria-label="Add comment to selected text"
    tabindex="-1"
    onkeydown={(event) => {
      if (event.key === "Escape") onClearPending();
    }}
    class="fixed z-[80] w-72"
    style={`top: ${Math.min(
      (pendingHighlight.y ?? 120) + 8,
      (typeof window !== "undefined" ? window.innerHeight : 800) - 240 * rootScale()
    )}px; left: ${Math.min(
      pendingHighlight.x ?? 120,
      (typeof window !== "undefined" ? window.innerWidth : 1200) - 304 * rootScale()
    )}px`}
  >
    <div class="rounded-lg border border-navy/20 bg-white p-3 shadow-lg">
      <p class="mb-2 line-clamp-2 text-xs leading-relaxed text-gray-500">
        &ldquo;{pendingHighlight.text}&rdquo;
      </p>
      <CommentInput
        {commenterName}
        onSubmit={handleSubmit}
        onCancel={onClearPending}
        autoFocus
        highlightText={pendingHighlight.text}
      />
    </div>
  </div>
{/if}

<!-- Hover card showing an existing comment -->
{#if activeComment && rect && !pendingHighlight}
  <div
    transition:popoverPop
    class="fixed z-[70] w-64"
    role="dialog"
    aria-label="Comment details"
    tabindex="-1"
    style={`top: ${Math.min(
      rect.top,
      (typeof window !== "undefined" ? window.innerHeight : 800) - 200 * rootScale()
    )}px; left: ${Math.min(
      rect.right + 12,
      (typeof window !== "undefined" ? window.innerWidth : 1200) - 272 * rootScale()
    )}px`}
    onmouseenter={() => {
      if (hideTimer) clearTimeout(hideTimer);
    }}
    onmouseleave={() => (activeId = null)}
  >
    {@render commentCard(activeComment, commenterMap.get(activeComment.commenterId))}
  </div>
{/if}

<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import CommentInput from "./CommentInput.svelte";
  import type { EditorHandle } from "$lib/components/editor/types";

  let {
    projectId,
    reportId,
    commenterId,
    commenterType,
    commenterName,
    pendingHighlight = null,
    onClearPending,
    editorHandle,
    scrollContainer,
    activeCommentId,
    onActiveCommentChange,
    hoveredCommentId = null,
    shareToken,
  }: {
    projectId: Id<"projects">;
    reportId: Id<"reports">;
    commenterId: string;
    commenterType: "client" | "writer";
    commenterName: string;
    pendingHighlight?: { from: number; to: number; text: string } | null;
    onClearPending?: () => void;
    editorHandle: EditorHandle | null;
    scrollContainer: HTMLDivElement | null;
    activeCommentId: string | null;
    onActiveCommentChange: (id: string | null) => void;
    hoveredCommentId?: string | null;
    shareToken?: string;
  } = $props();

  const commentsQ = useQuery(api.comments.listComments, () => ({ projectId, reportId, shareToken }));
  const commentersQ = useQuery(api.comments.listCommenters, () => ({ projectId, shareToken }));
  const addComment = useMutation(api.comments.addComment);
  const resolveComment = useMutation(api.comments.resolveComment);
  const acceptEdit = useMutation(api.comments.acceptEdit);
  type Commenter = NonNullable<typeof commentersQ.data>[number];

  let positions = $state(new Map<string, number>());
  let pendingY = $state<number | null>(null);
  let rafId: number | undefined;
  const cardEls = new Map<string, HTMLDivElement>();
  const measuredHeights = new Map<string, number>();
  let layoutTick = $state(0); // bumps when measured heights change

  function registerCard(node: HTMLElement, id: string) {
    cardEls.set(id, node as HTMLDivElement);
    return {
      destroy() {
        cardEls.delete(id);
      },
    };
  }

  const commenterMap = $derived.by(() => {
    const map = new Map<string, Commenter>();
    commentersQ.data?.forEach((c) => map.set(c._id, c));
    return map;
  });

  // Calculate Y positions for all comments
  function recalcPositions() {
    const handle = editorHandle;
    const comments = commentsQ.data;
    if (!handle || !comments) return;

    const newPositions = new Map<string, number>();
    for (const comment of comments) {
      if (comment.resolved) continue;
      const y = handle.getYForPos(comment.highlightFrom, comment.highlightText);
      if (y !== null) {
        newPositions.set(comment._id, y);
      }
    }
    positions = newPositions;

    // Position for pending comment
    if (pendingHighlight) {
      pendingY = handle.getYForPos(pendingHighlight.from);
    } else {
      pendingY = null;
    }
  }

  // Recalculate on scroll/resize + initial calc (editor needs a beat to render)
  $effect(() => {
    const scrollEl = scrollContainer;
    void editorHandle; // re-arm the initial calc once the editor binds
    if (!scrollEl) return;

    const handleScroll = () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(recalcPositions);
    };

    // Initial calc after a short delay (editor needs to render)
    const timer = setTimeout(recalcPositions, 100);
    scrollEl.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);

    return () => {
      clearTimeout(timer);
      scrollEl.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  });

  // Recalc when comments / pending highlight change
  $effect(() => {
    void commentsQ.data;
    void pendingHighlight;
    void editorHandle;
    const timer = setTimeout(recalcPositions, 50);
    return () => clearTimeout(timer);
  });

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
      ...(shareToken ? { shareToken } : {}),
    });
    onClearPending?.();
  }

  const activeComments = $derived(
    [...(commentsQ.data ?? [])]
      .filter((c) => !c.resolved)
      .sort((a, b) => a.highlightFrom - b.highlightFrom)
  );

  // Measure card heights after render
  $effect(() => {
    void commentsQ.data;
    void pendingHighlight;
    const timer = setTimeout(() => {
      let changed = false;
      cardEls.forEach((el, id) => {
        const h = el.getBoundingClientRect().height;
        if (measuredHeights.get(id) !== h) {
          measuredHeights.set(id, h);
          changed = true;
        }
      });
      if (changed) layoutTick++;
    }, 50);
    return () => clearTimeout(timer);
  });

  // Resolve overlapping positions — push comments down if they'd overlap
  const FALLBACK_HEIGHT = 160;
  const GAP = 16;

  const layout = $derived.by(() => {
    void layoutTick; // re-run when measured heights change
    const resolved = new Map<string, number>();
    let lastBottom = -Infinity;

    type LayoutItem = { id: string; y: number };
    const layoutItems: LayoutItem[] = [];

    if (pendingHighlight && pendingY !== null) {
      layoutItems.push({ id: "__pending__", y: pendingY });
    }
    for (const comment of activeComments) {
      const y = positions.get(comment._id);
      if (y !== undefined) {
        layoutItems.push({ id: comment._id, y });
      }
    }
    layoutItems.sort((a, b) => a.y - b.y);

    for (const item of layoutItems) {
      const targetY = item.y;
      const actualY = Math.max(targetY, lastBottom + GAP);
      resolved.set(item.id, actualY);
      const measured = measuredHeights.get(item.id);
      const fallback = item.id === "__pending__" ? 220 : FALLBACK_HEIGHT;
      const height = measured ?? fallback;
      lastBottom = actualY + height;
    }

    return { resolved, lastBottom };
  });

  function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
    });
  }
</script>

<div
  class="relative"
  style={`min-height: ${layout.lastBottom > 0 ? layout.lastBottom + FALLBACK_HEIGHT : 0}px`}
>
  <!-- Pending new comment -->
  {#if pendingHighlight && pendingY !== null}
    <div
      use:registerCard={"__pending__"}
      class="absolute right-0 w-64 transition-all duration-300"
      style={`top: ${layout.resolved.get("__pending__") ?? pendingY}px`}
    >
      <div class="rounded-lg border border-navy/20 bg-white p-3 shadow-sm">
        <p class="mb-2 text-xs leading-relaxed text-gray-500 line-clamp-2">
          &ldquo;{pendingHighlight.text}&rdquo;
        </p>
        <CommentInput
          {commenterName}
          onSubmit={handleSubmitComment}
          onCancel={onClearPending}
          autoFocus
          highlightText={pendingHighlight.text}
        />
      </div>
    </div>
  {/if}

  <!-- Existing comments -->
  {#each activeComments as comment (comment._id)}
    {@const y = layout.resolved.get(comment._id)}
    {#if y !== undefined}
      {@const commenter = commenterMap.get(comment.commenterId)}
      {@const color = commenter?.color ?? "var(--color-ink-faint)"}
      {@const name = commenter?.name ?? "Unknown"}
      {@const isActive = activeCommentId === comment._id}
      {@const isHovered = hoveredCommentId === comment._id}
      <div
        use:registerCard={comment._id}
        class={`absolute right-0 w-64 transition-all duration-300 ${
          isActive || isHovered ? "z-10" : "z-0"
        }`}
        style={`top: ${y}px`}
      >
        <div
          class={`rounded-lg border p-3 transition-all ${
            isActive
              ? comment.commenterType === "client"
                ? "border-primary/30 bg-primary/5 shadow-md"
                : "border-navy/30 bg-white shadow-md"
              : isHovered
                ? comment.commenterType === "client"
                  ? "border-primary/20 bg-primary/5 shadow"
                  : "border-gray-300 bg-amber-50/50 shadow"
                : comment.commenterType === "client"
                  ? "border-primary/10 bg-primary/5 shadow-sm hover:border-primary/20 hover:shadow"
                  : "border-gray-200 bg-white shadow-sm hover:border-gray-300 hover:shadow"
          }`}
        >
          <button
            type="button"
            class="w-full rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            aria-pressed={isActive}
            aria-label={`Locate comment from ${name}`}
            onclick={() => {
              onActiveCommentChange(comment._id);
              editorHandle?.scrollToPosition(
                comment.highlightFrom,
                comment.highlightTo,
                comment.highlightText
              );
            }}
          >
          <!-- Quoted text -->
          <p class="text-xs leading-relaxed text-gray-400 line-clamp-1">
            &ldquo;{comment.highlightText}&rdquo;
          </p>

          <!-- Author + time -->
          <div class="mt-1.5 flex items-center gap-1.5">
            <div
              class="h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
              style={`background-color: ${color}`}
            >
              {name[0]?.toUpperCase()}
            </div>
            <span class="text-[11px] font-medium text-gray-700">{name}</span>
            <span class="text-[11px] text-gray-400">{formatTimeAgo(comment.createdAt)}</span>
            {#if comment.commenterType === "client"}
              <span class="rounded bg-purple-50 px-1 py-0.5 text-[9px] font-medium text-purple-600">
                Client
              </span>
            {/if}
          </div>

          <!-- Body -->
          <p class="mt-1 text-sm leading-relaxed text-gray-800">
            {comment.body}
          </p>
          </button>

          <!-- Suggested edit -->
          {#if comment.suggestedEdit}
            <div class="mt-1.5 rounded border border-primary/20 bg-primary/5 px-2 py-1.5">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-primary-dark mb-0.5">Suggested edit</p>
              <p class="text-xs text-gray-700">{comment.suggestedEdit}</p>
              {#if commenterType === "writer"}
                <div class="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onclick={(e) => {
                      e.stopPropagation();
                      acceptEdit({ commentId: comment._id });
                    }}
                    class="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-white hover:bg-primary-dark transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onclick={(e) => {
                      e.stopPropagation();
                      resolveComment({ commentId: comment._id });
                    }}
                    class="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Actions -->
          {#if commenterType === "writer" && !comment.suggestedEdit}
            <button
              type="button"
              onclick={(e) => {
                e.stopPropagation();
                resolveComment({ commentId: comment._id });
              }}
              class="mt-1.5 text-xs text-gray-400 hover:text-green-600 transition-colors"
            >
              Resolve
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {/each}
</div>

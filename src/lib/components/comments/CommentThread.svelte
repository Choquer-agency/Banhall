<script lang="ts">
  import type { Id } from "../../../../convex/_generated/dataModel";
  type CommentSummary = {
    _id: Id<"comments">;
    commenterId: string;
    commenterType: "client" | "writer";
    highlightText: string;
    body: string;
    suggestedEdit?: string;
    createdAt: number;
  };
  type CommenterSummary = {
    _id: Id<"commenters">;
    name: string;
    color: string;
  };

  /**
   * One comment card in the sidebar list (port of src/components/comments/CommentThread.tsx).
   *
   * Props:
   * - comment: the comment doc
   * - commenter: resolved commenter doc (null → gray "Unknown" avatar)
   * - commenterType: role of the *viewer* ("writer" sees resolve/accept actions)
   * - onResolve / onUnresolve / onAcceptEdit / onClick: optional callbacks
   * - resolved: render in the resolved (dimmed, struck-through) style
   * - isActive: highlighted state when the comment is selected in the editor
   */
  let {
    comment,
    commenter,
    commenterType,
    onResolve,
    onUnresolve,
    onAcceptEdit,
    onClick,
    resolved = false,
    isActive = false,
  }: {
    comment: CommentSummary;
    commenter: CommenterSummary | null;
    commenterType: "client" | "writer";
    onResolve?: () => void;
    onUnresolve?: () => void;
    onAcceptEdit?: () => void;
    onClick?: () => void;
    resolved?: boolean;
    isActive?: boolean;
  } = $props();

  const timeAgo = $derived(formatTimeAgo(comment.createdAt));
  const color = $derived(commenter?.color ?? "var(--color-ink-faint)");
  const name = $derived(commenter?.name ?? "Unknown");

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
  class={`border-l-2 px-4 py-3 transition-all ${
    isActive
      ? "border-l-navy bg-blue-50/50"
      : resolved
        ? "border-l-transparent opacity-50 hover:opacity-75"
        : "border-l-transparent hover:bg-primary-wash"
  }`}
>
  <button
    type="button"
    class="w-full rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
    aria-pressed={isActive}
    aria-label={`Locate comment from ${name}`}
    onclick={onClick}
  >
  <!-- Quoted text — prominent -->
  <div
    class={`mb-2 rounded-md border px-2.5 py-1.5 ${
      isActive ? "border-navy/20 bg-navy/5" : "border-gray-200 bg-gray-50"
    }`}
  >
    <p class="text-xs leading-relaxed text-gray-500 line-clamp-2">
      &ldquo;{comment.highlightText}&rdquo;
    </p>
  </div>

  <!-- Header -->
  <div class="flex items-center gap-2">
    <div
      class="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
      style={`background-color: ${color}`}
    >
      {name[0]?.toUpperCase()}
    </div>
    <span class="text-xs font-medium text-gray-900">{name}</span>
    <span class="text-xs text-gray-400">{timeAgo}</span>
    {#if comment.commenterType === "client"}
      <span class="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-600">
        Client
      </span>
    {/if}
  </div>

  <!-- Comment body -->
  <p
    class={`mt-1.5 text-sm leading-relaxed ${
      resolved ? "text-gray-400 line-through" : "text-gray-700"
    }`}
  >
    {comment.body}
  </p>
  </button>

  <!-- Suggested edit -->
  {#if comment.suggestedEdit && !resolved}
    <div class="mt-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5">
      <p class="text-[10px] font-semibold uppercase tracking-wide text-primary-dark mb-1">Suggested edit</p>
      <p class="text-xs text-gray-700 leading-relaxed">{comment.suggestedEdit}</p>
      {#if commenterType === "writer" && onAcceptEdit}
        <div class="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onclick={(e) => {
              e.stopPropagation();
              onAcceptEdit();
            }}
            class="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-white hover:bg-primary-dark transition-colors"
          >
            Accept edit
          </button>
          <button
            type="button"
            onclick={(e) => {
              e.stopPropagation();
              onResolve?.();
            }}
            class="text-[10px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
          >
            Dismiss
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Actions -->
  <div class="mt-2 flex items-center gap-3">
    {#if !resolved && onResolve && commenterType === "writer" && !comment.suggestedEdit}
      <button
        type="button"
        onclick={(e) => {
          e.stopPropagation();
          onResolve();
        }}
        class="text-xs font-medium text-gray-400 hover:text-green-600 transition-colors"
      >
        Resolve
      </button>
    {/if}
    {#if resolved && onUnresolve && commenterType === "writer"}
      <button
        type="button"
        onclick={(e) => {
          e.stopPropagation();
          onUnresolve();
        }}
        class="text-xs font-medium text-gray-400 hover:text-navy transition-colors"
      >
        Reopen
      </button>
    {/if}
  </div>
</div>

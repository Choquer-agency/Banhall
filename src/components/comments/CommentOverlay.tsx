"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id, Doc } from "../../../convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";
import { CommentInput } from "./CommentInput";

interface CommentOverlayProps {
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
}

export function CommentOverlay({
  projectId,
  reportId,
  commenterId,
  commenterName,
  hoveredCommentId,
  pendingHighlight,
  onClearPending,
}: CommentOverlayProps) {
  const comments = useQuery(api.comments.listComments, { projectId });
  const commenters = useQuery(api.comments.listCommenters, { projectId });
  const addComment = useMutation(api.comments.addComment);
  const resolveComment = useMutation(api.comments.resolveComment);

  const commenterMap = new Map<string, Doc<"commenters">>();
  commenters?.forEach((c) => commenterMap.set(c._id, c));

  // Latch the hovered comment so the card stays while the cursor moves onto it.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (hoveredCommentId) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      const el = document.querySelector(
        `[data-comment-id="${hoveredCommentId}"]`
      );
      if (el) setRect(el.getBoundingClientRect());
      setActiveId(hoveredCommentId);
    } else if (activeId) {
      hideTimer.current = setTimeout(() => setActiveId(null), 220);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [hoveredCommentId, activeId]);

  async function handleSubmit(body: string, suggestedEdit?: string) {
    if (!pendingHighlight) return;
    await addComment({
      projectId,
      reportId,
      commenterId,
      commenterType: "writer",
      highlightFrom: pendingHighlight.from,
      highlightTo: pendingHighlight.to,
      highlightText: pendingHighlight.text,
      body,
      ...(suggestedEdit ? { suggestedEdit } : {}),
    });
    onClearPending();
  }

  const activeComment = comments?.find((c) => c._id === activeId && !c.resolved);

  return (
    <>
      {/* Authoring popover near the selection */}
      {pendingHighlight && (
        <div
          className="fixed z-[80] w-72"
          style={{
            top: Math.min(
              (pendingHighlight.y ?? 120) + 8,
              (typeof window !== "undefined" ? window.innerHeight : 800) - 240
            ),
            left: Math.min(
              pendingHighlight.x ?? 120,
              (typeof window !== "undefined" ? window.innerWidth : 1200) - 304
            ),
          }}
        >
          <div className="rounded-lg border border-navy/20 bg-white p-3 shadow-lg">
            <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-gray-500">
              &ldquo;{pendingHighlight.text}&rdquo;
            </p>
            <CommentInput
              commenterName={commenterName}
              onSubmit={handleSubmit}
              onCancel={onClearPending}
              autoFocus
              highlightText={pendingHighlight.text}
            />
          </div>
        </div>
      )}

      {/* Hover card showing an existing comment */}
      {activeComment && rect && !pendingHighlight && (
        <div
          className="fixed z-[70] w-64"
          style={{
            top: Math.min(rect.top, (typeof window !== "undefined" ? window.innerHeight : 800) - 200),
            left: Math.min(rect.right + 12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 272),
          }}
          onMouseEnter={() => {
            if (hideTimer.current) clearTimeout(hideTimer.current);
          }}
          onMouseLeave={() => setActiveId(null)}
        >
          <CommentCard
            comment={activeComment}
            commenter={commenterMap.get(activeComment.commenterId)}
            onResolve={() => {
              resolveComment({ commentId: activeComment._id });
              setActiveId(null);
            }}
          />
        </div>
      )}
    </>
  );
}

function CommentCard({
  comment,
  commenter,
  onResolve,
}: {
  comment: Doc<"comments">;
  commenter?: Doc<"commenters">;
  onResolve: () => void;
}) {
  const color = commenter?.color ?? "#9CA3AF";
  const name = commenter?.name ?? "Writer";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
      <p className="line-clamp-1 text-xs leading-relaxed text-gray-400">
        &ldquo;{comment.highlightText}&rdquo;
      </p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <div
          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {name[0]?.toUpperCase()}
        </div>
        <span className="text-[11px] font-medium text-gray-700">{name}</span>
        {comment.commenterType === "client" && (
          <span className="rounded bg-purple-50 px-1 py-0.5 text-[9px] font-medium text-purple-600">
            Client
          </span>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-gray-800">{comment.body}</p>
      {comment.suggestedEdit && (
        <div className="mt-1.5 rounded border border-primary/20 bg-primary/5 px-2 py-1.5">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-dark">
            Suggested edit
          </p>
          <p className="text-xs text-gray-700">{comment.suggestedEdit}</p>
        </div>
      )}
      <button
        onClick={onResolve}
        className="mt-1.5 text-xs text-gray-400 transition-colors hover:text-green-600"
      >
        Resolve
      </button>
    </div>
  );
}

"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id, Doc } from "../../../convex/_generated/dataModel";
import { CommentThread } from "./CommentThread";
import { CommentInput } from "./CommentInput";
import { useState } from "react";

interface CommentSidebarProps {
  projectId: Id<"projects">;
  reportId: Id<"reports">;
  commenterId: string;
  commenterType: "client" | "writer";
  commenterName: string;
  /** Currently selected text range for new comment */
  pendingHighlight?: {
    from: number;
    to: number;
    text: string;
  } | null;
  onClearPending?: () => void;
  onCommentClick?: (from: number, to: number) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function CommentSidebar({
  projectId,
  reportId,
  commenterId,
  commenterType,
  commenterName,
  pendingHighlight,
  onClearPending,
  onCommentClick,
  isOpen,
  onClose,
}: CommentSidebarProps) {
  const comments = useQuery(api.comments.listComments, { projectId });
  const commenters = useQuery(api.comments.listCommenters, { projectId });
  const addComment = useMutation(api.comments.addComment);
  const resolveComment = useMutation(api.comments.resolveComment);
  const unresolveComment = useMutation(api.comments.unresolveComment);

  const [showResolved, setShowResolved] = useState(false);

  if (!isOpen) return null;

  const commenterMap = new Map<string, Doc<"commenters">>();
  commenters?.forEach((c) => commenterMap.set(c._id, c));

  const sorted = [...(comments ?? [])].sort((a, b) => {
    // Unresolved first, then by position in doc
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return a.highlightFrom - b.highlightFrom;
  });

  const activeComments = sorted.filter((c) => !c.resolved);
  const resolvedComments = sorted.filter((c) => c.resolved);

  async function handleSubmitComment(body: string) {
    if (!pendingHighlight) return;
    await addComment({
      projectId,
      reportId,
      commenterId,
      commenterType,
      highlightFrom: pendingHighlight.from,
      highlightTo: pendingHighlight.to,
      highlightText: pendingHighlight.text,
      body,
    });
    onClearPending?.();
  }

  return (
    <div className="flex h-full w-80 flex-col border-l border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Comments</h3>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* New comment input */}
      {pendingHighlight && (
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="mb-2 rounded bg-gray-50 px-2 py-1">
            <p className="text-xs italic text-gray-500 line-clamp-2">
              &ldquo;{pendingHighlight.text}&rdquo;
            </p>
          </div>
          <CommentInput
            commenterName={commenterName}
            onSubmit={handleSubmitComment}
            onCancel={onClearPending}
            autoFocus
          />
        </div>
      )}

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto">
        {activeComments.length === 0 && !pendingHighlight && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-gray-400">No comments yet.</p>
            <p className="mt-1 text-xs text-gray-300">
              Select text to add a comment.
            </p>
          </div>
        )}

        {activeComments.map((comment) => (
          <CommentThread
            key={comment._id}
            comment={comment}
            commenter={commenterMap.get(comment.commenterId) ?? null}
            commenterType={commenterType}
            onResolve={() => resolveComment({ commentId: comment._id })}
            onClick={() =>
              onCommentClick?.(comment.highlightFrom, comment.highlightTo)
            }
          />
        ))}

        {/* Resolved comments */}
        {resolvedComments.length > 0 && (
          <div className="border-t border-gray-100">
            <button
              onClick={() => setShowResolved(!showResolved)}
              className="flex w-full items-center gap-2 px-4 py-2 text-xs text-gray-400 hover:text-gray-600"
            >
              <svg
                className={`h-3 w-3 transition-transform ${showResolved ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {resolvedComments.length} resolved
            </button>

            {showResolved &&
              resolvedComments.map((comment) => (
                <CommentThread
                  key={comment._id}
                  comment={comment}
                  commenter={commenterMap.get(comment.commenterId) ?? null}
                  commenterType={commenterType}
                  onUnresolve={() =>
                    unresolveComment({ commentId: comment._id })
                  }
                  onClick={() =>
                    onCommentClick?.(
                      comment.highlightFrom,
                      comment.highlightTo
                    )
                  }
                  resolved
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

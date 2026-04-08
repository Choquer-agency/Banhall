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
  pendingHighlight?: {
    from: number;
    to: number;
    text: string;
  } | null;
  onClearPending?: () => void;
  onCommentClick?: (from: number, to: number) => void;
  isOpen: boolean;
  onClose: () => void;
  activeCommentId?: string | null;
  onActiveCommentChange?: (id: string | null) => void;
  shareToken?: string;
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
  activeCommentId,
  onActiveCommentChange,
  shareToken,
}: CommentSidebarProps) {
  const comments = useQuery(api.comments.listComments, { projectId, shareToken });
  const commenters = useQuery(api.comments.listCommenters, { projectId, shareToken });
  const addComment = useMutation(api.comments.addComment);
  const resolveComment = useMutation(api.comments.resolveComment);
  const unresolveComment = useMutation(api.comments.unresolveComment);

  const [showResolved, setShowResolved] = useState(false);

  if (!isOpen) return null;

  const commenterMap = new Map<string, Doc<"commenters">>();
  commenters?.forEach((c) => commenterMap.set(c._id, c));

  const sorted = [...(comments ?? [])].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return a.highlightFrom - b.highlightFrom;
  });

  const activeComments = sorted.filter((c) => !c.resolved);
  const resolvedComments = sorted.filter((c) => c.resolved);

  const totalActive = activeComments.length;

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
      shareToken,
    });
    onClearPending?.();
  }

  function handleCommentClick(comment: Doc<"comments">) {
    onActiveCommentChange?.(comment._id);
    onCommentClick?.(comment.highlightFrom, comment.highlightTo);
  }

  return (
    <div className="flex h-full w-80 flex-col border-l border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Comments</h3>
          {totalActive > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-navy px-1.5 text-[10px] font-bold text-white">
              {totalActive}
            </span>
          )}
        </div>
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
          <div className="mb-2 rounded-md border border-navy/20 bg-navy/5 px-2.5 py-1.5">
            <p className="text-xs leading-relaxed text-gray-600 line-clamp-3">
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
            <svg className="mx-auto h-8 w-8 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <p className="mt-2 text-sm text-gray-400">No comments yet</p>
            <p className="mt-1 text-xs text-gray-300">
              Select text and click the comment button
            </p>
          </div>
        )}

        <div className="divide-y divide-gray-100">
          {activeComments.map((comment) => (
            <CommentThread
              key={comment._id}
              comment={comment}
              commenter={commenterMap.get(comment.commenterId) ?? null}
              commenterType={commenterType}
              onResolve={() => resolveComment({ commentId: comment._id, shareToken })}
              onClick={() => handleCommentClick(comment)}
              isActive={activeCommentId === comment._id}
            />
          ))}
        </div>

        {/* Resolved comments */}
        {resolvedComments.length > 0 && (
          <div className="border-t border-gray-100">
            <button
              onClick={() => setShowResolved(!showResolved)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-gray-400 hover:text-gray-600"
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

            {showResolved && (
              <div className="divide-y divide-gray-50">
                {resolvedComments.map((comment) => (
                  <CommentThread
                    key={comment._id}
                    comment={comment}
                    commenter={commenterMap.get(comment.commenterId) ?? null}
                    commenterType={commenterType}
                    onUnresolve={() =>
                      unresolveComment({ commentId: comment._id, shareToken })
                    }
                    onClick={() => handleCommentClick(comment)}
                    resolved
                    isActive={activeCommentId === comment._id}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

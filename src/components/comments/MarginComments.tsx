"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id, Doc } from "../../../convex/_generated/dataModel";
import { CommentInput } from "./CommentInput";
import { useState, useEffect, useCallback, useRef } from "react";
import { EditorHandle } from "../editor/Editor";

interface MarginCommentsProps {
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
  editorRef: React.RefObject<EditorHandle | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  activeCommentId: string | null;
  onActiveCommentChange: (id: string | null) => void;
  hoveredCommentId?: string | null;
  shareToken?: string;
}

export function MarginComments({
  projectId,
  reportId,
  commenterId,
  commenterType,
  commenterName,
  pendingHighlight,
  onClearPending,
  editorRef,
  scrollContainerRef,
  activeCommentId,
  onActiveCommentChange,
  hoveredCommentId,
  shareToken,
}: MarginCommentsProps) {
  const comments = useQuery(api.comments.listComments, { projectId, shareToken });
  const commenters = useQuery(api.comments.listCommenters, { projectId, shareToken });
  const addComment = useMutation(api.comments.addComment);
  const resolveComment = useMutation(api.comments.resolveComment);
  const unresolveComment = useMutation(api.comments.unresolveComment);
  const acceptEdit = useMutation(api.comments.acceptEdit);

  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  const [pendingY, setPendingY] = useState<number | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const [layoutTick, setLayoutTick] = useState(0);
  void layoutTick; // triggers re-render when heights change

  const commenterMap = new Map<string, Doc<"commenters">>();
  commenters?.forEach((c) => commenterMap.set(c._id, c));

  // Calculate Y positions for all comments
  const recalcPositions = useCallback(() => {
    if (!editorRef.current || !comments) return;

    const newPositions = new Map<string, number>();
    for (const comment of comments) {
      if (comment.resolved) continue;
      const y = editorRef.current.getYForPos(comment.highlightFrom, comment.highlightText);
      if (y !== null) {
        newPositions.set(comment._id, y);
      }
    }
    setPositions(newPositions);

    // Position for pending comment
    if (pendingHighlight) {
      const y = editorRef.current.getYForPos(pendingHighlight.from);
      setPendingY(y);
    } else {
      setPendingY(null);
    }
  }, [editorRef, comments, pendingHighlight]);

  // Recalculate on scroll and on comment changes
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recalcPositions);
    };

    // Initial calc after a short delay (editor needs to render)
    const timer = setTimeout(recalcPositions, 100);
    scrollEl.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);

    return () => {
      clearTimeout(timer);
      scrollEl.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [recalcPositions, scrollContainerRef]);

  // Recalc when comments change
  useEffect(() => {
    const timer = setTimeout(recalcPositions, 50);
    return () => clearTimeout(timer);
  }, [comments, recalcPositions]);

  async function handleSubmitComment(body: string, suggestedEdit?: string) {
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
      ...(suggestedEdit ? { suggestedEdit } : {}),
      ...(shareToken ? { shareToken } : {}),
    });
    onClearPending?.();
  }

  const activeComments = [...(comments ?? [])]
    .filter((c) => !c.resolved)
    .sort((a, b) => a.highlightFrom - b.highlightFrom);

  // Measure card heights after render — use ref to avoid re-render loops
  useEffect(() => {
    const timer = setTimeout(() => {
      let changed = false;
      cardRefs.current.forEach((el, id) => {
        const h = el.getBoundingClientRect().height;
        if (measuredHeightsRef.current.get(id) !== h) {
          measuredHeightsRef.current.set(id, h);
          changed = true;
        }
      });
      if (changed) setLayoutTick((t) => t + 1);
    }, 50);
    return () => clearTimeout(timer);
  }, [comments, pendingHighlight]);

  // Resolve overlapping positions — push comments down if they'd overlap
  const FALLBACK_HEIGHT = 160;
  const GAP = 16;
  const resolvedPositions = new Map<string, number>();
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
    resolvedPositions.set(item.id, actualY);
    const measured = measuredHeightsRef.current.get(item.id);
    const fallback = item.id === "__pending__" ? 220 : FALLBACK_HEIGHT;
    const height = measured ?? fallback;
    lastBottom = actualY + height;
  }

  return (
    <div className="relative" style={{ minHeight: lastBottom > 0 ? lastBottom + FALLBACK_HEIGHT : 0 }}>
      {/* Pending new comment */}
      {pendingHighlight && pendingY !== null && (
        <div
          ref={(el) => { if (el) cardRefs.current.set("__pending__", el); }}
          className="absolute right-0 w-64 transition-all duration-150"
          style={{ top: resolvedPositions.get("__pending__") ?? pendingY }}
        >
          <div className="rounded-lg border border-navy/20 bg-white p-3 shadow-sm">
            <p className="mb-2 text-xs leading-relaxed text-gray-500 line-clamp-2">
              &ldquo;{pendingHighlight.text}&rdquo;
            </p>
            <CommentInput
              commenterName={commenterName}
              onSubmit={handleSubmitComment}
              onCancel={onClearPending}
              autoFocus
              highlightText={pendingHighlight.text}
            />
          </div>
        </div>
      )}

      {/* Existing comments */}
      {activeComments.map((comment) => {
        const y = resolvedPositions.get(comment._id);
        if (y === undefined) return null;

        const commenter = commenterMap.get(comment.commenterId);
        const color = commenter?.color ?? "#9CA3AF";
        const name = commenter?.name ?? "Unknown";
        const isActive = activeCommentId === comment._id;
        const isHovered = hoveredCommentId === comment._id;

        return (
          <div
            key={comment._id}
            ref={(el) => { if (el) cardRefs.current.set(comment._id, el); }}
            className={`absolute right-0 w-64 cursor-pointer transition-all duration-150 ${
              isActive || isHovered ? "z-10" : "z-0"
            }`}
            style={{ top: y }}
            onClick={() => {
              onActiveCommentChange(comment._id);
              editorRef.current?.scrollToPosition(comment.highlightFrom, comment.highlightTo, comment.highlightText);
            }}
          >
            <div
              className={`rounded-lg border p-3 transition-all ${
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
              {/* Quoted text */}
              <p className="text-xs leading-relaxed text-gray-400 line-clamp-1">
                &ldquo;{comment.highlightText}&rdquo;
              </p>

              {/* Author + time */}
              <div className="mt-1.5 flex items-center gap-1.5">
                <div
                  className="h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {name[0]?.toUpperCase()}
                </div>
                <span className="text-[11px] font-medium text-gray-700">{name}</span>
                <span className="text-[11px] text-gray-400">{formatTimeAgo(comment.createdAt)}</span>
                {comment.commenterType === "client" && (
                  <span className="rounded bg-purple-50 px-1 py-0.5 text-[9px] font-medium text-purple-600">
                    Client
                  </span>
                )}
              </div>

              {/* Body */}
              <p className="mt-1 text-sm leading-relaxed text-gray-800">
                {comment.body}
              </p>

              {/* Suggested edit */}
              {comment.suggestedEdit && (
                <div className="mt-1.5 rounded border border-primary/20 bg-primary/5 px-2 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-dark mb-0.5">Suggested edit</p>
                  <p className="text-xs text-gray-700">{comment.suggestedEdit}</p>
                  {commenterType === "writer" && (
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          acceptEdit({ commentId: comment._id });
                        }}
                        className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-white hover:bg-primary-dark transition-colors"
                      >
                        Accept
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resolveComment({ commentId: comment._id, shareToken });
                        }}
                        className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              {commenterType === "writer" && !comment.suggestedEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    resolveComment({ commentId: comment._id, shareToken });
                  }}
                  className="mt-1.5 text-xs text-gray-400 hover:text-green-600 transition-colors"
                >
                  Resolve
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

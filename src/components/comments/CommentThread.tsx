"use client";

import { Doc } from "../../../convex/_generated/dataModel";

interface CommentThreadProps {
  comment: Doc<"comments">;
  commenter: Doc<"commenters"> | null;
  commenterType: "client" | "writer";
  onResolve?: () => void;
  onUnresolve?: () => void;
  onAcceptEdit?: () => void;
  onClick?: () => void;
  resolved?: boolean;
  isActive?: boolean;
}

export function CommentThread({
  comment,
  commenter,
  commenterType,
  onResolve,
  onUnresolve,
  onAcceptEdit,
  onClick,
  resolved = false,
  isActive = false,
}: CommentThreadProps) {
  const timeAgo = formatTimeAgo(comment.createdAt);
  const color = commenter?.color ?? "#9CA3AF";
  const name = commenter?.name ?? "Unknown";

  return (
    <div
      className={`cursor-pointer border-l-2 px-4 py-3 transition-all ${
        isActive
          ? "border-l-navy bg-blue-50/50"
          : resolved
            ? "border-l-transparent opacity-50 hover:opacity-75"
            : "border-l-transparent hover:bg-gray-50"
      }`}
      onClick={onClick}
    >
      {/* Quoted text — prominent */}
      <div className={`mb-2 rounded-md border px-2.5 py-1.5 ${
        isActive
          ? "border-navy/20 bg-navy/5"
          : "border-gray-200 bg-gray-50"
      }`}>
        <p className="text-xs leading-relaxed text-gray-500 line-clamp-2">
          &ldquo;{comment.highlightText}&rdquo;
        </p>
      </div>

      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
          style={{ backgroundColor: color }}
        >
          {name[0]?.toUpperCase()}
        </div>
        <span className="text-xs font-medium text-gray-900">{name}</span>
        <span className="text-xs text-gray-400">{timeAgo}</span>
        {comment.commenterType === "client" && (
          <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-600">
            Client
          </span>
        )}
      </div>

      {/* Comment body */}
      <p
        className={`mt-1.5 text-sm leading-relaxed ${
          resolved ? "text-gray-400 line-through" : "text-gray-700"
        }`}
      >
        {comment.body}
      </p>

      {/* Suggested edit */}
      {comment.suggestedEdit && !resolved && (
        <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-dark mb-1">Suggested edit</p>
          <p className="text-xs text-gray-700 leading-relaxed">{comment.suggestedEdit}</p>
          {commenterType === "writer" && onAcceptEdit && (
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAcceptEdit();
                }}
                className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-white hover:bg-primary-dark transition-colors"
              >
                Accept edit
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResolve?.();
                }}
                className="text-[10px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-2 flex items-center gap-3">
        {!resolved && onResolve && commenterType === "writer" && !comment.suggestedEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResolve();
            }}
            className="text-xs font-medium text-gray-400 hover:text-green-600 transition-colors"
          >
            Resolve
          </button>
        )}
        {resolved && onUnresolve && commenterType === "writer" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnresolve();
            }}
            className="text-xs font-medium text-gray-400 hover:text-navy transition-colors"
          >
            Reopen
          </button>
        )}
      </div>
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

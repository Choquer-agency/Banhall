"use client";

import { Doc } from "../../../convex/_generated/dataModel";

interface CommentThreadProps {
  comment: Doc<"comments">;
  commenter: Doc<"commenters"> | null;
  commenterType: "client" | "writer";
  onResolve?: () => void;
  onUnresolve?: () => void;
  onClick?: () => void;
  resolved?: boolean;
}

export function CommentThread({
  comment,
  commenter,
  commenterType,
  onResolve,
  onUnresolve,
  onClick,
  resolved = false,
}: CommentThreadProps) {
  const timeAgo = formatTimeAgo(comment.createdAt);
  const color = commenter?.color ?? "#9CA3AF";
  const name = commenter?.name ?? "Unknown";

  return (
    <div
      className={`cursor-pointer border-b border-gray-50 px-4 py-3 transition-colors hover:bg-gray-50 ${
        resolved ? "opacity-60" : ""
      }`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
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

      {/* Highlighted text excerpt */}
      <p className="mt-1.5 text-xs italic text-gray-400 line-clamp-1">
        &ldquo;{comment.highlightText}&rdquo;
      </p>

      {/* Comment body */}
      <p
        className={`mt-1 text-sm text-gray-700 ${resolved ? "line-through" : ""}`}
      >
        {comment.body}
      </p>

      {/* Actions */}
      <div className="mt-2 flex items-center gap-2">
        {!resolved && onResolve && commenterType === "writer" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResolve();
            }}
            className="text-xs text-gray-400 hover:text-green-600"
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
            className="text-xs text-gray-400 hover:text-navy"
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

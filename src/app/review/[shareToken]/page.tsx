"use client";

import { useQuery, useMutation } from "convex/react";
import { useParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Doc } from "../../../../convex/_generated/dataModel";
import { NameGate } from "@/components/review/NameGate";
import { Editor } from "@/components/editor/Editor";
import { CommentSidebar } from "@/components/comments/CommentSidebar";

export default function ClientReviewPage() {
  const params = useParams();
  const shareToken = params.shareToken as string;

  const project = useQuery(api.projects.getProjectByShareToken, {
    shareToken,
  });
  const report = useQuery(
    api.reports.getLatestReport,
    project ? { projectId: project._id } : "skip"
  );

  const getOrCreateCommenter = useMutation(api.comments.getOrCreateCommenter);

  const [commenter, setCommenter] = useState<Doc<"commenters"> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState<{
    from: number;
    to: number;
    text: string;
  } | null>(null);

  const handleNameEnter = useCallback(
    async (name: string) => {
      if (!project) return;
      const result = await getOrCreateCommenter({
        projectId: project._id,
        name,
      });
      if (result) setCommenter(result);
    },
    [project, getOrCreateCommenter]
  );

  const handleComment = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!text) return;
    const range = selection.getRangeAt(0);
    setPendingHighlight({
      from: range.startOffset,
      to: range.endOffset,
      text: text.slice(0, 200),
    });
    setSidebarOpen(true);
  }, []);

  // Loading
  if (project === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
      </div>
    );
  }

  // Invalid link
  if (project === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-4">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-gray-900">
          Report Not Found
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          This review link may be invalid or expired.
        </p>
      </div>
    );
  }

  // Name gate
  if (!commenter) {
    return (
      <NameGate
        projectTitle={project.title}
        clientName={project.clientName}
        onEnter={handleNameEnter}
      />
    );
  }

  // Report not ready
  if (!report) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
        <h1 className="mt-4 text-lg font-semibold text-gray-900">
          {project.title}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          The report is being prepared. This page will update automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-gray-900">
            {project.title}
          </h1>
          <p className="text-xs text-gray-500">{project.clientName}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div
              className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ backgroundColor: commenter.color }}
            >
              {commenter.name[0]?.toUpperCase()}
            </div>
            <span className="hidden text-xs text-gray-500 sm:inline">
              {commenter.name}
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              sidebarOpen
                ? "bg-navy text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
            <span className="hidden sm:inline">Comments</span>
          </button>
        </div>
      </header>

      {/* Main content + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-6 py-8">
            <Editor
              content={report.content}
              editable={false}
              onComment={handleComment}
            />
            <p className="mt-8 text-center text-xs text-gray-300">
              Select text to leave a comment.
            </p>
          </div>
        </div>

        <CommentSidebar
          projectId={project._id}
          reportId={report._id}
          commenterId={commenter._id}
          commenterType="client"
          commenterName={commenter.name}
          pendingHighlight={pendingHighlight}
          onClearPending={() => setPendingHighlight(null)}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      </div>
    </div>
  );
}

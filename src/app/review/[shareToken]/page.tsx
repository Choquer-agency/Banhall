"use client";

import { useQuery, useMutation } from "convex/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Doc } from "../../../../convex/_generated/dataModel";
import { NameGate } from "@/components/review/NameGate";
import { Editor, EditorHandle, CommentRange } from "@/components/editor/Editor";
import { MarginComments } from "@/components/comments/MarginComments";
import Image from "next/image";

export default function ClientReviewPage() {
  const params = useParams();
  const shareToken = params.shareToken as string;

  const project = useQuery(api.projects.getProjectByShareToken, {
    shareToken,
  });
  const report = useQuery(
    api.reports.getLatestReport,
    project ? { projectId: project._id, shareToken } : "skip"
  );
  const comments = useQuery(
    api.comments.listComments,
    project ? { projectId: project._id, shareToken } : "skip"
  );

  const getOrCreateCommenter = useMutation(api.comments.getOrCreateCommenter);
  const logView = useMutation(api.reportViews.logView);

  const editorRef = useRef<EditorHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [commenter, setCommenter] = useState<Doc<"commenters"> | null>(null);
  const [pendingHighlight, setPendingHighlight] = useState<{
    from: number;
    to: number;
    text: string;
  } | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);

  const handleNameEnter = useCallback(
    async (name: string) => {
      if (!project) return;
      const result = await getOrCreateCommenter({
        projectId: project._id,
        name,
        shareToken,
      });
      if (result) {
        setCommenter(result);
        logView({
          projectId: project._id,
          viewerName: name,
          viewerType: "client",
        }).catch(() => {});
      }
    },
    [project, getOrCreateCommenter, logView, shareToken]
  );

  const handleComment = useCallback((selection: { from: number; to: number; text: string }) => {
    setPendingHighlight(selection);
  }, []);

  // Build comment ranges with commenter type info for color differentiation
  const commentRanges: CommentRange[] = (comments ?? [])
    .filter((c) => !c.resolved)
    .map((c) => ({
      id: c._id,
      from: c.highlightFrom,
      to: c.highlightTo,
      active: c._id === activeCommentId,
      isClient: c.commenterType === "client",
    }));

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
        <h1 className="text-lg font-semibold text-gray-900">Report Not Found</h1>
        <p className="mt-1 text-sm text-gray-500">This review link may be invalid or expired.</p>
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
        <h1 className="mt-4 text-lg font-semibold text-gray-900">{project.title}</h1>
        <p className="mt-1 text-sm text-gray-500">The report is being prepared. This page will update automatically.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      {/* Top bar — floating */}
      <div className="sticky top-0 z-50 w-full pt-5 px-[10%] bg-canvas">
        <header className="flex items-center justify-between bg-navy px-5 py-5 rounded-xl">
          <div className="flex items-center gap-3 min-w-0">
            <Image src="/logo.png" alt="Banhall" width={89} height={89} className="-my-5 brightness-0 invert" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-white">{project.title}</h1>
              <p className="text-xs text-white/50">{project.clientName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <div
                className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: commenter.color }}
              >
                {commenter.name[0]?.toUpperCase()}
              </div>
              <span className="hidden text-xs text-white/60 sm:inline">{commenter.name}</span>
            </div>
          </div>
        </header>
      </div>

      {/* Main content with margin comments — same layout as writer page */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="relative mx-auto max-w-[1100px] px-6 py-8">
          {/* Editor column */}
          <div className="max-w-[680px]">
            <Editor
              ref={editorRef}
              content={report.content}
              editable={false}
              onComment={handleComment}
              commentRanges={commentRanges}
              onHoverComment={setHoveredCommentId}
            />
            <p className="mt-8 text-center text-xs text-gray-300">
              Select text to leave a comment.
            </p>
          </div>

          {/* Margin comments — positioned to the right */}
          <div className="absolute top-8 right-6" style={{ left: 'calc(680px + 2rem + 1.5rem)', width: '256px' }}>
            <MarginComments
              projectId={project._id}
              reportId={report._id}
              commenterId={commenter._id}
              commenterType="client"
              commenterName={commenter.name}
              pendingHighlight={pendingHighlight}
              onClearPending={() => setPendingHighlight(null)}
              editorRef={editorRef}
              scrollContainerRef={scrollContainerRef}
              activeCommentId={activeCommentId}
              onActiveCommentChange={setActiveCommentId}
              hoveredCommentId={hoveredCommentId}
              shareToken={shareToken}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

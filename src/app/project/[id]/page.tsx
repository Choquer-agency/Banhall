"use client";

import {
  useConvexAuth,
  useQuery,

  useMutation,
} from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GenerationProgress } from "@/components/generation/GenerationProgress";
import { CandidateSelection } from "@/components/generation/CandidateSelection";
import { BuildStamp } from "@/components/BuildStamp";
import { Editor, EditorHandle, CommentRange } from "@/components/editor/Editor";
import { QAScorePanel } from "@/components/editor/QAScorePanel";
import { ChronologyPanel } from "@/components/editor/ChronologyTable";
import { FilesPanel } from "@/components/editor/FilesPanel";
import { LogsPanel } from "@/components/editor/LogsPanel";
import { CommentOverlay } from "@/components/comments/CommentOverlay";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { IconAction } from "@/components/ui/IconAction";
import { VersionHistory } from "@/components/history/VersionHistory";
import { exportToDocx } from "@/lib/exportDocx";
import Link from "next/link";
import Image from "next/image";

export default function ProjectPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as Id<"projects">;

  const project = useQuery(api.projects.getProject, { projectId });
  const report = useQuery(api.reports.getLatestReport, { projectId });
  const generation = useQuery(api.generations.getLatestGeneration, {
    projectId,
  });
  const transcript = useQuery(api.transcripts.getTranscript, { projectId });
  const user = useQuery(api.users.getCurrentUser);
  const comments = useQuery(api.comments.listComments, { projectId });
  const viewSummary = useQuery(api.reportViews.getViewSummary, { projectId });

  const generateReport = useMutation(api.projects.scheduleGenerateReport);
  const updateReport = useMutation(api.reports.updateReportContent);
  const createSnapshot = useMutation(api.snapshots.createManualSnapshot);

  const editorRef = useRef<EditorHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastSnapshotAtRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState<{
    from: number;
    to: number;
    text: string;
    x?: number;
    y?: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [pendingChatHighlight, setPendingChatHighlight] = useState<{
    from: number;
    to: number;
    text: string;
  } | null>(null);

  const handleAskAI = useCallback(
    (selection: { from: number; to: number; text: string }) => {
      setPendingChatHighlight(selection);
    },
    []
  );

  // BNH-14: resizable chat panel (default 50/50). Full-screen toggle is hidden
  // for now — keep `chatFull` as a dormant flag so it's easy to re-enable.
  const [chatRatio, setChatRatio] = useState(0.5);
  const chatFull = false;
  const workspaceRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const r = sessionStorage.getItem("banhall_chat_ratio");
    if (r) setChatRatio(Math.min(0.8, Math.max(0.25, parseFloat(r))));
    sessionStorage.removeItem("banhall_chat_full");
  }, []);
  useEffect(() => {
    sessionStorage.setItem("banhall_chat_ratio", String(chatRatio));
  }, [chatRatio]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const ratio = (rect.right - e.clientX) / rect.width;
      setChatRatio(Math.min(0.8, Math.max(0.25, ratio)));
    }
    function onUp() {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  // Build comment ranges for editor highlights (only unresolved comments)
  const commentRanges: CommentRange[] = (comments ?? [])
    .filter((c) => !c.resolved)
    .map((c) => ({
      id: c._id,
      from: c.highlightFrom,
      to: c.highlightTo,
      text: c.highlightText,
      isClient: c.commenterType === "client",
    }));

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  const handleEditorUpdate = useCallback(
    async (json: string) => {
      if (!report) return;
      setSaving(true);
      try {
        // Take a restore-point checkpoint of the prior state at most once every
        // 5 minutes of active editing (deduped + log-thinned server-side).
        const now = Date.now();
        if (now - lastSnapshotAtRef.current > 300_000) {
          lastSnapshotAtRef.current = now;
          createSnapshot({ reportId: report._id, reason: "manual" }).catch(
            () => {}
          );
        }
        await updateReport({ reportId: report._id, content: json });
      } catch (e) {
        console.error("Failed to save:", e);
      } finally {
        setSaving(false);
      }
    },
    [report, updateReport, createSnapshot]
  );

  const handleRegenerate = useCallback(async () => {
    if (!transcript) return;
    generateReport({
      projectId,
      transcriptId: transcript._id,
    }).catch(console.error);
  }, [generateReport, projectId, transcript]);

  const handleCopyShareLink = useCallback(() => {
    if (!project) return;
    const url = `${window.location.origin}/review/${project.shareToken}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [project]);

  const handleComment = useCallback(
    (selection: {
      from: number;
      to: number;
      text: string;
      x?: number;
      y?: number;
    }) => {
      setPendingHighlight(selection);
    },
    []
  );

  const handleExport = useCallback(async () => {
    if (!report || !project) return;
    setExporting(true);
    try {
      const safeName = project.title
        .replace(/[^a-zA-Z0-9\s\-]/g, "")
        .replace(/\s+/g, "_");
      await exportToDocx(report.content, safeName);
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(false);
    }
  }, [report, project]);

  if (isLoading || !isAuthenticated || project === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-canvas">
        <p className="text-gray-500">Project not found.</p>
        <Link href="/dashboard" className="text-sm text-navy hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const isGenerating = generation?.status === "running";
  const awaitingSelection = generation?.status === "awaiting_selection";
  const hasReport = !!report;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {/* Top bar — dark main menu + white sub-menu */}
      <div className="w-full shrink-0 px-[10%] pt-5">
        <div className="flex items-stretch gap-3">
          {/* Main menu (dark) */}
          <header className="flex min-w-0 flex-1 items-center gap-4 rounded-xl bg-navy px-5 py-4">
            <Link href="/dashboard" className="flex-shrink-0">
              <Image src="/logo.png" alt="Banhall" width={89} height={89} className="-my-5 brightness-0 invert" />
            </Link>
            <BuildStamp className="hidden text-white/50 lg:inline-flex" />
            <div className="ml-auto flex min-w-0 items-center gap-3">
              <Link href="/dashboard" className="text-sm text-white/60 transition-colors hover:text-white/80">
                Dashboard
              </Link>
              <svg className="h-3 w-3 flex-shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="truncate text-sm font-medium text-white">
                {project.title}
              </span>
              <Badge status={project.status} />
              {saving && (
                <span className="ml-1 hidden text-xs text-white/40 sm:inline">
                  Saving…
                </span>
              )}
            </div>
          </header>

          {/* Sub-menu (white) — icons that reveal their label on hover */}
          {hasReport && (
            <nav className="hidden flex-shrink-0 items-center gap-1 rounded-xl bg-white px-2 py-2 sm:flex">
              <IconAction
                label={copied ? "Copied!" : "Share"}
                title="Share"
                onClick={handleCopyShareLink}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                }
              />
              <IconAction
                label="History"
                onClick={() => setShowHistory(true)}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              <IconAction
                label={exporting ? "Exporting…" : "Export .docx"}
                title="Export .docx"
                onClick={handleExport}
                disabled={exporting}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                }
              />
              <IconAction
                label="Financial"
                href={`/project/${projectId}/financial`}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </nav>
          )}
        </div>
      </div>

      {/* Generation progress */}
      {(isGenerating ||
        (generation && generation.status === "failed" && !hasReport)) && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            <GenerationProgress projectId={projectId} />
          </div>
        </div>
      )}

      {/* BNH-15: choose between candidate drafts before they become the report */}
      {awaitingSelection && <CandidateSelection projectId={projectId} />}

      {/* Editor workspace + chat rail (single view, resizable — BNH-14) */}
      {!awaitingSelection && hasReport && (
        <div ref={workspaceRef} className="flex min-h-0 flex-1 overflow-hidden">
        {!chatFull && (
        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-10 py-10">
            {/* Project info header */}
            <div className="mb-8 pb-6 border-b border-gray-200">
              <h1 className="text-2xl font-bold text-gray-900">{project.title}</h1>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                <div>
                  <span className="text-gray-400">Client</span>
                  <p className="text-gray-700">{project.clientName}</p>
                </div>
                <div>
                  <span className="text-gray-400">Writer</span>
                  <p className="text-gray-700">{project.writer || "Catherine Tremblay"}</p>
                </div>
                {project.interviewer && (
                  <div>
                    <span className="text-gray-400">Interviewer</span>
                    <p className="text-gray-700">{project.interviewer}</p>
                  </div>
                )}
                <div>
                  <span className="text-gray-400">Created</span>
                  <p className="text-gray-700">{new Date(project.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
                </div>
              </div>
              {/* View tracking */}
              {viewSummary && viewSummary.totalViews > 0 && (
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    {viewSummary.totalViews} view{viewSummary.totalViews !== 1 ? "s" : ""}
                  </div>
                  {viewSummary.uniqueViewers.map((v) => (
                    <span key={`${v.name}-${v.type}`} className="inline-flex items-center gap-1 rounded-full bg-chrome px-2 py-0.5 text-xs text-gray-500">
                      {v.name}
                      <span className="text-gray-300">{new Date(v.lastViewed).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Editor column */}
            <Editor
              ref={editorRef}
              content={report.content}
              onUpdate={handleEditorUpdate}
              onComment={handleComment}
              onAskAI={handleAskAI}
              editable={true}
              commentRanges={commentRanges}
              onHoverComment={setHoveredCommentId}
            />

            {/* QA Score */}
            <div className="mt-8 mb-12">
              <QAScorePanel agentOutputs={generation?.agentOutputs} reportContent={report.content} />
              <div className="mt-4">
                <ChronologyPanel agentOutputs={generation?.agentOutputs} />
              </div>
              <div className="mt-4">
                <FilesPanel projectId={projectId} />
              </div>
              <LogsPanel projectId={projectId} />
            </div>
          </div>
        </div>
        )}

        {/* Draggable divider */}
        {!chatFull && report && user && (
          <div
            onMouseDown={startDrag}
            title="Drag to resize"
            className="group flex w-3 flex-none cursor-col-resize items-center justify-center"
          >
            <div className="h-10 w-1 rounded-full bg-gray-300 transition-colors group-hover:bg-primary" />
          </div>
        )}

        {/* Chat rail — resizable / full-screen */}
        {report && user && (
          <aside
            className="flex min-h-0 flex-none flex-col bg-canvas py-6 pl-1 pr-6"
            style={{ width: chatFull ? "100%" : `${chatRatio * 100}%` }}
          >
            <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-chrome bg-white shadow-sm">
              <ChatPanel
                projectId={projectId}
                reportId={report._id}
                pendingHighlight={pendingChatHighlight}
                onClearHighlight={() => setPendingChatHighlight(null)}
                onReferenceText={(texts, scrollTo) => editorRef.current?.highlightText(texts, scrollTo)}
              />
            </div>
          </aside>
        )}
        </div>
      )}

      {/* Comment authoring + hover overlay (single view) */}
      {!awaitingSelection && hasReport && report && user && (
        <CommentOverlay
          projectId={projectId}
          reportId={report._id}
          commenterId={user._id}
          commenterName={user.name ?? user.email ?? "Writer"}
          hoveredCommentId={hoveredCommentId}
          pendingHighlight={pendingHighlight}
          onClearPending={() => setPendingHighlight(null)}
        />
      )}

      {/* Version history modal */}
      {showHistory && report && (
        <VersionHistory
          reportId={report._id}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* No report, not generating — show transcript */}
      {!hasReport && !isGenerating && !awaitingSelection && (
        <main className="mx-auto w-full max-w-3xl min-h-0 flex-1 overflow-y-auto px-6 py-8">
          <h1 className="text-2xl font-bold text-gray-900">{project.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{project.clientName}</p>

          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Transcript
              </h2>
              {transcript && (
                <Button onClick={handleRegenerate} className="text-xs">
                  Generate Report
                </Button>
              )}
            </div>
            {transcript ? (
              <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
                <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-700">
                  {transcript.content}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-400">
                Loading transcript...
              </p>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

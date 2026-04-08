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
import { Editor, EditorHandle, CommentRange } from "@/components/editor/Editor";
import { QAScorePanel } from "@/components/editor/QAScorePanel";
import { ChronologyPanel } from "@/components/editor/ChronologyTable";
import { MarginComments } from "@/components/comments/MarginComments";
import { exportToDocx } from "@/lib/exportDocx";
import Link from "next/link";
import Image from "next/image";

const STATUS_FLOW: Array<{
  from: string;
  to: string;
  label: string;
}> = [
  { from: "review", to: "client_review", label: "Send to Client" },
  { from: "client_review", to: "final", label: "Mark as Final" },
  { from: "final", to: "review", label: "Reopen" },
];

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
  const updateStatus = useMutation(api.projects.updateProjectStatus);

  const editorRef = useRef<EditorHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState<{
    from: number;
    to: number;
    text: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);

  // Build comment ranges for editor highlights (only unresolved comments)
  const commentRanges: CommentRange[] = (comments ?? [])
    .filter((c) => !c.resolved)
    .map((c) => ({
      id: c._id,
      from: c.highlightFrom,
      to: c.highlightTo,
      text: c.highlightText,
      active: c._id === activeCommentId,
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
        await updateReport({ reportId: report._id, content: json });
      } catch (e) {
        console.error("Failed to save:", e);
      } finally {
        setSaving(false);
      }
    },
    [report, updateReport]
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

  const handleComment = useCallback((selection: { from: number; to: number; text: string }) => {
    setPendingHighlight(selection);
  }, []);

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

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      await updateStatus({
        projectId,
        status: newStatus as "draft" | "review" | "client_review" | "final",
      });
    },
    [projectId, updateStatus]
  );

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
  const hasReport = !!report;
  const nextStatus = STATUS_FLOW.find((s) => s.from === project.status);

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      {/* Top bar — floating dark brand */}
      <div className="sticky top-0 z-50 w-full pt-5 px-[10%] bg-canvas">
        <header className="flex items-center justify-between bg-navy px-5 py-5 rounded-xl">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard" className="flex items-center gap-5 flex-shrink-0">
            <Image src="/logo.png" alt="Banhall" width={89} height={89} className="-my-5 brightness-0 invert" />
            <span className="text-sm text-white/60 hover:text-white/80 transition-colors">Dashboard</span>
          </Link>
          <svg className="h-3 w-3 flex-shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="truncate text-sm font-medium text-white">
            {project.title}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {saving && (
            <span className="hidden text-xs text-white/40 sm:inline">
              Saving...
            </span>
          )}

          <Badge status={project.status} />

          {hasReport && (
            <>
              {nextStatus && (
                <button
                  onClick={() => handleStatusChange(nextStatus.to)}
                  className="hidden h-8 rounded-lg bg-primary px-4 text-xs font-medium text-white hover:bg-primary-dark transition-colors sm:inline-flex items-center justify-center"
                >
                  {nextStatus.label}
                </button>
              )}

              <button
                onClick={handleCopyShareLink}
                className="hidden h-8 rounded-lg bg-white/10 px-4 text-xs font-medium text-white hover:bg-white/20 transition-colors sm:inline-flex items-center justify-center"
              >
                {copied ? "Copied!" : "Share"}
              </button>

              <button
                onClick={handleExport}
                disabled={exporting}
                className="hidden h-8 rounded-lg bg-white/10 px-4 text-xs font-medium text-white hover:bg-white/20 transition-colors disabled:opacity-50 sm:inline-flex items-center justify-center"
              >
                {exporting ? "Exporting..." : "Export .docx"}
              </button>

              <Link
                href={`/project/${projectId}/financial`}
                className="hidden h-8 rounded-lg bg-white/10 px-4 text-xs font-medium text-white hover:bg-white/20 transition-colors sm:inline-flex items-center justify-center"
              >
                Financial
              </Link>
            </>
          )}
        </div>
      </header>
      </div>

      {/* Generation progress */}
      {(isGenerating ||
        (generation && generation.status === "failed" && !hasReport)) && (
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <GenerationProgress projectId={projectId} />
        </div>
      )}

      {/* Editor workspace + margin comments */}
      {hasReport && (
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          <div className="relative mx-auto max-w-[1100px] px-6 py-8">
            {/* Project info header */}
            <div className="max-w-[680px] mb-8 pb-6 border-b border-gray-200">
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
            <div className="max-w-[680px]">
              <Editor
                ref={editorRef}
                content={report.content}
                onUpdate={handleEditorUpdate}
                onComment={handleComment}
                editable={true}
                commentRanges={commentRanges}
                onHoverComment={setHoveredCommentId}
              />
            </div>

            {/* QA Score — full width of the content area */}
            <div className="mt-8 mb-12">
              <QAScorePanel agentOutputs={generation?.agentOutputs} reportContent={report.content} />
              <div className="mt-4">
                <ChronologyPanel agentOutputs={generation?.agentOutputs} />
              </div>
            </div>

            {/* Margin comments — positioned absolutely to the right of editor */}
            {report && user && (
              <div className="absolute top-8 right-6" style={{ left: 'calc(680px + 2rem + 1.5rem)', width: '256px' }}>
                <MarginComments
                  projectId={projectId}
                  reportId={report._id}
                  commenterId={user._id}
                  commenterType="writer"
                  commenterName={user.name ?? user.email ?? "Writer"}
                  pendingHighlight={pendingHighlight}
                  onClearPending={() => setPendingHighlight(null)}
                  editorRef={editorRef}
                  scrollContainerRef={scrollContainerRef}
                  activeCommentId={activeCommentId}
                  onActiveCommentChange={setActiveCommentId}
                  hoveredCommentId={hoveredCommentId}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* No report, not generating — show transcript */}
      {!hasReport && !isGenerating && (
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
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

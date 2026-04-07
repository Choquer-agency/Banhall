"use client";

import {
  useConvexAuth,
  useQuery,
  useAction,
  useMutation,
} from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GenerationProgress } from "@/components/generation/GenerationProgress";
import { Editor } from "@/components/editor/Editor";
import { QAScorePanel } from "@/components/editor/QAScorePanel";
import { CommentSidebar } from "@/components/comments/CommentSidebar";
import { exportToDocx } from "@/lib/exportDocx";
import Link from "next/link";

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

  const generateReport = useAction(api.ai.pipeline.generateReport);
  const updateReport = useMutation(api.reports.updateReportContent);
  const updateStatus = useMutation(api.projects.updateProjectStatus);

  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState<{
    from: number;
    to: number;
    text: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

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
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
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
    <div className="flex flex-1 flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/dashboard"
            className="flex-shrink-0 text-sm text-gray-400 hover:text-gray-600"
          >
            Dashboard
          </Link>
          <svg className="h-3 w-3 flex-shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="truncate text-sm font-medium text-gray-900">
            {project.title}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {saving && (
            <span className="hidden text-xs text-gray-400 sm:inline">
              Saving...
            </span>
          )}

          <Badge status={project.status} />

          {hasReport && (
            <>
              {/* Status workflow button */}
              {nextStatus && (
                <Button
                  variant="secondary"
                  onClick={() => handleStatusChange(nextStatus.to)}
                  className="hidden text-xs sm:inline-flex"
                >
                  {nextStatus.label}
                </Button>
              )}

              {/* Share */}
              <Button
                variant="secondary"
                onClick={handleCopyShareLink}
                className="hidden text-xs sm:inline-flex"
              >
                {copied ? "Copied!" : "Share"}
              </Button>

              {/* Export */}
              <Button
                variant="secondary"
                onClick={handleExport}
                disabled={exporting}
                className="hidden text-xs sm:inline-flex"
              >
                {exporting ? "Exporting..." : "Export .docx"}
              </Button>

              {/* Comments toggle */}
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

              {/* Regenerate */}
              {!isGenerating && (
                <button
                  onClick={handleRegenerate}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  title="Regenerate report"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Generation progress */}
      {(isGenerating ||
        (generation && generation.status === "failed" && !hasReport)) && (
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <GenerationProgress projectId={projectId} />
        </div>
      )}

      {/* Editor workspace + sidebar */}
      {hasReport && (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-y-auto">
            <main className="mx-auto w-full max-w-[720px] flex-1 px-6 py-8">
              <Editor
                content={report.content}
                onUpdate={handleEditorUpdate}
                onComment={handleComment}
                editable={true}
              />
            </main>
            <QAScorePanel reportContent={report.content} />
          </div>

          {report && user && (
            <CommentSidebar
              projectId={projectId}
              reportId={report._id}
              commenterId={user._id}
              commenterType="writer"
              commenterName={user.name ?? user.email ?? "Writer"}
              pendingHighlight={pendingHighlight}
              onClearPending={() => setPendingHighlight(null)}
              isOpen={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
            />
          )}
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

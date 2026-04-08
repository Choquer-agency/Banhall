"use client";

import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import Image from "next/image";

const FILE_TYPES = [
  { value: "slack_export", label: "Slack Export" },
  { value: "whatsapp_chat", label: "WhatsApp Chat" },
  { value: "git_log", label: "Git Log" },
  { value: "timesheet", label: "Timesheet (CSV/Text)" },
  { value: "trial_balance", label: "Trial Balance" },
  { value: "general_ledger", label: "General Ledger" },
  { value: "other", label: "Other" },
] as const;

export default function FinancialPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as Id<"projects">;

  const project = useQuery(api.projects.getProject, { projectId });
  const uploads = useQuery(api.financial.listUploads, { projectId });
  const entries = useQuery(api.financial.getTimesheetEntries, { projectId });
  const summary = useQuery(api.financial.getFinancialSummary, { projectId });

  const uploadData = useMutation(api.financial.uploadFinancialData);
  const deleteUpload = useMutation(api.financial.deleteUpload);

  const [fileType, setFileType] = useState<(typeof FILE_TYPES)[number]["value"]>("slack_export");
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthenticated, isLoading, router]);

  const handleUpload = useCallback(async () => {
    if (!content.trim() || !fileName.trim()) return;
    setUploading(true);
    try {
      await uploadData({
        projectId,
        fileName: fileName.trim(),
        fileType,
        content: content.trim(),
      });
      setContent("");
      setFileName("");
    } finally {
      setUploading(false);
    }
  }, [content, fileName, fileType, projectId, uploadData]);

  if (isLoading || !isAuthenticated || !project) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const sredEntries = entries?.filter((e) => e.sredEligible) ?? [];
  const nonSredEntries = entries?.filter((e) => !e.sredEligible) ?? [];

  let personnelData: Array<{ name: string; totalHours: number; sredHours: number; primaryActivities: string[] }> = [];
  if (summary?.personnelBreakdown) {
    try {
      const parsed = JSON.parse(summary.personnelBreakdown);
      personnelData = parsed.personnelBreakdown ?? [];
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-1 flex-col bg-canvas">
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
            <Link href={`/project/${projectId}`} className="text-sm text-white/60 hover:text-white/80 transition-colors truncate">
              {project.title}
            </Link>
            <svg className="h-3 w-3 flex-shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm font-medium text-white">Financial</span>
          </div>
        </header>
      </div>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <h2 className="text-xl font-semibold text-navy">Financial Analysis</h2>
        <p className="mt-1 text-sm text-gray-500">
          Upload communication logs, Git commits, or financial data to reconstruct timesheets and classify SR&ED eligibility.
        </p>

        {/* Upload form */}
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">Upload Data</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-gray-500">File name</label>
              <input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="e.g., team-slack-export-2024.txt"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Data type</label>
              <select
                value={fileType}
                onChange={(e) => setFileType(e.target.value as typeof fileType)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {FILE_TYPES.map((ft) => (
                  <option key={ft.value} value={ft.value}>{ft.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium text-gray-500">Paste data content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder="Paste Slack export, WhatsApp chat log, git log output, CSV data, etc."
              className="mt-1 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={handleUpload} disabled={uploading || !content.trim() || !fileName.trim()}>
              {uploading ? "Uploading..." : "Upload & Process"}
            </Button>
          </div>
        </div>

        {/* Uploads list */}
        {uploads && uploads.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900">Uploaded Data Sources</h3>
            <div className="mt-2 space-y-2">
              {uploads.map((upload) => (
                <div key={upload._id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-chrome px-2 py-0.5 text-xs font-medium text-gray-600">
                      {FILE_TYPES.find((ft) => ft.value === upload.fileType)?.label ?? upload.fileType}
                    </span>
                    <span className="text-sm text-gray-900">{upload.fileName}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(upload.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <button
                    onClick={() => deleteUpload({ uploadId: upload._id })}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total Hours</p>
              <p className="mt-1 text-2xl font-bold text-navy">{summary.totalHours.toFixed(1)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">SR&ED Eligible</p>
              <p className="mt-1 text-2xl font-bold text-primary">{summary.sredHours.toFixed(1)}</p>
              <p className="text-xs text-gray-400">{summary.totalHours > 0 ? Math.round((summary.sredHours / summary.totalHours) * 100) : 0}% of total</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Non-Eligible</p>
              <p className="mt-1 text-2xl font-bold text-gray-600">{summary.nonSredHours.toFixed(1)}</p>
            </div>
          </div>
        )}

        {/* Personnel breakdown */}
        {personnelData.length > 0 && (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Personnel Breakdown</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Person</th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Total Hours</th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">SR&ED Hours</th>
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400 pl-4">Primary Activities</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {personnelData.map((p, i) => (
                  <tr key={i}>
                    <td className="py-2 font-medium text-gray-900">{p.name}</td>
                    <td className="py-2 text-right text-gray-600">{p.totalHours.toFixed(1)}</td>
                    <td className="py-2 text-right text-primary font-medium">{p.sredHours.toFixed(1)}</td>
                    <td className="py-2 pl-4 text-xs text-gray-500">{p.primaryActivities?.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Timesheet entries */}
        {entries && entries.length > 0 && (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Extracted Timesheet Entries
              <span className="ml-2 text-xs font-normal text-gray-400">
                {sredEntries.length} eligible, {nonSredEntries.length} non-eligible
              </span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Person</th>
                    <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Date</th>
                    <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Hours</th>
                    <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Description</th>
                    <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">SR&ED</th>
                    <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map((entry, i) => (
                    <tr key={i} className={entry.sredEligible ? "" : "opacity-60"}>
                      <td className="py-2 font-medium text-gray-900 whitespace-nowrap">{entry.personName}</td>
                      <td className="py-2 text-gray-600 whitespace-nowrap">{entry.date}</td>
                      <td className="py-2 text-right text-gray-600">{entry.hours.toFixed(1)}</td>
                      <td className="py-2 text-gray-600 text-xs max-w-xs truncate">{entry.description}</td>
                      <td className="py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.sredEligible ? "bg-primary/10 text-navy" : "bg-gray-100 text-gray-500"
                        }`}>
                          {entry.sredEligible ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="py-2">
                        <span className={`text-xs ${
                          entry.confidence === "high" ? "text-green-600" :
                          entry.confidence === "medium" ? "text-amber-600" : "text-red-500"
                        }`}>
                          {entry.confidence}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

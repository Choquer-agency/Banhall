"use client";

import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import { formatReportMarkdown } from "@/components/errors/format";

const TYPE_LABEL: Record<string, string> = {
  nav: "nav",
  click: "click",
  network: "net",
  console: "log",
  error: "error",
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

function ReportRow({ report }: { report: Doc<"errorReports"> }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const setStatus = useMutation(api.errorReports.setStatus);
  const deleteError = useMutation(api.errorReports.deleteError);

  const isResolved = report.status === "resolved";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatReportMarkdown(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div
      className={`rounded-xl border bg-white transition-colors ${
        isResolved ? "border-gray-100 opacity-60" : "border-gray-200"
      }`}
    >
      {/* Collapsed header row */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <svg
          className={`h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition-transform ${
            open ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>

        <span
          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            report.kind === "manual"
              ? "bg-amber-100 text-amber-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          {report.kind === "manual" ? "Flag" : "Error"}
        </span>

        <span className="min-w-0 flex-1 truncate text-sm text-navy">
          {report.message}
        </span>

        <span className="hidden flex-shrink-0 truncate text-xs text-gray-400 sm:block sm:max-w-[160px]">
          {report.url}
        </span>
        <span className="flex-shrink-0 text-xs text-gray-400">
          {timeAgo(report.createdAt)}
        </span>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="space-y-4 border-t border-gray-100 px-4 py-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark"
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
                  d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                />
              </svg>
              {copied ? "Copied!" : "Copy for Claude Code"}
            </button>
            <button
              onClick={() =>
                setStatus({
                  id: report._id,
                  status: isResolved ? "open" : "resolved",
                })
              }
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              {isResolved ? "Reopen" : "Mark resolved"}
            </button>
            <button
              onClick={() => deleteError({ id: report._id })}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-red-600"
            >
              Delete
            </button>
          </div>

          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-gray-400">Page</dt>
            <dd className="break-all font-mono text-navy">{report.url}</dd>
            {report.source && (
              <>
                <dt className="text-gray-400">Source</dt>
                <dd className="break-all font-mono text-navy">
                  {report.source}
                </dd>
              </>
            )}
            {report.userEmail && (
              <>
                <dt className="text-gray-400">Reporter</dt>
                <dd className="text-navy">{report.userEmail}</dd>
              </>
            )}
            <dt className="text-gray-400">When</dt>
            <dd className="text-navy">
              {new Date(report.createdAt).toLocaleString()}
            </dd>
          </dl>

          {report.userNote && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-500">
                What the user said
              </p>
              <p className="whitespace-pre-wrap rounded-lg bg-chrome px-3 py-2 text-sm text-navy">
                {report.userNote}
              </p>
            </div>
          )}

          {report.breadcrumbs.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-500">
                Recent activity (most recent last)
              </p>
              <ol className="space-y-1">
                {report.breadcrumbs.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="mt-0.5 w-12 flex-shrink-0 font-mono text-gray-400">
                      {TYPE_LABEL[b.type] ?? b.type}
                    </span>
                    <span className="min-w-0 text-navy">
                      {b.label}
                      {b.detail && (
                        <span className="text-gray-400"> — {b.detail}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {report.stack && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-500">
                Stack trace
              </p>
              <pre className="overflow-x-auto rounded-lg bg-navy px-3 py-2 text-[11px] leading-relaxed text-white/80">
                {report.stack}
              </pre>
            </div>
          )}

          {report.userAgent && (
            <p className="break-all text-[11px] text-gray-400">
              {report.userAgent}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AlertsPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [includeResolved, setIncludeResolved] = useState(false);
  const reports = useQuery(api.errorReports.listErrors, { includeResolved });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      {/* Floating dark brand bar (matches dashboard) */}
      <div className="sticky top-0 z-50 w-full px-[10%] pt-5">
        <header className="flex items-center justify-between rounded-xl bg-navy px-5 py-5">
          <Link href="/dashboard" className="flex items-center gap-5">
            <Image
              src="/logo.png"
              alt="Banhall"
              width={89}
              height={89}
              className="-my-5 brightness-0 invert"
            />
            <span className="text-sm font-semibold text-white/90">Alerts</span>
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-white/40 transition-colors hover:text-white/70"
          >
            ← Dashboard
          </Link>
        </header>
      </div>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-navy">Error reports</h2>
            <p className="mt-0.5 text-sm text-gray-400">
              Auto-captured errors and manually flagged issues. Expand a row and
              copy it straight into Claude Code.
            </p>
          </div>
          <label className="flex flex-shrink-0 items-center gap-2 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(e) => setIncludeResolved(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Show resolved
          </label>
        </div>

        <div className="mt-6 space-y-2">
          {reports === undefined ? (
            <div className="mt-12 flex justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : reports.length === 0 ? (
            <div className="mt-16 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-chrome">
                <svg
                  className="h-6 w-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="font-medium text-navy">No alerts.</p>
              <p className="mt-1 text-sm text-gray-400">
                {includeResolved
                  ? "Nothing reported yet."
                  : "No open reports. Everything's clear."}
              </p>
            </div>
          ) : (
            reports.map((r) => <ReportRow key={r._id} report={r} />)
          )}
        </div>
      </main>
    </div>
  );
}

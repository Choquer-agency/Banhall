"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "../../../../convex/_generated/api";
import Link from "next/link";
import Image from "next/image";
import { BuildStamp } from "@/components/BuildStamp";

function scoreColor(n: number) {
  if (n >= 80) return "text-green-700";
  if (n >= 60) return "text-amber-700";
  return "text-red-700";
}

export default function AdminReviewsPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const data = useQuery(api.reviews.listWriterReviews, {});

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
      <div className="w-full shrink-0 px-[10%] pt-5">
        <header className="flex items-center gap-4 rounded-xl bg-navy px-5 py-4">
          <Link href="/dashboard" className="flex-shrink-0">
            <Image src="/logo.png" alt="Banhall" width={89} height={89} className="-my-5 brightness-0 invert" />
          </Link>
          <BuildStamp className="hidden text-white/50 lg:inline-flex" />
          <div className="ml-auto flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-white/60 transition-colors hover:text-white/80">
              Dashboard
            </Link>
            <svg className="h-3 w-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm font-medium text-white">Writer QA reviews</span>
          </div>
        </header>
      </div>

      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-gray-900">Writer QA reviews</h1>
        <p className="mt-1 text-sm text-gray-500">
          Human quality scores writers gave generated reports, alongside the AI QA
          score. For your review only — never auto-applied to the brain.
        </p>

        {data === undefined ? (
          <div className="mt-10 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : data === null ? (
          <p className="mt-8 text-sm text-gray-400">Sign in to view writer reviews.</p>
        ) : data.rows.length === 0 ? (
          <p className="mt-8 text-sm text-gray-400">No writer reviews yet.</p>
        ) : (
          <>
            {/* Summary */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Reviews</p>
                <p className="mt-1 text-2xl font-bold text-navy">{data.total}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Avg writer score</p>
                <p className="mt-1 text-2xl font-bold text-navy">{data.avgHuman ?? "—"}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Avg gap (writer − AI)</p>
                <p className={`mt-1 text-2xl font-bold ${data.avgGap != null && data.avgGap < 0 ? "text-red-700" : "text-navy"}`}>
                  {data.avgGap == null ? "—" : `${data.avgGap > 0 ? "+" : ""}${data.avgGap}`}
                </p>
              </div>
            </div>

            {/* Table */}
            <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-2.5 font-medium">Project</th>
                    <th className="px-4 py-2.5 font-medium">Writer</th>
                    <th className="px-4 py-2.5 text-center font-medium">Score</th>
                    <th className="px-4 py-2.5 text-center font-medium">AI</th>
                    <th className="px-4 py-2.5 font-medium">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r._id} className="border-b border-gray-50 last:border-0 align-top">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-800">{r.projectTitle}</p>
                        <p className="text-xs text-gray-400">
                          {r.clientName}
                          {r.reportVersion != null ? ` · v${r.reportVersion}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{r.writerName}</td>
                      <td className={`px-4 py-2.5 text-center font-bold ${scoreColor(r.score)}`}>
                        {r.score}
                      </td>
                      <td className={`px-4 py-2.5 text-center font-semibold ${r.aiScore != null ? scoreColor(r.aiScore) : "text-gray-300"}`}>
                        {r.aiScore ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {r.comment ? (
                          <span>{r.comment}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "../../../../convex/_generated/api";
import Link from "next/link";
import Image from "next/image";

type Stat = { model: string; label: string; count: number; pct: number };

function StatBars({ rows, empty }: { rows: Stat[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400">{empty}</p>;
  }
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.model}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-800">
              {i === 0 && <span className="mr-1">🏆</span>}
              {r.label}
            </span>
            <span className="text-gray-500">
              {r.count} pick{r.count !== 1 ? "s" : ""} · {r.pct}%
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-chrome">
            <div
              className={`h-full rounded-full ${i === 0 ? "bg-primary" : "bg-navy/40"}`}
              style={{ width: `${r.pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminModelsPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const stats = useQuery(api.generations.modelStats, {});

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
      {/* Top bar */}
      <div className="w-full shrink-0 px-[10%] pt-5">
        <header className="flex items-center gap-4 rounded-xl bg-navy px-5 py-4">
          <Link href="/dashboard" className="flex-shrink-0">
            <Image src="/logo.png" alt="Banhall" width={89} height={89} className="-my-5 brightness-0 invert" />
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-white/60 transition-colors hover:text-white/80">
              Dashboard
            </Link>
            <svg className="h-3 w-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm font-medium text-white">Model preferences</span>
          </div>
        </header>
      </div>

      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-gray-900">Model A/B preferences</h1>
        <p className="mt-1 text-sm text-gray-500">
          Which model writers keep when shown side-by-side candidate drafts.
        </p>

        {stats === undefined ? (
          <div className="mt-10 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : stats === null ? (
          <p className="mt-8 text-sm text-gray-400">Sign in to view model stats.</p>
        ) : (
          <>
            {/* Recommendation banner */}
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4">
              <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary-dark">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Recommendation</p>
                <p className="text-sm text-gray-600">{stats.recommendation}</p>
              </div>
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-white p-6">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
                  All writers ({stats.total})
                </h2>
                <StatBars rows={stats.overall} empty="No selections logged yet." />
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-6">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
                  Your picks
                </h2>
                <StatBars rows={stats.mine} empty="You haven't picked a draft yet." />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

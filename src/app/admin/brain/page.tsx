"use client";

import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import Link from "next/link";
import Image from "next/image";
import { BuildStamp } from "@/components/BuildStamp";

type Tab = "pending" | "approved" | "revoked" | "feedback" | "audit";

const KIND_LABEL: Record<string, string> = {
  pd_pair: "PD pair",
  cra_letter: "CRA letter",
  writer_feedback: "Writer feedback",
};

const ACTION_LABEL: Record<string, string> = {
  ingest: "Imported",
  approve: "Approved",
  reject: "Rejected",
  revoke: "Revoked (unlearned)",
  reweight: "Reweighted",
  revert: "Reverted",
};

function tierLabel(t: number) {
  if (t >= 0.9) return "gold";
  if (t >= 0.6) return "strong";
  return "standard";
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "approved"
      ? "bg-green-50 text-green-700 border-green-200"
      : status === "pending"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-gray-50 text-gray-500 border-gray-200";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>
      {status}
    </span>
  );
}

/** Expandable review pane: full content + approve/revoke/reweight actions. */
function SourceRow({
  row,
  onChanged,
}: {
  row: {
    _id: Id<"brainSources">;
    title: string;
    status: string;
    kind: string;
    industry: string;
    writerName: string | null;
    writerTier: number;
    docType: string;
    craOutcome: string | null;
    hasEntry: boolean;
    createdAt: number;
  };
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [tierDraft, setTierDraft] = useState(String(row.writerTier));
  const [busy, setBusy] = useState(false);

  const full = useQuery(
    api.brain.getBrainSource,
    open ? { sourceId: row._id } : "skip"
  );
  const approve = useMutation(api.brain.approveSource);
  const revoke = useMutation(api.brain.revokeSource);
  const reweight = useMutation(api.brain.reweightSource);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="border-b border-gray-50 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
      >
        <svg
          className={`h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-800">{row.title}</p>
          <p className="text-xs text-gray-400">
            {KIND_LABEL[row.kind] ?? row.kind} · {row.industry}
            {row.writerName ? ` · ${row.writerName}` : ""} · tier {row.writerTier} (
            {tierLabel(row.writerTier)})
            {row.craOutcome ? ` · CRA ${row.craOutcome}` : ""}
          </p>
        </div>
        {row.status === "approved" && (
          <span
            className={`text-xs ${row.hasEntry ? "text-green-600" : "text-amber-500"}`}
            title={row.hasEntry ? "Embedded & retrievable" : "Embedding in background…"}
          >
            {row.hasEntry ? "● in brain" : "◌ embedding…"}
          </span>
        )}
        <StatusBadge status={row.status} />
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-4">
          {full === undefined ? (
            <div className="flex justify-center py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : full === null ? (
            <p className="text-sm text-gray-400">Source not found.</p>
          ) : (
            <>
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 font-sans text-sm text-gray-700">
                {full.content}
              </pre>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {row.status === "pending" && (
                  <button
                    disabled={busy}
                    onClick={() => act(() => approve({ sourceId: row._id }))}
                    className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Approve → ingest
                  </button>
                )}

                {row.status !== "revoked" &&
                  (confirming ? (
                    <span className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">
                        {row.status === "approved"
                          ? "Unlearn — deletes it from retrieval. Sure?"
                          : "Reject this source?"}
                      </span>
                      <button
                        disabled={busy}
                        onClick={() => act(() => revoke({ sourceId: row._id }))}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Yes, revoke
                      </button>
                      <button
                        onClick={() => setConfirming(false)}
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirming(true)}
                      className="rounded-lg border border-red-200 px-4 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                    >
                      {row.status === "approved" ? "Revoke (unlearn)" : "Reject"}
                    </button>
                  ))}

                {row.status === "approved" && (
                  <span className="ml-auto flex items-center gap-1.5 text-sm text-gray-500">
                    Weight
                    <input
                      value={tierDraft}
                      onChange={(e) => setTierDraft(e.target.value)}
                      className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-center text-sm"
                      inputMode="decimal"
                    />
                    {Number(tierDraft) !== row.writerTier &&
                      Number.isFinite(Number(tierDraft)) && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              reweight({
                                sourceId: row._id,
                                writerTier: Number(tierDraft),
                              })
                            )
                          }
                          className="rounded-lg bg-navy px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          Save
                        </button>
                      )}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FeedbackRow({
  fb,
}: {
  fb: {
    _id: Id<"brainFeedbackQueue">;
    fromName?: string;
    body: string;
    suggestedRule?: string;
    createdAt: number;
  };
}) {
  const review = useMutation(api.brain.reviewFeedback);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      await review({
        feedbackId: fb._id,
        decision,
        ...(note.trim() ? { reviewNote: note.trim() } : {}),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-gray-50 px-4 py-4 last:border-0">
      <p className="text-sm text-gray-800">{fb.body}</p>
      {fb.suggestedRule && (
        <p className="mt-1.5 rounded-lg bg-primary/5 px-3 py-2 text-sm text-gray-700">
          <span className="font-semibold text-primary-dark">Suggested rule: </span>
          {fb.suggestedRule}
        </p>
      )}
      <p className="mt-1.5 text-xs text-gray-400">
        {fb.fromName ?? "Unknown writer"} · {new Date(fb.createdAt).toLocaleDateString()}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Review note (optional)"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
        />
        <button
          disabled={busy}
          onClick={() => decide("approved")}
          className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          disabled={busy}
          onClick={() => decide("rejected")}
          className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

export default function AdminBrainPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  // Bumped after any mutation so `hasEntry` re-reads promptly (queries are
  // reactive anyway — this only forces remount of expanded rows).
  const [, setRev] = useState(0);
  const onChanged = () => setRev((r) => r + 1);

  const stats = useQuery(api.brain.brainStats, {});
  const sources = useQuery(
    api.brain.listBrainSources,
    tab === "pending" || tab === "approved" || tab === "revoked"
      ? { status: tab }
      : "skip"
  );
  const feedback = useQuery(
    api.brain.listFeedbackQueue,
    tab === "feedback" ? {} : "skip"
  );
  const audit = useQuery(api.brain.listBrainAudit, tab === "audit" ? {} : "skip");

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

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "pending", label: "Queue", count: stats?.pending },
    { key: "approved", label: "In the Brain", count: stats?.approved },
    { key: "revoked", label: "Revoked" },
    { key: "feedback", label: "Writer feedback" },
    { key: "audit", label: "Audit log" },
  ];

  const spinner = (
    <div className="mt-10 flex justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      {/* Top bar */}
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
            <span className="text-sm font-medium text-white">The Brain</span>
          </div>
        </header>
      </div>

      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-gray-900">The Brain</h1>
        <p className="mt-1 text-sm text-gray-500">
          Curated knowledge behind generation. Only approved sources are ever
          retrievable — approving ingests, revoking unlearns, and every change is
          audited.
        </p>

        {stats === null ? (
          <p className="mt-8 text-sm text-gray-400">Admin access only.</p>
        ) : (
          <>
            {/* Stats */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">In the Brain</p>
                <p className="mt-1 text-2xl font-bold text-navy">{stats?.approved ?? "—"}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Pending review</p>
                <p className="mt-1 text-2xl font-bold text-navy">{stats?.pending ?? "—"}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Industries</p>
                <p className="mt-1 truncate text-sm font-medium text-gray-700">
                  {stats && Object.keys(stats.byIndustry).length > 0
                    ? Object.entries(stats.byIndustry)
                        .map(([k, n]) => `${k} (${n})`)
                        .join(", ")
                    : "—"}
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className="mt-6 flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    tab === t.key
                      ? "bg-navy text-white"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  }`}
                >
                  {t.label}
                  {t.count != null && t.count > 0 ? ` · ${t.count}` : ""}
                </button>
              ))}
            </div>

            {/* Panel */}
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
              {tab === "pending" || tab === "approved" || tab === "revoked" ? (
                sources === undefined ? (
                  spinner
                ) : !sources || sources.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-gray-400">
                    {tab === "pending"
                      ? "Queue is empty — imports land here for review."
                      : tab === "approved"
                        ? "Nothing in the Brain yet. Seed the curated PDs to get started."
                        : "Nothing revoked."}
                  </p>
                ) : (
                  sources.map((r) => (
                    <SourceRow key={r._id} row={r} onChanged={onChanged} />
                  ))
                )
              ) : tab === "feedback" ? (
                feedback === undefined ? (
                  spinner
                ) : !feedback || feedback.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-gray-400">
                    No pending writer feedback.
                  </p>
                ) : (
                  feedback.map((fb) => <FeedbackRow key={fb._id} fb={fb} />)
                )
              ) : audit === undefined ? (
                spinner
              ) : !audit || audit.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400">
                  No activity yet.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="px-4 py-2.5 font-medium">Action</th>
                      <th className="px-4 py-2.5 font-medium">Reason</th>
                      <th className="px-4 py-2.5 font-medium">Actor</th>
                      <th className="px-4 py-2.5 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a._id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2.5 font-medium text-gray-800">
                          {ACTION_LABEL[a.action] ?? a.action}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{a.reason ?? "—"}</td>
                        <td className="px-4 py-2.5 text-gray-500">
                          {a.actorId.startsWith("cli:") ? a.actorId : "admin"}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">
                          {new Date(a.at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

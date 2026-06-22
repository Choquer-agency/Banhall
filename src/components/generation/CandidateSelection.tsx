"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useMemo, useState } from "react";
import { Editor } from "@/components/editor/Editor";

type Candidate = {
  _id: Id<"reportCandidates">;
  model: string;
  label: string;
  content: string;
  qaScore: number | null;
};

/**
 * Deterministic shuffle seeded from the candidate ids — gives a stable order
 * across re-renders, but a different order for each generation (so the writer
 * can't learn "Option 1 is always Sonnet"). Keeps the test blind.
 */
function blindOrder(candidates: Candidate[]): number[] {
  let seed = 0;
  for (const c of candidates) {
    for (let i = 0; i < c._id.length; i++) {
      seed = (seed * 31 + c._id.charCodeAt(i)) >>> 0;
    }
  }
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = candidates.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function CandidateSelection({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const candidates = useQuery(api.generations.getCandidates, { projectId }) as
    | Candidate[]
    | undefined;
  const selectCandidate = useMutation(api.generations.selectReportCandidate);

  const order = useMemo(
    () => (candidates ? blindOrder(candidates) : []),
    [candidates]
  );
  const [activePos, setActivePos] = useState(0);
  const [choosing, setChoosing] = useState(false);

  if (!candidates || candidates.length === 0) return null;

  // Display candidates in blind, randomized order as "Option 1, 2, 3…".
  const displayed = order.map((idx) => candidates[idx]);
  const pos = activePos < displayed.length ? activePos : 0;
  const current = displayed[pos];

  async function choose() {
    if (!current) return;
    setChoosing(true);
    try {
      await selectCandidate({ candidateId: current._id });
      // Reactive queries flip the page to the report view on success.
    } catch (e) {
      console.error("selection failed", e);
      setChoosing(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[820px] px-8 py-8">
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary-dark">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </span>
          <h2 className="text-xl font-semibold text-gray-900">Choose your preferred draft</h2>
        </div>
        <p className="mb-5 text-sm text-gray-500">
          Each option is a full draft written from the same inputs by a different model — shown
          blind and in random order. Pick the one you&apos;d keep; your choice is logged to learn
          which model works best.
        </p>

        {/* Anonymous option tabs */}
        <div className="flex flex-wrap gap-2">
          {displayed.map((c, i) => (
            <button
              key={c._id}
              onClick={() => setActivePos(i)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                i === pos
                  ? "border-navy bg-navy text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
              }`}
            >
              Option {i + 1}
            </button>
          ))}
        </div>

        {/* Selected candidate preview */}
        <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-6">
          <Editor content={current.content} editable={false} />
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="sticky bottom-0 border-t border-gray-200 bg-white/90 px-8 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[820px] items-center justify-between">
          <span className="text-sm text-gray-500">
            Viewing <span className="font-medium text-navy">Option {pos + 1}</span>
          </span>
          <button
            onClick={choose}
            disabled={choosing}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {choosing ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Saving…
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Use this draft (Option {pos + 1})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useMemo } from "react";

interface ChronologyEntry {
  phase: string;
  description: string;
  uncertaintyAddressed: string;
  activityType: "experimental" | "supporting";
  estimatedHours?: string;
}

interface ChronologyTableData {
  entries: ChronologyEntry[];
}

export function ChronologyPanel({ agentOutputs }: { agentOutputs?: string | null }) {
  const [isOpen, setIsOpen] = useState(false);

  const chronology = useMemo(() => {
    if (!agentOutputs) return null;
    try {
      const parsed = JSON.parse(agentOutputs);
      if (parsed.chronology?.entries) return parsed.chronology as ChronologyTableData;
      return null;
    } catch {
      return null;
    }
  }, [agentOutputs]);

  if (!chronology || chronology.entries.length === 0) return null;

  const experimental = chronology.entries.filter((e) => e.activityType === "experimental");
  const supporting = chronology.entries.filter((e) => e.activityType === "supporting");

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-xl px-5 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy/10 text-navy">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-900">Chronology Table</span>
            <span className="ml-2 text-xs text-gray-400">
              {experimental.length} experimental, {supporting.length} supporting
            </span>
          </div>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-gray-100 px-5 py-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Phase</th>
                  <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Description</th>
                  <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Uncertainty Addressed</th>
                  <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Type</th>
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {chronology.entries.map((entry, i) => (
                  <tr key={i} className="group">
                    <td className="py-2.5 pr-4 font-medium text-gray-900 align-top whitespace-nowrap">
                      {entry.phase}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 align-top">
                      {entry.description}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-500 align-top text-xs">
                      {entry.uncertaintyAddressed}
                    </td>
                    <td className="py-2.5 pr-4 align-top whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.activityType === "experimental"
                            ? "bg-primary/10 text-navy"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {entry.activityType === "experimental" ? "Experimental" : "Supporting"}
                      </span>
                    </td>
                    <td className="py-2.5 align-top text-xs text-gray-400">
                      {entry.estimatedHours ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

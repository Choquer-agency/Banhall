"use client";

import { useState, useMemo } from "react";

interface QAScorecard {
  overall_score: number;
  section_scores: Record<
    string,
    { score: number; issues: string[]; strengths: string[] }
  >;
  cra_compliance: Record<string, boolean>;
  hallucination_risks: string[];
  ai_language_flags: string[];
  superlative_flags: string[];
  gaps_requiring_client_followup: Array<{
    section: string;
    paragraph: number;
    question: string;
  }>;
  suggested_improvements: string[];
}

export function QAScorePanel({ reportContent }: { reportContent: string }) {
  const [isOpen, setIsOpen] = useState(false);

  const scorecard = useMemo(() => {
    try {
      const doc = JSON.parse(reportContent);
      // Find the codeBlock node with QA scorecard JSON
      const codeBlock = doc.content?.find(
        (node: { type: string; attrs?: { language?: string } }) =>
          node.type === "codeBlock" && node.attrs?.language === "json"
      );
      if (!codeBlock?.content?.[0]?.text) return null;
      const parsed = JSON.parse(codeBlock.content[0].text);
      if ("overall_score" in parsed) return parsed as QAScorecard;
      return null;
    } catch {
      return null;
    }
  }, [reportContent]);

  if (!scorecard) return null;

  const overall = scorecard.overall_score;

  return (
    <div className="border-t border-gray-200 bg-white">
      {/* Toggle bar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-6 py-3 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
              overall >= 80
                ? "bg-green-50 text-green-700"
                : overall >= 60
                  ? "bg-amber-50 text-amber-700"
                  : "bg-red-50 text-red-700"
            }`}
          >
            {overall}
          </div>
          <span className="text-sm font-medium text-gray-900">
            QA Score
          </span>
          {scorecard.gaps_requiring_client_followup.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {scorecard.gaps_requiring_client_followup.length} gap
              {scorecard.gaps_requiring_client_followup.length !== 1 ? "s" : ""}
            </span>
          )}
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

      {/* Expanded panel */}
      {isOpen && (
        <div className="border-t border-gray-100 px-6 py-4">
          {/* Section scores */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {Object.entries(scorecard.section_scores).map(([key, section]) => (
              <div
                key={key}
                className="rounded-lg border border-gray-100 bg-gray-50 p-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-500">
                    Section {key}
                  </p>
                  <span
                    className={`text-sm font-bold ${
                      section.score >= 80
                        ? "text-green-700"
                        : section.score >= 60
                          ? "text-amber-700"
                          : "text-red-700"
                    }`}
                  >
                    {section.score}
                  </span>
                </div>
                {section.issues.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {section.issues.map((issue, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-red-600">
                        <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-red-400" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}
                {section.strengths.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {section.strengths.map((str, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-green-600">
                        <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-green-400" />
                        {str}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {/* CRA Compliance */}
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              CRA Compliance
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(scorecard.cra_compliance).map(([key, value]) => (
                <span
                  key={key}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    value
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {value ? (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  {key.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>

          {/* Flags */}
          {(scorecard.ai_language_flags.length > 0 ||
            scorecard.superlative_flags.length > 0) && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Language Flags
              </p>
              <div className="space-y-1">
                {scorecard.ai_language_flags.map((flag, i) => (
                  <p key={`ai-${i}`} className="text-xs text-amber-700">
                    AI language: {flag}
                  </p>
                ))}
                {scorecard.superlative_flags.map((flag, i) => (
                  <p key={`sup-${i}`} className="text-xs text-amber-700">
                    Superlative: {flag}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Gaps */}
          {scorecard.gaps_requiring_client_followup.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Follow-up Questions for Client
              </p>
              <div className="space-y-2">
                {scorecard.gaps_requiring_client_followup.map((gap, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-amber-200 bg-gap-bg px-3 py-2"
                  >
                    <p className="text-xs font-medium text-gap-text">
                      Section {gap.section}, Paragraph {gap.paragraph}
                    </p>
                    <p className="mt-0.5 text-sm text-gap-text">
                      {gap.question}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Improvements */}
          {scorecard.suggested_improvements.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Suggested Improvements
              </p>
              <ul className="space-y-1">
                {scorecard.suggested_improvements.map((imp, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                    <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-gray-400" />
                    {imp}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo } from "react";

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

/**
 * Simple renderer for Tiptap JSON documents.
 * This is a temporary read-only viewer — the full Tiptap editor replaces this in Phase 3.
 */
export function ReportViewer({ content }: { content: string }) {
  const doc = useMemo(() => {
    try {
      return JSON.parse(content) as TiptapNode;
    } catch {
      return null;
    }
  }, [content]);

  if (!doc || !doc.content) {
    return (
      <p className="text-sm text-gray-400">Could not render report content.</p>
    );
  }

  return (
    <div className="report-viewer font-serif">
      {doc.content.map((node, i) => (
        <RenderNode key={i} node={node} />
      ))}
    </div>
  );
}

function RenderNode({ node }: { node: TiptapNode }) {
  switch (node.type) {
    case "heading": {
      const level = (node.attrs?.level as number) ?? 2;
      const text = extractText(node);
      if (level === 1) {
        return (
          <h1 className="mb-2 text-2xl font-bold text-gray-900">{text}</h1>
        );
      }
      return (
        <h2 className="mb-3 mt-8 text-lg font-semibold text-navy">{text}</h2>
      );
    }

    case "paragraph": {
      return (
        <p className="mb-4 text-sm leading-relaxed text-gray-800">
          {node.content?.map((child, i) => (
            <RenderInline key={i} node={child} />
          ))}
        </p>
      );
    }

    case "horizontalRule": {
      return <hr className="my-6 border-gray-200" />;
    }

    case "codeBlock": {
      const text = extractText(node);
      // Try to parse as JSON for the QA scorecard
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // not JSON
      }

      if (parsed && "overall_score" in parsed) {
        return <QAScorecard data={parsed} />;
      }

      return (
        <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-50 p-4 text-xs text-gray-700">
          {text}
        </pre>
      );
    }

    default:
      return null;
  }
}

function RenderInline({ node }: { node: TiptapNode }) {
  if (node.type !== "text" || !node.text) return null;

  let content: React.ReactNode = node.text;

  if (node.marks) {
    for (const mark of node.marks) {
      if (mark.type === "bold") {
        content = <strong>{content}</strong>;
      } else if (mark.type === "italic") {
        content = <em>{content}</em>;
      } else if (mark.type === "highlight") {
        // GAP callout styling
        content = (
          <span className="rounded bg-gap-bg px-1 py-0.5 font-sans text-xs font-medium text-gap-text">
            {content}
          </span>
        );
      }
    }
  }

  return <>{content}</>;
}

function extractText(node: TiptapNode): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content.map(extractText).join("");
}

// ─── QA Scorecard Component ──────────────────────────────────────────────────

function QAScorecard({ data }: { data: Record<string, unknown> }) {
  const overall = data.overall_score as number;
  const sections = data.section_scores as Record<
    string,
    { score: number; issues: string[]; strengths: string[] }
  >;
  const compliance = data.cra_compliance as Record<string, boolean>;
  const gaps = data.gaps_requiring_client_followup as Array<{
    section: string;
    paragraph: number;
    question: string;
  }>;
  const improvements = data.suggested_improvements as string[];

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5 font-sans">
      {/* Overall score */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${
            overall >= 80
              ? "bg-green-50 text-green-700"
              : overall >= 60
                ? "bg-amber-50 text-amber-700"
                : "bg-red-50 text-red-700"
          }`}
        >
          {overall}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">
            Overall QA Score
          </p>
          <p className="text-xs text-gray-500">
            {overall >= 80
              ? "Good — ready for review"
              : overall >= 60
                ? "Needs improvement"
                : "Major issues detected"}
          </p>
        </div>
      </div>

      {/* Section scores */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {sections &&
          Object.entries(sections).map(([key, section]) => (
            <div
              key={key}
              className="rounded-lg border border-gray-100 bg-gray-50 p-3"
            >
              <p className="text-xs font-medium text-gray-500">
                Section {key}
              </p>
              <p
                className={`text-lg font-bold ${
                  section.score >= 80
                    ? "text-green-700"
                    : section.score >= 60
                      ? "text-amber-700"
                      : "text-red-700"
                }`}
              >
                {section.score}
              </p>
              {section.issues.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {section.issues.map((issue, i) => (
                    <li key={i} className="text-xs text-red-600">
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
      </div>

      {/* CRA Compliance */}
      {compliance && (
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            CRA Compliance
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(compliance).map(([key, value]) => (
              <span
                key={key}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  value
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {value ? "Pass" : "Fail"}: {key.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Gaps requiring follow-up */}
      {gaps && gaps.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            Follow-up Questions
          </p>
          <ul className="space-y-1.5">
            {gaps.map((gap, i) => (
              <li
                key={i}
                className="rounded-lg bg-gap-bg px-3 py-2 text-xs text-gap-text"
              >
                <span className="font-medium">
                  Section {gap.section}, P{gap.paragraph}:
                </span>{" "}
                {gap.question}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggested improvements */}
      {improvements && improvements.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            Suggested Improvements
          </p>
          <ul className="space-y-1">
            {improvements.map((imp, i) => (
              <li key={i} className="text-xs text-gray-600">
                {imp}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

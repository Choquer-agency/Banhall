"use client";

import { useQuery, useConvex, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useState } from "react";
import { categoryMeta } from "@/lib/contextCategories";

type DocRow = {
  _id: Id<"projectDocuments">;
  fileName: string;
  fileType: "txt" | "md" | "pdf" | "docx" | "msg" | "eml" | "other";
  source: string;
  category: string | null;
  createdAt: number;
  sizeChars: number;
  hasFile: boolean;
  mimeType: string | null;
  url: string | null;
  archived: boolean;
};

function craftRevisionMessage(
  fileName: string,
  action: "archive" | "delete",
  content: string
): string {
  const trimmed = content.trim().slice(0, 8000);
  const note = content.trim().length > 8000 ? "\n…(truncated)" : "";
  return `I've ${action === "archive" ? "archived" : "deleted"} the supporting file "${fileName}", so it should no longer inform this report.

Here is what that file contained:
"""
${trimmed}${note}
"""

Please revise the report to remove or rewrite ONLY the statements that specifically relied on this file. Suggest targeted edits to the affected paragraph(s) — do not regenerate the report or change unrelated content. If nothing in the report depended on it, just tell me that.`;
}

export function FilesPanel({
  projectId,
  reportId,
}: {
  projectId: Id<"projects">;
  reportId?: Id<"reports">;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<DocRow | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [removal, setRemoval] = useState<{
    doc: DocRow;
    action: "archive" | "delete";
  } | null>(null);
  const documents = useQuery(api.documents.listDocuments, { projectId }) as
    | DocRow[]
    | undefined;
  const transcript = useQuery(api.transcripts.getTranscript, { projectId });
  const convex = useConvex();
  const setArchived = useMutation(api.documents.setDocumentArchived);
  const deleteDoc = useMutation(api.documents.deleteDocument);
  const sendMessage = useMutation(api.chat.sendMessage);

  const count = documents?.length ?? 0;

  async function restore(doc: DocRow) {
    await setArchived({ documentId: doc._id, archived: false });
  }

  async function performRemoval(
    doc: DocRow,
    action: "archive" | "delete",
    revise: boolean
  ) {
    let content = "";
    if (revise && reportId) {
      const data = await convex.query(api.documents.getDocumentContent, {
        documentId: doc._id,
      });
      content = data?.content ?? "";
    }
    if (action === "archive") {
      await setArchived({ documentId: doc._id, archived: true });
    } else {
      await deleteDoc({ documentId: doc._id });
    }
    if (revise && reportId) {
      await sendMessage({
        reportId,
        content: craftRevisionMessage(doc.fileName, action, content),
      });
    }
    setRemoval(null);
  }

  async function download(doc: DocRow) {
    if (doc.url) {
      const res = await fetch(doc.url);
      const blob = await res.blob();
      triggerDownload(blob, doc.fileName);
      return;
    }
    // Text-only fallback (legacy docs with no stored bytes).
    const data = await convex.query(api.documents.getDocumentContent, {
      documentId: doc._id,
    });
    const text = data?.content ?? "";
    triggerDownload(
      new Blob([text], { type: "text/plain" }),
      doc.fileName.replace(/\.[^.]+$/, "") + ".txt"
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-xl px-5 py-3 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy/10 text-navy">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-900">Files</span>
            <span className="ml-2 text-xs text-gray-400">
              {count} file{count !== 1 ? "s" : ""}
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
        <div className="border-t border-gray-100 px-5 py-3">
          {/* Pinned source: the interview transcript (so writers can re-read it) */}
          {transcript && (
            <div className="flex items-center gap-3 border-b border-gray-100 py-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-navy/10 text-navy">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-gray-800">Interview transcript</p>
                  <span className="flex-shrink-0 rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-medium text-navy">
                    Source
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {transcript.content.split(/\s+/).filter(Boolean).length.toLocaleString()} words
                </p>
              </div>
              <button
                onClick={() => setShowTranscript(true)}
                title="Preview transcript"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
              <button
                onClick={() =>
                  triggerDownload(
                    new Blob([transcript.content], { type: "text/plain" }),
                    "interview-transcript.txt"
                  )
                }
                title="Download transcript"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
          )}

          {count === 0 ? (
            <p className="py-3 text-sm text-gray-400">
              No supporting files yet. Documents attached in the chat appear here.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {documents!.map((doc) => (
                <li
                  key={doc._id}
                  className={`flex items-center gap-3 py-2.5 ${doc.archived ? "opacity-60" : ""}`}
                >
                  <FileTypeIcon type={doc.fileType} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm text-gray-800">{doc.fileName}</p>
                      <CategoryPill category={doc.category} source={doc.source} />
                      {doc.archived && (
                        <span className="flex-shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {formatDate(doc.createdAt)}
                      {doc.archived && " · excluded from AI"}
                    </p>
                  </div>
                  <button
                    onClick={() => setPreview(doc)}
                    title="Preview"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => download(doc)}
                    title="Download"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  {doc.archived ? (
                    <button
                      onClick={() => restore(doc)}
                      title="Restore (re-include in AI context)"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={() => setRemoval({ doc, action: "archive" })}
                      title="Archive (exclude from AI context)"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => setRemoval({ doc, action: "delete" })}
                    title="Delete"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview && (
        <FilePreview doc={preview} onClose={() => setPreview(null)} />
      )}

      {showTranscript && transcript && (
        <TranscriptPreview
          content={transcript.content}
          onClose={() => setShowTranscript(false)}
        />
      )}

      {removal && (
        <RemovePrompt
          doc={removal.doc}
          action={removal.action}
          canRevise={!!reportId}
          onConfirm={(revise) =>
            performRemoval(removal.doc, removal.action, revise)
          }
          onCancel={() => setRemoval(null)}
        />
      )}
    </div>
  );
}

function TranscriptPreview({
  content,
  onClose,
}: {
  content: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <span className="text-sm font-medium text-gray-800">Interview transcript</span>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-canvas">
          <pre className="whitespace-pre-wrap px-6 py-6 font-serif text-sm leading-relaxed text-gray-700">
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}

function RemovePrompt({
  doc,
  action,
  canRevise,
  onConfirm,
  onCancel,
}: {
  doc: DocRow;
  action: "archive" | "delete";
  canRevise: boolean;
  onConfirm: (revise: boolean) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState<"revise" | "just" | null>(null);
  const verb = action === "archive" ? "Archive" : "Delete";

  async function run(revise: boolean) {
    setBusy(revise ? "revise" : "just");
    try {
      await onConfirm(revise);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">
          {verb} “{doc.fileName}”?
        </h3>
        <p className="mt-1.5 text-sm text-gray-500">
          {action === "archive"
            ? "It stays visible to reviewers but is excluded from the AI's context."
            : "This permanently removes the file from the project."}
          {canRevise &&
            " Do you also want the assistant to revise the report to remove information that came from it?"}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy !== null}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => run(false)}
            disabled={busy !== null}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-navy transition-colors hover:bg-chrome disabled:opacity-50"
          >
            {busy === "just" ? "Working…" : `Just ${verb.toLowerCase()}`}
          </button>
          {canRevise && (
            <button
              onClick={() => run(true)}
              disabled={busy !== null}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {busy === "revise" ? "Working…" : `${verb} & revise report`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FilePreview({ doc, onClose }: { doc: DocRow; onClose: () => void }) {
  // PDFs and images render from the stored file; everything else shows text.
  const isPdf = doc.fileType === "pdf" && doc.url;
  const isImage = (doc.mimeType?.startsWith("image/") ?? false) && doc.url;
  const data = useQuery(
    api.documents.getDocumentContent,
    !isPdf && !isImage ? { documentId: doc._id } : "skip"
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <span className="truncate text-sm font-medium text-gray-800">
            {doc.fileName}
          </span>
          <div className="flex items-center gap-2">
            {doc.url && (
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 rounded-lg bg-gray-100 px-3 text-xs font-medium leading-8 text-gray-700 transition-colors hover:bg-gray-200"
              >
                Open in tab
              </a>
            )}
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-canvas">
          {isPdf ? (
            <iframe src={doc.url!} className="h-full w-full" title={doc.fileName} />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doc.url!} alt={doc.fileName} className="mx-auto max-h-full" />
          ) : data === undefined ? (
            <p className="px-6 py-6 text-sm text-gray-400">Loading…</p>
          ) : (
            <pre className="whitespace-pre-wrap px-6 py-6 font-sans text-sm leading-relaxed text-gray-700">
              {data?.content || "No text content."}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function FileTypeIcon({ type }: { type: DocRow["fileType"] }) {
  const colors: Record<string, string> = {
    pdf: "bg-red-50 text-red-500",
    docx: "bg-blue-50 text-blue-500",
    msg: "bg-amber-50 text-amber-500",
    eml: "bg-amber-50 text-amber-500",
    txt: "bg-gray-100 text-gray-500",
    md: "bg-gray-100 text-gray-500",
    other: "bg-gray-100 text-gray-500",
  };
  return (
    <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${colors[type] ?? colors.other}`}>
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    </div>
  );
}

function CategoryPill({
  category,
  source,
}: {
  category: string | null;
  source: string;
}) {
  const meta = categoryMeta(category);
  if (meta) {
    return (
      <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.pill}`}>
        {meta.label}
      </span>
    );
  }
  if (source === "chat_upload") {
    return (
      <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
        Chat
      </span>
    );
  }
  return null;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

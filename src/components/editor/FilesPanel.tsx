"use client";

import { useQuery, useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useState } from "react";
import { categoryMeta } from "@/lib/contextCategories";

type DocRow = {
  _id: Id<"projectDocuments">;
  fileName: string;
  fileType: "txt" | "md" | "pdf" | "docx" | "other";
  source: string;
  category: string | null;
  createdAt: number;
  sizeChars: number;
  hasFile: boolean;
  mimeType: string | null;
  url: string | null;
};

export function FilesPanel({ projectId }: { projectId: Id<"projects"> }) {
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<DocRow | null>(null);
  const documents = useQuery(api.documents.listDocuments, { projectId }) as
    | DocRow[]
    | undefined;
  const convex = useConvex();

  const count = documents?.length ?? 0;

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
          {count === 0 ? (
            <p className="py-3 text-sm text-gray-400">
              No files yet. Documents attached in the chat appear here.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {documents!.map((doc) => (
                <li
                  key={doc._id}
                  className="flex items-center gap-3 py-2.5"
                >
                  <FileTypeIcon type={doc.fileType} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm text-gray-800">{doc.fileName}</p>
                      <CategoryPill category={doc.category} source={doc.source} />
                    </div>
                    <p className="text-xs text-gray-400">{formatDate(doc.createdAt)}</p>
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
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview && (
        <FilePreview doc={preview} onClose={() => setPreview(null)} />
      )}
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
    txt: "bg-gray-100 text-gray-500",
    md: "bg-gray-100 text-gray-500",
    other: "bg-gray-100 text-gray-500",
  };
  return (
    <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${colors[type]}`}>
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

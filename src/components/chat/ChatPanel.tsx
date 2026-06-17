"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProposedEditCard } from "./ProposedEditCard";
import { ChatIcon } from "@/components/ui/ChatIcon";
import { parseFileToText } from "@/lib/parseDocument";

interface ChatPanelProps {
  projectId: Id<"projects">;
  reportId: Id<"reports">;
  pendingHighlight?: { from: number; to: number; text: string } | null;
  onClearHighlight?: () => void;
}

function trimName(name: string): string {
  return name.length > 40 ? name.slice(0, 37) + "…" : name;
}

function guessFileType(
  name: string
): "txt" | "md" | "pdf" | "docx" | "other" {
  const l = name.toLowerCase();
  if (l.endsWith(".pdf")) return "pdf";
  if (l.endsWith(".docx")) return "docx";
  if (l.endsWith(".md") || l.endsWith(".markdown")) return "md";
  if (l.endsWith(".txt")) return "txt";
  return "other";
}

export function ChatPanel({
  projectId,
  reportId,
  pendingHighlight,
  onClearHighlight,
}: ChatPanelProps) {
  const threads = useQuery(api.chat.listThreads, { reportId });
  const [selectedThreadId, setSelectedThreadId] =
    useState<Id<"chatThreads"> | null>(null);

  // Single continuous thread per report — default to the newest.
  useEffect(() => {
    if (selectedThreadId === null && threads && threads.length > 0) {
      setSelectedThreadId(threads[0]._id);
    }
  }, [threads, selectedThreadId]);

  const messages = useQuery(
    api.chat.listMessages,
    selectedThreadId ? { threadId: selectedThreadId } : "skip"
  );

  const documents = useQuery(api.documents.listDocuments, { projectId });
  const docNameById = new Map<string, string>();
  documents?.forEach((d) => docNameById.set(d._id, d.fileName));

  const sendMessage = useMutation(api.chat.sendMessage);
  const applyProposedEdit = useMutation(api.chat.applyProposedEdit);
  const rejectProposedEdit = useMutation(api.chat.rejectProposedEdit);
  const uploadDocument = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<
    { documentId: Id<"projectDocuments">; fileName: string }[]
  >([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const [pillWidth, setPillWidth] = useState(0);

  // Measure the pasted-text pill so the textarea's first line starts beside it.
  const highlightText = pendingHighlight?.text;
  useEffect(() => {
    if (pendingHighlight && pillRef.current) {
      setPillWidth(pillRef.current.offsetWidth + 10);
    } else {
      setPillWidth(0);
    }
  }, [pendingHighlight, highlightText]);

  // Pin to the latest message (iMessage-style) on every update.
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Focus the input when a highlight is piped in from the editor.
  useEffect(() => {
    if (pendingHighlight) textareaRef.current?.focus();
  }, [pendingHighlight]);

  // Auto-grow the textarea like Orbi.
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if ((!trimmed && !pendingHighlight) || sending) return;
      setSending(true);
      try {
        const res = await sendMessage({
          reportId,
          content: trimmed,
          ...(selectedThreadId ? { threadId: selectedThreadId } : {}),
          ...(pendingHighlight ? { highlight: pendingHighlight } : {}),
          ...(attachments.length
            ? { attachmentIds: attachments.map((a) => a.documentId) }
            : {}),
        });
        setSelectedThreadId(res.threadId);
        setInput("");
        setAttachments([]);
        onClearHighlight?.();
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      } catch (e) {
        console.error("Failed to send message", e);
      } finally {
        setSending(false);
      }
    },
    [
      sendMessage,
      reportId,
      selectedThreadId,
      pendingHighlight,
      attachments,
      onClearHighlight,
      sending,
    ]
  );

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        // 1. Store the original file bytes so it can be previewed/downloaded.
        let storageId: Id<"_storage"> | undefined;
        try {
          const url = await generateUploadUrl();
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          const json = (await res.json()) as { storageId: Id<"_storage"> };
          storageId = json.storageId;
        } catch (e) {
          console.error("File storage upload failed", e);
        }

        // 2. Best-effort text extraction for the AI context.
        let parsed;
        try {
          parsed = await parseFileToText(file);
        } catch (e) {
          console.error("Parse failed", e);
          parsed = { fileName: file.name, fileType: guessFileType(file.name), content: "" };
        }

        // 3. Record the document (always — so it shows in Files).
        const documentId = await uploadDocument({
          projectId,
          reportId,
          fileName: file.name,
          fileType: parsed.fileType,
          content: parsed.content,
          source: "chat_upload",
          ...(storageId ? { storageId } : {}),
          ...(file.type ? { mimeType: file.type } : {}),
        });
        setAttachments((a) => [...a, { documentId, fileName: file.name }]);

        // 4. Tell the writer if the assistant won't have any text from it.
        if (!parsed.content.trim()) {
          setUploadError(
            `"${trimName(file.name)}" was added to Files, but no readable text was found for the assistant to use (outlined fonts or a scanned image).`
          );
        }
      }
    } catch (e) {
      console.error("Upload failed", e);
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const highlightLineCount = useMemo(
    () => (pendingHighlight ? pendingHighlight.text.split("\n").length : 0),
    [pendingHighlight]
  );

  const isEmpty = !messages || messages.length === 0;

  const composer = (
    <>
      {/* Upload error */}
      {uploadError && (
        <div className="mb-2 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600">
          <span>{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="mt-0.5 flex-shrink-0 text-red-400 hover:text-red-600">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Attachment chips above the box */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <span
              key={`${a.documentId}-${i}`}
              className="inline-flex items-center gap-1 rounded-md bg-chrome px-2 py-1 text-[11px] text-gray-600"
            >
              <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              {trimName(a.fileName)}
              <button
                onClick={() =>
                  setAttachments((list) => list.filter((_, idx) => idx !== i))
                }
                className="ml-0.5 text-gray-400 hover:text-gray-600"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-chrome bg-canvas px-2 py-1.5">
        <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Attach a document"
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-chrome hover:text-gray-600 disabled:opacity-50"
        >
          {uploading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.pdf,.docx"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {/* Pasted-text pill sits inline; text starts beside it (terminal-style) */}
        <div className="relative flex-1 py-1">
          {pendingHighlight && (
            <span
              ref={pillRef}
              className="absolute left-1 top-1 z-10 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-navy shadow-sm"
            >
              <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              Pasted text #1
              {highlightLineCount > 1 ? ` +${highlightLineCount} lines` : ""}
              <button
                onClick={onClearHighlight}
                className="text-navy/40 hover:text-navy"
                title="Remove"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendText(input);
              }
            }}
            rows={1}
            placeholder={
              pendingHighlight
                ? "Add instructions…"
                : isEmpty
                  ? "Ask anything about this report…"
                  : "Ask a follow-up…"
            }
            style={pendingHighlight ? { textIndent: pillWidth } : undefined}
            className="min-h-[28px] w-full resize-none bg-transparent px-1 py-0.5 text-[14px] leading-snug text-gray-800 placeholder:text-gray-400 outline-none"
          />
        </div>
        <button
          onClick={() => sendText(input)}
          disabled={sending || (!input.trim() && !pendingHighlight)}
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-white transition-colors hover:bg-navy-light disabled:opacity-30"
          title="Send"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-chrome px-5 py-3.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy text-white">
          <ChatIcon className="h-3 w-3" />
        </span>
        <span className="text-[15px] font-semibold text-navy">Assistant</span>
      </div>

      {isEmpty ? (
        /* Intro state — greeting + composer centered (Orbi-style) */
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <h2 className="mb-5 text-center text-[19px] font-semibold text-navy">
            How can I help with this report?
          </h2>
          <div className="w-full">{composer}</div>
        </div>
      ) : (
        <>
          {/* Messages — native scroll, pinned to bottom */}
          <div
            ref={viewportRef}
            className="flex-1 overflow-y-auto overscroll-y-contain px-5 py-4"
          >
            <div className="space-y-4">
              {messages!.map((m) => (
                <MessageBubble
                  key={m._id}
                  message={m}
                  docNames={docNameById}
                  onReplace={() => applyProposedEdit({ messageId: m._id })}
                  onReject={() => rejectProposedEdit({ messageId: m._id })}
                />
              ))}
            </div>
          </div>

          {/* Composer — pinned to the bottom once chatting */}
          <div className="shrink-0 border-t border-chrome px-4 py-3">{composer}</div>
        </>
      )}
    </div>
  );
}

type ChatMessage = {
  _id: Id<"chatMessages">;
  role: "writer" | "assistant";
  content: string;
  status: "pending" | "complete" | "error";
  highlight?: { text: string; from: number; to: number } | null;
  attachmentIds?: Id<"projectDocuments">[];
  proposedEdit?: {
    targetText: string;
    newText: string;
    state: "pending" | "applied" | "rejected";
  } | null;
};

function MessageBubble({
  message,
  docNames,
  onReplace,
  onReject,
}: {
  message: ChatMessage;
  docNames: Map<string, string>;
  onReplace: () => Promise<unknown>;
  onReject: () => Promise<unknown>;
}) {
  if (message.role === "writer") {
    const attachments = (message.attachmentIds ?? []).map(
      (id) => docNames.get(id) ?? "Attachment"
    );
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 font-sans text-[15px] leading-relaxed text-navy">
          {message.highlight && (
            <p className="mb-2 italic text-navy/80">
              &ldquo;{message.highlight.text}&rdquo;
            </p>
          )}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-col gap-1">
              {attachments.map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-[12px] text-navy/80"
                >
                  <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  {name}
                </span>
              ))}
            </div>
          )}
          {message.content && (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}
        </div>
      </div>
    );
  }

  // Assistant
  const isPending = message.status === "pending" && !message.content;
  return (
    <div className="flex max-w-[95%] flex-col gap-1">
      {isPending ? (
        <div className="flex items-center gap-1 py-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
        </div>
      ) : (
        <div
          className={`chat-markdown text-[15px] leading-relaxed ${
            message.status === "error" ? "text-red-500" : "text-gray-800"
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      )}

      {message.proposedEdit && (
        <ProposedEditCard
          newText={message.proposedEdit.newText}
          state={message.proposedEdit.state}
          onReplace={async () => {
            await onReplace();
          }}
          onReject={async () => {
            await onReject();
          }}
        />
      )}
    </div>
  );
}

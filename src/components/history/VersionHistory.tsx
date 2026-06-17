"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { Editor } from "@/components/editor/Editor";

interface VersionHistoryProps {
  reportId: Id<"reports">;
  onClose: () => void;
}

const REASON_LABELS: Record<string, string> = {
  pre_chat_edit: "Before AI edit",
  manual: "Edit checkpoint",
  periodic: "Auto-save",
  pre_restore: "Before restore",
};

export function VersionHistory({ reportId, onClose }: VersionHistoryProps) {
  const snapshots = useQuery(api.snapshots.listSnapshots, { reportId });
  const [selectedId, setSelectedId] = useState<Id<"reportSnapshots"> | null>(
    null
  );
  const selected = useQuery(
    api.snapshots.getSnapshot,
    selectedId ? { snapshotId: selectedId } : "skip"
  );
  const restoreSnapshot = useMutation(api.snapshots.restoreSnapshot);

  const [copied, setCopied] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (selectedId === null && snapshots && snapshots.length > 0) {
      setSelectedId(snapshots[0]._id);
    }
  }, [snapshots, selectedId]);

  async function handleCopy() {
    if (!selected) return;
    const text = extractPlainText(selected.content);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRestore() {
    if (!selectedId) return;
    setRestoring(true);
    try {
      await restoreSnapshot({ snapshotId: selectedId });
      onClose();
    } catch (e) {
      console.error("Restore failed", e);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Snapshot list */}
        <div className="flex w-72 flex-shrink-0 flex-col border-r border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <span className="text-sm font-semibold text-gray-700">
              Version history
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {snapshots === undefined ? (
              <p className="px-4 py-3 text-xs text-gray-400">Loading…</p>
            ) : snapshots.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-400">
                No versions saved yet. Snapshots are created automatically as you
                edit and before each AI change.
              </p>
            ) : (
              snapshots.map((s) => (
                <button
                  key={s._id}
                  onClick={() => setSelectedId(s._id)}
                  className={`block w-full border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                    selectedId === s._id ? "bg-chrome" : "hover:bg-gray-50"
                  }`}
                >
                  <p className="text-sm font-medium text-gray-800">
                    {formatTimestamp(s.createdAt)}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {s.label ?? REASON_LABELS[s.reason] ?? s.reason}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
            <span className="text-sm text-gray-500">
              {selected ? formatTimestamp(selected.createdAt) : "Preview"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                disabled={!selected}
                className="h-8 rounded-lg bg-gray-100 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
              >
                {copied ? "Copied!" : "Copy text"}
              </button>
              <button
                onClick={handleRestore}
                disabled={!selectedId || restoring}
                className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
                title="Restores this version. Your current version is saved first, so nothing is lost."
              >
                {restoring ? "Restoring…" : "Restore this version"}
              </button>
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
          <div className="flex-1 overflow-y-auto bg-canvas px-8 py-6">
            {selected ? (
              <div className="mx-auto max-w-[680px]">
                <Editor content={selected.content} editable={false} />
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                Select a version to preview it.
              </p>
            )}
          </div>
          <p className="border-t border-gray-100 px-5 py-2 text-[11px] text-gray-400">
            Restoring is non-destructive — the current version is snapshotted
            first, so you can always come back to it.
          </p>
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function extractPlainText(contentJson: string): string {
  try {
    const doc = JSON.parse(contentJson);
    const lines: string[] = [];
    const walk = (node: { type?: string; text?: string; content?: unknown[] }) => {
      if (node.type === "text" && typeof node.text === "string") {
        lines.push(node.text);
        return "inline";
      }
      const children = (node.content as typeof node[]) ?? [];
      if (node.type === "paragraph" || node.type === "heading") {
        const parts: string[] = [];
        for (const c of children) {
          if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
        }
        lines.push(parts.join(""));
        return "block";
      }
      for (const c of children) walk(c);
      return "block";
    };
    for (const node of (doc.content as { type?: string }[]) ?? []) walk(node);
    return lines.filter((l) => l.trim().length > 0).join("\n\n");
  } catch {
    return "";
  }
}

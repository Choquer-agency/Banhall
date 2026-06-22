"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { parseFileToText } from "@/lib/parseDocument";
import {
  CONTEXT_CATEGORIES,
  ContextCategoryId,
  ContextCategoryDef,
} from "@/lib/contextCategories";
import Link from "next/link";
import Image from "next/image";

type StagedCategory = { files: File[]; text: string };
type Staged = Record<ContextCategoryId, StagedCategory>;
type PyRow = { id: string; year: number; note: string; files: File[] };

function emptyStaged(): Staged {
  const out = {} as Staged;
  for (const c of CONTEXT_CATEGORIES) out[c.id] = { files: [], text: "" };
  return out;
}

function guessFileType(name: string): "txt" | "md" | "pdf" | "docx" | "other" {
  const l = name.toLowerCase();
  if (l.endsWith(".pdf")) return "pdf";
  if (l.endsWith(".docx")) return "docx";
  if (l.endsWith(".md") || l.endsWith(".markdown")) return "md";
  if (l.endsWith(".txt")) return "txt";
  return "other";
}

const STEPS = ["Details", "Context & files", "Review"];

export default function NewProjectPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const createProject = useMutation(api.projects.createProject);
  const generateReport = useMutation(api.projects.scheduleGenerateReport);
  const uploadDocument = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const user = useQuery(api.users.getCurrentUser);

  // Writer is always the signed-in user — not editable.
  const writerName = user?.name ?? user?.email ?? "";

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [transcript, setTranscript] = useState("");
  const [staged, setStaged] = useState<Staged>(emptyStaged);

  // Previous-year reports get a structured year-by-year UI (BNH-9 / BNH-26).
  // Multiple files + an optional note per year; the year label is editable, so
  // each row carries a stable id (year alone isn't safe identity once editable).
  const baseYear = new Date().getFullYear() - 1;
  const pyIdRef = useRef(1);
  const [pyRows, setPyRows] = useState<PyRow[]>([
    { id: "py-0", year: baseYear, note: "", files: [] },
  ]);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthenticated, isLoading, router]);

  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const pyFileCount = pyRows.reduce((n, r) => n + r.files.length, 0);
  const pyNoteOnlyCount = pyRows.filter(
    (r) => r.files.length === 0 && r.note.trim()
  ).length;
  const fileCount =
    CONTEXT_CATEGORIES.reduce(
      (n, c) =>
        c.id === "previous_pd"
          ? n
          : n + staged[c.id].files.length + (staged[c.id].text.trim() ? 1 : 0),
      0
    ) +
    pyFileCount +
    pyNoteOnlyCount;

  function addPyFiles(id: string, files: File[]) {
    setPyRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, files: [...r.files, ...files] } : r))
    );
  }
  function removePyFile(id: string, idx: number) {
    setPyRows((rows) =>
      rows.map((r) =>
        r.id === id ? { ...r, files: r.files.filter((_, i) => i !== idx) } : r
      )
    );
  }
  function updatePyYear(id: string, year: number) {
    setPyRows((rows) => rows.map((r) => (r.id === id ? { ...r, year } : r)));
  }
  function updatePyNote(id: string, note: string) {
    setPyRows((rows) => rows.map((r) => (r.id === id ? { ...r, note } : r)));
  }
  function removePyYear(id: string) {
    setPyRows((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));
  }
  function addPyYear() {
    setPyRows((rows) => {
      const minYear = Math.min(...rows.map((r) => r.year));
      const id = `py-${pyIdRef.current++}`;
      return [...rows, { id, year: minYear - 1, note: "", files: [] }];
    });
  }

  function updateCategory(id: ContextCategoryId, patch: Partial<StagedCategory>) {
    setStaged((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  }

  function goNext() {
    setError("");
    if (step === 0) {
      if (!title.trim() || !clientName.trim()) {
        setError("Project title and client name are required.");
        return;
      }
      if (!transcript.trim()) {
        setError("Please paste the interview transcript.");
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function uploadOriginal(file: File): Promise<Id<"_storage"> | undefined> {
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const json = (await res.json()) as { storageId: Id<"_storage"> };
      return json.storageId;
    } catch (e) {
      console.error("storage upload failed", e);
      return undefined;
    }
  }

  async function commit() {
    setError("");
    setCommitting(true);
    try {
      setProgress("Creating project…");
      const { projectId, transcriptId } = await createProject({
        title: title.trim(),
        clientName: clientName.trim(),
        ...(writerName ? { writer: writerName } : {}),
        ...(interviewer.trim() ? { interviewer: interviewer.trim() } : {}),
        transcriptContent: transcript,
      });

      const uploadFile = async (
        file: File,
        category: ContextCategoryId,
        prefix = ""
      ) => {
        setProgress(`Uploading ${file.name}…`);
        const storageId = await uploadOriginal(file);
        let parsed;
        try {
          parsed = await parseFileToText(file);
        } catch {
          parsed = {
            fileName: file.name,
            fileType: guessFileType(file.name),
            content: "",
          };
        }
        await uploadDocument({
          projectId,
          fileName: file.name,
          fileType: parsed.fileType,
          content: prefix + parsed.content,
          source: "context_input",
          category,
          ...(storageId ? { storageId } : {}),
          ...(file.type ? { mimeType: file.type } : {}),
        });
      };

      // Previous-year reports — tagged with their fiscal year + optional note.
      for (const row of pyRows) {
        const noteLine = row.note.trim() ? `Note: ${row.note.trim()}\n` : "";
        for (const file of row.files) {
          await uploadFile(
            file,
            "previous_pd",
            `[Previous-year report — fiscal ${row.year}]\n${noteLine}\n`
          );
        }
        // A note with no files still carries useful prior-year context.
        if (row.note.trim() && row.files.length === 0) {
          await uploadDocument({
            projectId,
            fileName: `Previous-year note (FY ${row.year})`,
            fileType: "txt",
            content: `[Previous-year note — fiscal ${row.year}]\n\n${row.note.trim()}`,
            source: "context_input",
            category: "previous_pd",
          });
        }
      }

      // Other categories.
      for (const cat of CONTEXT_CATEGORIES) {
        if (cat.id === "previous_pd") continue;
        const s = staged[cat.id];
        for (const file of s.files) {
          await uploadFile(file, cat.id);
        }
        if (s.text.trim()) {
          await uploadDocument({
            projectId,
            fileName: `${cat.label} (pasted)`,
            fileType: "txt",
            content: s.text,
            source: "context_input",
            category: cat.id,
          });
        }
      }

      setProgress("Starting generation…");
      await generateReport({ projectId, transcriptId });
      router.push(`/project/${projectId}`);
    } catch (e) {
      console.error(e);
      setError("Something went wrong creating the project. Please try again.");
      setCommitting(false);
      setProgress("");
    }
  }

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      <div className="sticky top-0 z-50 w-full px-[10%] pt-5">
        <header className="flex items-center rounded-xl bg-navy px-5 py-5">
          <Link href="/dashboard" className="flex flex-shrink-0 items-center gap-5">
            <Image src="/logo.png" alt="Banhall" width={89} height={89} className="-my-5 brightness-0 invert" />
            <span className="text-sm text-white/60 transition-colors hover:text-white/80">Dashboard</span>
          </Link>
          <svg className="mx-2 h-3 w-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-medium text-white">New Project</span>
        </header>
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {/* Step indicator */}
        <div className="mb-8 flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  i < step
                    ? "bg-primary text-white"
                    : i === step
                      ? "bg-navy text-white"
                      : "bg-chrome text-gray-400"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span className={`text-xs ${i === step ? "font-medium text-navy" : "text-gray-400"}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-gray-200" />}
            </div>
          ))}
        </div>

        {/* Step 1 — details */}
        {step === 0 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Project details</h2>
              <p className="mt-1 text-sm text-gray-500">
                Enter the basics and paste the interview transcript.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Input id="title" label="Project title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project Verdant F2024" required />
              <Input id="clientName" label="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="GreenStem Nurseries Inc." required />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Writer</label>
                <div
                  className="flex h-[42px] items-center rounded-lg border border-gray-200 bg-chrome px-3.5 text-sm text-gray-600"
                  title="Set automatically to the signed-in user"
                >
                  {writerName || "…"}
                </div>
              </div>
              <Input id="interviewer" label="Interviewer" value={interviewer} onChange={(e) => setInterviewer(e.target.value)} placeholder="John Doe" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="transcript" className="text-sm font-medium text-gray-700">Interview transcript</label>
                {wordCount > 0 && <span className="text-xs text-gray-400">{wordCount.toLocaleString()} words</span>}
              </div>
              <textarea
                id="transcript"
                rows={16}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste the full interview transcript here..."
                className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 font-serif text-sm leading-relaxed text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
          </div>
        )}

        {/* Step 2 — context & files */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Context & files</h2>
              <p className="mt-1 text-sm text-gray-500">
                Add any supporting material so the report is grounded in more than the transcript.
                Everything here is <span className="font-medium">optional</span> — add what you have.
              </p>
            </div>
            {CONTEXT_CATEGORIES.map((cat) =>
              cat.id === "previous_pd" ? (
                <PreviousYearCard
                  key={cat.id}
                  def={cat}
                  rows={pyRows}
                  onAddFiles={addPyFiles}
                  onRemoveFile={removePyFile}
                  onUpdateYear={updatePyYear}
                  onUpdateNote={updatePyNote}
                  onRemoveYear={removePyYear}
                  onAddYear={addPyYear}
                />
              ) : (
                <CategoryCard
                  key={cat.id}
                  def={cat}
                  value={staged[cat.id]}
                  onAddFiles={(fs) => updateCategory(cat.id, { files: [...staged[cat.id].files, ...fs] })}
                  onRemoveFile={(idx) =>
                    updateCategory(cat.id, {
                      files: staged[cat.id].files.filter((_, i) => i !== idx),
                    })
                  }
                  onText={(text) => updateCategory(cat.id, { text })}
                />
              )
            )}
          </div>
        )}

        {/* Step 3 — review */}
        {step === 2 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Review & generate</h2>
              <p className="mt-1 text-sm text-gray-500">
                Confirm everything looks right, then generate the draft report.
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
              <Row label="Project" value={title || "—"} />
              <Row label="Client" value={clientName || "—"} />
              {writerName && <Row label="Writer" value={writerName} />}
              {interviewer && <Row label="Interviewer" value={interviewer} />}
              <Row label="Transcript" value={`${wordCount.toLocaleString()} words`} />
              <Row label="Context items" value={fileCount > 0 ? `${fileCount} attached` : "None"} />
            </div>
            {fileCount > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                {(pyFileCount > 0 || pyNoteOnlyCount > 0) && (
                  <div className="mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Previous-year reports</p>
                    <ul className="mt-0.5 text-sm text-gray-700">
                      {pyRows
                        .filter((r) => r.files.length || r.note.trim())
                        .map((r) => (
                          <li key={r.id} className="truncate">
                            <span className="text-gray-400">FY {r.year}:</span>{" "}
                            {r.files.length
                              ? r.files.map((f) => f.name).join(", ")
                              : "note only"}
                            {r.note.trim() && (
                              <span className="text-gray-400">
                                {" "}
                                — “{r.note.trim().slice(0, 50)}
                                {r.note.trim().length > 50 ? "…" : ""}”
                              </span>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                {CONTEXT_CATEGORIES.filter(
                  (c) => c.id !== "previous_pd" && (staged[c.id].files.length || staged[c.id].text.trim())
                ).map((c) => (
                  <div key={c.id} className="mb-2 last:mb-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{c.label}</p>
                    <ul className="mt-0.5 text-sm text-gray-700">
                      {staged[c.id].files.map((f, i) => (
                        <li key={i} className="truncate">• {f.name}</li>
                      ))}
                      {staged[c.id].text.trim() && <li>• Pasted notes ({staged[c.id].text.trim().length} chars)</li>}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {committing && progress && (
              <div className="flex items-center gap-2 rounded-lg bg-chrome px-3 py-2 text-sm text-navy">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-navy border-t-transparent" />
                {progress}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-lg bg-red-50 px-3 py-2">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Nav */}
        <div className="mt-8 flex items-center justify-between">
          <div>
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => { setError(""); setStep((s) => s - 1); }} disabled={committing}>
                Back
              </Button>
            ) : (
              <Link href="/dashboard">
                <Button type="button" variant="ghost">Cancel</Button>
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext}>
                {step === 1 && fileCount === 0 ? "Skip — Review" : "Next"}
              </Button>
            ) : (
              <Button type="button" onClick={commit} disabled={committing}>
                {committing ? (
                  <>
                    <div className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Working…
                  </>
                ) : (
                  <>
                    <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate Report
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-gray-100 py-1.5 last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className="max-w-[60%] truncate text-right text-gray-800">{value}</span>
    </div>
  );
}

const WEIGHT_STYLES: Record<ContextCategoryDef["weight"], string> = {
  Highest: "bg-primary/10 text-primary-dark",
  High: "bg-primary/10 text-primary-dark",
  Medium: "bg-chrome text-gray-500",
  Supporting: "bg-chrome text-gray-400",
};

function CategoryCard({
  def,
  value,
  onAddFiles,
  onRemoveFile,
  onText,
}: {
  def: ContextCategoryDef;
  value: StagedCategory;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (idx: number) => void;
  onText: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{def.label}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${WEIGHT_STYLES[def.weight]}`}>
              {def.weight}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">{def.help}</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex-shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:bg-chrome"
        >
          Add files
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".txt,.md,.markdown,.pdf,.docx"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onAddFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      {/* Drop zone (only when empty, for a lighter look) */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) onAddFiles(Array.from(e.dataTransfer.files));
        }}
        className={`mt-3 rounded-lg border border-dashed px-3 py-2 text-center text-xs transition-colors ${
          dragOver ? "border-primary bg-primary/5 text-primary-dark" : "border-gray-200 text-gray-400"
        }`}
      >
        Drag files here, or use “Add files”
      </div>

      {/* Staged files */}
      {value.files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-chrome px-2 py-1 text-[11px] text-gray-600">
              {f.name}
              <button type="button" onClick={() => onRemoveFile(i)} className="ml-0.5 text-gray-400 hover:text-gray-600">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Paste text */}
      <textarea
        value={value.text}
        onChange={(e) => onText(e.target.value)}
        rows={2}
        placeholder="…or paste text / notes / links here"
        className="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-canvas px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
      />
    </div>
  );
}

function PreviousYearCard({
  def,
  rows,
  onAddFiles,
  onRemoveFile,
  onUpdateYear,
  onUpdateNote,
  onRemoveYear,
  onAddYear,
}: {
  def: ContextCategoryDef;
  rows: PyRow[];
  onAddFiles: (id: string, files: File[]) => void;
  onRemoveFile: (id: string, idx: number) => void;
  onUpdateYear: (id: string, year: number) => void;
  onUpdateNote: (id: string, note: string) => void;
  onRemoveYear: (id: string) => void;
  onAddYear: () => void;
}) {
  const minYear = Math.min(...rows.map((r) => r.year));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-900">{def.label}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${WEIGHT_STYLES[def.weight]}`}>
          {def.weight}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">{def.help}</p>

      <div className="mt-3 flex flex-col gap-2.5">
        {rows.map((r) => (
          <YearRow
            key={r.id}
            year={r.year}
            note={r.note}
            files={r.files}
            canRemove={rows.length > 1}
            onAddFiles={(fs) => onAddFiles(r.id, fs)}
            onRemoveFile={(i) => onRemoveFile(r.id, i)}
            onUpdateYear={(y) => onUpdateYear(r.id, y)}
            onUpdateNote={(n) => onUpdateNote(r.id, n)}
            onRemoveYear={() => onRemoveYear(r.id)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onAddYear}
        className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-primary/50 hover:text-navy"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add {minYear - 1}
      </button>
    </div>
  );
}

function YearRow({
  year,
  note,
  files,
  canRemove,
  onAddFiles,
  onRemoveFile,
  onUpdateYear,
  onUpdateNote,
  onRemoveYear,
}: {
  year: number;
  note: string;
  files: File[];
  canRemove: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (idx: number) => void;
  onUpdateYear: (year: number) => void;
  onUpdateNote: (note: string) => void;
  onRemoveYear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="rounded-lg border border-gray-100 bg-canvas p-3">
      {/* Editable year + actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Fiscal year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => onUpdateYear(parseInt(e.target.value, 10) || year)}
            className="w-[5.5rem] rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-semibold text-navy focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-navy transition-colors hover:bg-chrome"
          >
            Add files
          </button>
          {canRemove && (
            <button
              type="button"
              onClick={onRemoveYear}
              title="Remove this year"
              className="rounded-md p-1 text-gray-300 transition-colors hover:bg-chrome hover:text-gray-500"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".txt,.md,.markdown,.pdf,.docx"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onAddFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      {/* Drop zone — consistent with the other context categories */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) onAddFiles(Array.from(e.dataTransfer.files));
        }}
        className={`mt-2 rounded-lg border border-dashed px-3 py-2 text-center text-xs transition-colors ${
          dragOver
            ? "border-primary bg-primary/5 text-primary-dark"
            : "border-gray-200 text-gray-400"
        }`}
      >
        Drag files here, or use “Add files”
      </div>

      {/* Staged files */}
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-chrome px-2 py-1 text-[11px] text-gray-600">
              {f.name}
              <button type="button" onClick={() => onRemoveFile(i)} className="ml-0.5 text-gray-400 hover:text-gray-600">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Optional per-year note */}
      <textarea
        value={note}
        onChange={(e) => onUpdateNote(e.target.value)}
        rows={2}
        placeholder="Optional note for this year (e.g. “covers two projects — focus on the membrane work”)"
        className="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
      />
    </div>
  );
}

"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import Link from "next/link";
import Image from "next/image";

export default function NewProjectPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const createProject = useMutation(api.projects.createProject);
  const generateReport = useMutation(api.projects.scheduleGenerateReport);

  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [writer, setWriter] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [transcript, setTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  const wordCount = transcript
    .trim()
    .split(/\s+/)
    .filter((w) => w).length;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!transcript.trim()) {
      setError("Please paste the interview transcript.");
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      const { projectId, transcriptId } = await createProject({
        title: title.trim(),
        clientName: clientName.trim(),
        ...(writer.trim() ? { writer: writer.trim() } : {}),
        ...(interviewer.trim() ? { interviewer: interviewer.trim() } : {}),
        transcriptContent: transcript,
      });

      // Schedule generation in background — returns immediately
      await generateReport({ projectId, transcriptId });
      router.push(`/project/${projectId}`);
    } catch {
      setError("Failed to create project. Please try again.");
      setSubmitting(false);
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
      <div className="sticky top-0 z-50 w-full pt-5 px-[10%] bg-canvas">
        <header className="flex items-center bg-navy px-5 py-5 rounded-xl">
        <Link href="/dashboard" className="flex items-center gap-5 flex-shrink-0">
          <Image src="/logo.png" alt="Banhall" width={89} height={89} className="-my-5 brightness-0 invert" />
          <span className="text-sm text-white/60 hover:text-white/80 transition-colors">Dashboard</span>
        </Link>
        <svg className="mx-2 h-3 w-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm font-medium text-white">New Project</span>
      </header>
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <h2 className="text-xl font-semibold text-gray-900">New Project</h2>
        <p className="mt-1 text-sm text-gray-500">
          Enter project details and paste the interview transcript. The AI
          pipeline will generate a draft report automatically.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Input
              id="title"
              label="Project title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project Verdant F2024"
              required
            />
            <Input
              id="clientName"
              label="Client name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="GreenStem Nurseries Inc."
              required
            />
            <Input
              id="writer"
              label="Writer"
              value={writer}
              onChange={(e) => setWriter(e.target.value)}
              placeholder="Jane Smith"
            />
            <Input
              id="interviewer"
              label="Interviewer"
              value={interviewer}
              onChange={(e) => setInterviewer(e.target.value)}
              placeholder="John Doe"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="transcript"
                className="text-sm font-medium text-gray-700"
              >
                Interview transcript
              </label>
              {wordCount > 0 && (
                <span className="text-xs text-gray-400">
                  {wordCount.toLocaleString()} words
                </span>
              )}
            </div>
            <textarea
              id="transcript"
              rows={18}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Paste the full interview transcript here..."
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 font-serif text-sm leading-relaxed text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              required
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <div className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Creating...
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
            <Link href="/dashboard">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}

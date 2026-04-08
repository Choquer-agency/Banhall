"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import Link from "next/link";
import Image from "next/image";

const QUESTIONS = [
  {
    id: "company_background",
    label: "Company Background",
    question: "Describe your company, industry, and relevant domain expertise. What makes your team qualified to tackle this technical problem?",
    placeholder: "e.g., We are a 50-person horticulture company in BC with 15 years of experience managing multi-species greenhouses...",
    rows: 4,
  },
  {
    id: "project_goal",
    label: "Project Goal",
    question: "What are you trying to build, create, or improve? Describe the physical product, process, or system.",
    placeholder: "e.g., We are developing a custom software system using computer vision and environmental analytics to automatically track plant growth stages...",
    rows: 4,
  },
  {
    id: "business_problem",
    label: "Business Problem",
    question: "What business problem is driving this project? (e.g., reduce costs, enter new market, improve efficiency)",
    placeholder: "e.g., Manual inventory tracking of living plants is error-prone and labor-intensive, costing us X hours per week...",
    rows: 3,
  },
  {
    id: "technical_problem",
    label: "Technical / Scientific Problem",
    question: "What is the underlying technical or scientific problem? What knowledge gaps exist in your field that make this challenging?",
    placeholder: "e.g., Existing computer vision methods are designed for broad-acre agriculture, not multi-species nursery environments. No documented methods exist for...",
    rows: 4,
  },
  {
    id: "what_was_tried",
    label: "What Was Tried",
    question: "Describe the approaches, experiments, or iterations your team undertook. What did you try first? What worked? What didn't? What did you change?",
    placeholder: "e.g., First we tried using off-the-shelf image classification models, but they failed because... Then we developed a custom approach where...",
    rows: 6,
  },
  {
    id: "hypothesis",
    label: "Hypothesis",
    question: "What did you hypothesize would work? If [specific approach], then [expected measurable outcome].",
    placeholder: "e.g., We hypothesized that if we combined dual-spectrum imaging with environmental sensor data, then we could achieve growth stage classification accuracy above 85%...",
    rows: 3,
  },
  {
    id: "what_was_learned",
    label: "What Was Learned",
    question: "What new knowledge or understanding did your team gain? What worked, what didn't, and why?",
    placeholder: "e.g., We determined that temporal image sequences combined with environmental data significantly outperform single-image approaches for species classification...",
    rows: 4,
  },
  {
    id: "remaining_uncertainties",
    label: "Remaining Uncertainties",
    question: "What technical questions remain unresolved? What are you planning to investigate next?",
    placeholder: "e.g., Classification accuracy for early-stage seedlings remains below target. We need to investigate whether transfer learning from related species...",
    rows: 3,
  },
  {
    id: "team_and_timeline",
    label: "Team & Timeline",
    question: "Who worked on this project? Approximately how long did the R&D work take? Is it ongoing?",
    placeholder: "e.g., 3 developers and 1 horticultural scientist worked on this over 8 months. The project is continuing into the next fiscal year...",
    rows: 3,
  },
];

export default function QuestionnairePage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const createProject = useMutation(api.projects.createProject);
  const generateReport = useMutation(api.projects.scheduleGenerateReport);

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  function buildTranscriptFromAnswers(): string {
    return QUESTIONS.map((q) => {
      const answer = answers[q.id]?.trim() || "[No response provided]";
      return `## ${q.label}\nQ: ${q.question}\nA: ${answer}`;
    }).join("\n\n");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !clientName.trim()) {
      setError("Project title and client name are required.");
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      const transcriptContent = buildTranscriptFromAnswers();
      const { projectId, transcriptId } = await createProject({
        title: title.trim(),
        clientName: clientName.trim(),
        transcriptContent,
      });
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
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const currentQuestion = QUESTIONS[step];
  const isProjectInfo = step === -1;
  const isReview = step === QUESTIONS.length;
  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;
  const progress = ((step + 1) / (QUESTIONS.length + 1)) * 100;

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
          <span className="text-sm font-medium text-white">Self-Serve Questionnaire</span>
        </header>
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">
              {step < 0 ? "Project details" : isReview ? "Review & submit" : `Question ${step + 1} of ${QUESTIONS.length}`}
            </span>
            <span className="text-xs text-gray-400">{answeredCount}/{QUESTIONS.length} answered</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-200">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.max(progress, 2)}%` }}
            />
          </div>
        </div>

        {/* Step: Project info */}
        {step === -1 && (
          <div>
            <h2 className="text-xl font-semibold text-navy">Project Details</h2>
            <p className="mt-1 text-sm text-gray-500">Basic information about the SR&ED project.</p>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
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
            </div>
            <div className="mt-8 flex justify-end">
              <Button onClick={() => setStep(0)} disabled={!title.trim() || !clientName.trim()}>
                Start Questionnaire
              </Button>
            </div>
          </div>
        )}

        {/* Step: Questions */}
        {currentQuestion && step >= 0 && !isReview && (
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-navy">
                {step + 1}
              </span>
              <h2 className="text-lg font-semibold text-navy">{currentQuestion.label}</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">{currentQuestion.question}</p>
            <textarea
              value={answers[currentQuestion.id] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [currentQuestion.id]: e.target.value })}
              rows={currentQuestion.rows}
              placeholder={currentQuestion.placeholder}
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={() => setStep(step - 1)}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Back
              </button>
              <div className="flex items-center gap-3">
                {!answers[currentQuestion.id]?.trim() && (
                  <button
                    onClick={() => setStep(step + 1)}
                    className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Skip
                  </button>
                )}
                <Button onClick={() => setStep(step + 1)}>
                  {step === QUESTIONS.length - 1 ? "Review" : "Next"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step: Review & Submit */}
        {isReview && (
          <form onSubmit={handleSubmit}>
            <h2 className="text-xl font-semibold text-navy">Review & Submit</h2>
            <p className="mt-1 text-sm text-gray-500">
              Review your answers below. Click any section to edit. The AI will generate a full SR&ED report from your responses.
            </p>

            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Project</span>
                  <button type="button" onClick={() => setStep(-1)} className="text-xs text-primary hover:underline">Edit</button>
                </div>
                <p className="mt-1 text-sm font-medium text-gray-900">{title}</p>
                <p className="text-sm text-gray-500">{clientName}</p>
              </div>

              {QUESTIONS.map((q, i) => {
                const answer = answers[q.id]?.trim();
                return (
                  <div key={q.id} className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{q.label}</span>
                      <button type="button" onClick={() => setStep(i)} className="text-xs text-primary hover:underline">Edit</button>
                    </div>
                    {answer ? (
                      <p className="mt-1 text-sm text-gray-700 line-clamp-3">{answer}</p>
                    ) : (
                      <p className="mt-1 text-sm italic text-gray-400">Not answered</p>
                    )}
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="mt-4 text-sm text-red-500">{error}</p>
            )}

            <div className="mt-8 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(QUESTIONS.length - 1)}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Back
              </button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Generating..." : "Generate Report"}
              </Button>
            </div>
          </form>
        )}

        {/* Initial landing — show project info step first */}
        {step === -1 || null}
      </main>
    </div>
  );
}

<script lang="ts">
  import { goto } from "$app/navigation";
  import { useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";

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

  const auth = useAuth();
  const createProject = useMutation(api.projects.createProject);
  const generateReport = useMutation(api.generations.requestGeneration);

  let step = $state(0);
  let title = $state("");
  let clientName = $state("");
  let answers = $state<Record<string, string>>({});
  let submitting = $state(false);
  let error = $state("");

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  function buildTranscriptFromAnswers(): string {
    return QUESTIONS.map((q) => {
      const answer = answers[q.id]?.trim() || "[No response provided]";
      return `## ${q.label}\nQ: ${q.question}\nA: ${answer}`;
    }).join("\n\n");
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!title.trim() || !clientName.trim()) {
      error = "Project title and client name are required.";
      return;
    }
    error = "";
    submitting = true;

    try {
      const transcriptContent = buildTranscriptFromAnswers();
      const { projectId, transcriptId } = await createProject({
        title: title.trim(),
        clientName: clientName.trim(),
        transcriptContent,
      });
      await generateReport({ projectId, transcriptId });
      goto(`/project/${projectId}`);
    } catch {
      error = "Failed to create project. Please try again.";
      submitting = false;
    }
  }

  const currentQuestion = $derived(QUESTIONS[step]);
  const isReview = $derived(step === QUESTIONS.length);
  const answeredCount = $derived(Object.values(answers).filter((a) => a.trim()).length);
  const progress = $derived(((step + 1) / (QUESTIONS.length + 1)) * 100);

  // Port of React's autoFocus: focus the question textarea when it mounts.
  let questionEl: HTMLTextAreaElement | null = $state(null);
  $effect(() => {
    questionEl?.focus();
  });
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "Self-serve questionnaire" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <main class="mx-auto w-full max-w-[var(--container-shell)] flex-1 px-6 pt-12 pb-8">
      <!-- Focused one-question-at-a-time flow keeps a reading-width column
           inside the shared shell. -->
      <div class="mx-auto w-full max-w-2xl">
      <!-- Progress bar -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-medium text-gray-500">
            {step < 0 ? "Project details" : isReview ? "Review & submit" : `Question ${step + 1} of ${QUESTIONS.length}`}
          </span>
          <span class="text-xs text-gray-400">{answeredCount}/{QUESTIONS.length} answered</span>
        </div>
        <div class="h-1.5 w-full rounded-full bg-gray-200">
          <div
            class="h-1.5 rounded-full bg-primary transition-all duration-300"
            style="width: {Math.max(progress, 2)}%"
          ></div>
        </div>
      </div>

      <!-- Step: Project info -->
      {#if step === -1}
        <div>
          <h2 class="text-display">Project Details</h2>
          <p class="mt-1 text-sm text-gray-500">Basic information about the SR&ED project.</p>
          <div class="mt-6 grid gap-5 sm:grid-cols-2">
            <Input
              id="title"
              label="Project title"
              bind:value={title}
              placeholder="Project Verdant F2024"
              required
            />
            <Input
              id="clientName"
              label="Client name"
              bind:value={clientName}
              placeholder="GreenStem Nurseries Inc."
              required
            />
          </div>
          <div class="mt-8 flex justify-end">
            <Button onclick={() => (step = 0)} disabled={!title.trim() || !clientName.trim()}>
              Start Questionnaire
            </Button>
          </div>
        </div>
      {/if}

      <!-- Step: Questions -->
      {#if currentQuestion && step >= 0 && !isReview}
        <div>
          <div class="mb-1 flex items-center gap-2">
            <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-navy">
              {step + 1}
            </span>
            <h2 class="text-title">{currentQuestion.label}</h2>
          </div>
          <p class="text-sm text-gray-600 mb-4">{currentQuestion.question}</p>
          <textarea
            bind:this={questionEl}
            value={answers[currentQuestion.id] ?? ""}
            oninput={(e) => (answers[currentQuestion.id] = e.currentTarget.value)}
            rows={currentQuestion.rows}
            placeholder={currentQuestion.placeholder}
            class="w-full resize-none rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          ></textarea>
          <div class="mt-6 flex items-center justify-between">
            <button
              onclick={() => (step -= 1)}
              class="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Back
            </button>
            <div class="flex items-center gap-3">
              {#if !answers[currentQuestion.id]?.trim()}
                <button
                  onclick={() => (step += 1)}
                  class="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Skip
                </button>
              {/if}
              <Button onclick={() => (step += 1)}>
                {step === QUESTIONS.length - 1 ? "Review" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Step: Review & Submit -->
      {#if isReview}
        <form onsubmit={handleSubmit}>
          <h2 class="text-display">Review & Submit</h2>
          <p class="mt-1 text-sm text-gray-500">
            Review your answers below. Click any section to edit. The AI will generate a full SR&ED report from your responses.
          </p>

          <div class="mt-6 space-y-4">
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <div class="flex items-center justify-between">
                <span class="text-label">Project</span>
                <button type="button" onclick={() => (step = -1)} class="text-xs text-primary hover:underline">Edit</button>
              </div>
              <p class="mt-1 text-sm font-medium text-gray-900">{title}</p>
              <p class="text-sm text-gray-500">{clientName}</p>
            </div>

            {#each QUESTIONS as q, i (q.id)}
              {@const answer = answers[q.id]?.trim()}
              <div class="rounded-lg border border-gray-200 bg-white p-4">
                <div class="flex items-center justify-between">
                  <span class="text-label">{q.label}</span>
                  <button type="button" onclick={() => (step = i)} class="text-xs text-primary hover:underline">Edit</button>
                </div>
                {#if answer}
                  <p class="mt-1 text-sm text-gray-700 line-clamp-3">{answer}</p>
                {:else}
                  <p class="mt-1 text-sm italic text-gray-400">Not answered</p>
                {/if}
              </div>
            {/each}
          </div>

          {#if error}
            <p class="mt-4 text-sm text-red-500">{error}</p>
          {/if}

          <div class="mt-8 flex items-center justify-between">
            <button
              type="button"
              onclick={() => (step = QUESTIONS.length - 1)}
              class="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Back
            </button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Generating..." : "Generate Report"}
            </Button>
          </div>
        </form>
      {/if}
      </div>
    </main>
  </div>
{/if}

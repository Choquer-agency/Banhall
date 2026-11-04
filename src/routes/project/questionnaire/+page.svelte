<script lang="ts">
  import { goto } from "$app/navigation";
  import { goToLogin } from "$lib/auth/goToLogin";
  import { useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { QUESTIONS } from "./questions";

  const auth = useAuth();
  const createProject = useMutation(api.projects.createProject);
  const generateReport = useMutation(api.generations.requestGeneration);

  let step = $state(0);
  let title = $state("");
  let clientName = $state("");
  let answers = $state<Record<string, string>>({});
  let submitting = $state(false);
  let error = $state("");
  // Set once the project exists, so submitting again after a refused start
  // (the hourly run limit) starts the run without making a second project.
  // The saved answers are what that run reads, so editing is locked then.
  let createdProjectId = $state<Id<"projects"> | null>(null);

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goToLogin();
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
      const projectId =
        createdProjectId ??
        (await createProject({
          title: title.trim(),
          clientName: clientName.trim(),
          transcripts: [
            { content: buildTranscriptFromAnswers(), label: "Questionnaire answers" },
          ],
        })).projectId;
      createdProjectId = projectId;
      await generateReport({ projectId });
      goto(`/project/${projectId}`);
    } catch (cause) {
      error =
        userErrorCode(cause) === "RATE_LIMITED"
          ? `The run did not start. ${userErrorMessage(cause, "Try again later.")} Your answers are saved. The run will use them when you start it again.`
          : "Failed to create project. Please try again.";
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

    <main class="mx-auto w-full max-w-[var(--container-shell)] flex-1 page-gutter page-gutter-y pb-8">
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
            class="field-control w-full resize-none rounded-lg px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400"
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
            {#if createdProjectId}
              These answers are saved with your project. The AI will generate a full SR&ED report from them.
            {:else}
              Review your answers below. Click any section to edit. The AI will generate a full SR&ED report from your responses.
            {/if}
          </p>

          <div class="mt-6 space-y-4">
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <div class="flex items-center justify-between">
                <span class="text-label">Project</span>
                {#if !createdProjectId}
                  <button type="button" onclick={() => (step = -1)} class="text-xs text-primary hover:underline">Edit</button>
                {/if}
              </div>
              <p class="mt-1 text-sm font-medium text-gray-900">{title}</p>
              <p class="text-sm text-gray-500">{clientName}</p><p class="mt-1 text-xs text-ink-muted">You will be the initial Owner.</p>
            </div>

            {#each QUESTIONS as q, i (q.id)}
              {@const answer = answers[q.id]?.trim()}
              <div class="rounded-lg border border-gray-200 bg-white p-4">
                <div class="flex items-center justify-between">
                  <span class="text-label">{q.label}</span>
                  {#if !createdProjectId}
                    <button type="button" onclick={() => (step = i)} class="text-xs text-primary hover:underline">Edit</button>
                  {/if}
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
            {#if createdProjectId}
              <span></span>
            {:else}
              <button
                type="button"
                onclick={() => (step = QUESTIONS.length - 1)}
                class="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Back
              </button>
            {/if}
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

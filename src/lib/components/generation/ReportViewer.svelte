<script lang="ts">
  /**
   * Simple renderer for Tiptap JSON documents (port of
   * src/components/generation/ReportViewer.tsx).
   * This is a temporary read-only viewer — the full Tiptap editor replaces this in Phase 3.
   * Renders headings/paragraphs/rules, bold/italic/highlight marks, and turns a
   * JSON code block containing `overall_score` into the QA scorecard.
   *
   * Props:
   * - content: Tiptap document JSON as a string (shows a fallback message if unparsable)
   */
  interface TiptapNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: TiptapNode[];
    text?: string;
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  }
  type QAIssue = string | {
    text: string;
    severity: "deduction" | "warning";
    deduction?: number;
  };


  let { content }: { content: string } = $props();

  const doc = $derived.by(() => {
    try {
      return JSON.parse(content) as TiptapNode;
    } catch {
      return null;
    }
  });

  function extractText(node: TiptapNode): string {
    if (node.text) return node.text;
    if (!node.content) return "";
    return node.content.map(extractText).join("");
  }

  // Try to parse as JSON for the QA scorecard
  function tryParseJson(text: string): Record<string, unknown> | null {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null; // not JSON
    }
  }
</script>

<!-- Successive mark wrapping (last mark = outermost), matching the React reducer. -->
{#snippet marked(text: string, marks: NonNullable<TiptapNode["marks"]>, i: number)}
  {#if i < 0}{text}{:else if marks[i].type === "bold"}<strong>{@render marked(text, marks, i - 1)}</strong>{:else if marks[i].type === "italic"}<em>{@render marked(text, marks, i - 1)}</em>{:else if marks[i].type === "highlight"}<span class="rounded bg-gap-bg px-1 py-0.5 font-sans text-xs font-medium text-gap-text">{@render marked(text, marks, i - 1)}</span>{:else}{@render marked(text, marks, i - 1)}{/if}
{/snippet}

{#snippet inlineNode(node: TiptapNode)}
  {#if node.type === "text" && node.text}{@render marked(node.text, node.marks ?? [], (node.marks?.length ?? 0) - 1)}{/if}
{/snippet}

<!-- ─── QA Scorecard ────────────────────────────────────────────────────────── -->
{#snippet qaScorecard(data: Record<string, unknown>)}
  {@const overall = data.overall_score as number}
  {@const sections = data.section_scores as Record<string, { score: number; issues: QAIssue[]; strengths: string[] }>}
  {@const compliance = data.cra_compliance as Record<string, boolean>}
  {@const gaps = data.gaps_requiring_client_followup as Array<{ section: string; paragraph: number; question: string }>}
  {@const improvements = data.suggested_improvements as string[]}
  <div class="card mb-4 p-5 font-sans">
    <!-- Overall score -->
    <div class="flex items-center gap-3 mb-4">
      <div
        class={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${
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
        <p class="text-sm font-semibold text-gray-900">Overall QA Score</p>
        <p class="text-xs text-gray-500">
          {overall >= 80
            ? "Good — ready for review"
            : overall >= 60
              ? "Needs improvement"
              : "Major issues detected"}
        </p>
      </div>
    </div>

    <!-- Section scores -->
    <div class="grid grid-cols-3 gap-3 mb-4">
      {#if sections}
        {#each Object.entries(sections) as [key, section] (key)}
          <div class="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p class="text-xs font-medium text-gray-500">Section {key}</p>
            <p
              class={`text-lg font-bold ${
                section.score >= 80
                  ? "text-green-700"
                  : section.score >= 60
                    ? "text-amber-700"
                    : "text-red-700"
              }`}
            >
              {section.score}
            </p>
            {#if section.issues.length > 0}
              <ul class="mt-1.5 space-y-0.5">
                {#each section.issues as issue}
                  {@const item = typeof issue === "string" ? { text: issue, severity: "deduction" as const } : issue}
                  <li class={`text-xs ${item.severity === "warning" ? "text-amber-700" : "text-red-600"}`}>
                    {item.text}{item.deduction ? ` (−${item.deduction})` : ""}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <!-- CRA Compliance -->
    {#if compliance}
      <div class="mb-4">
        <p class="text-label mb-1.5">
          CRA Compliance
        </p>
        <div class="flex flex-wrap gap-2">
          {#each Object.entries(compliance) as [key, value] (key)}
            <span
              class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                value ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              }`}
            >
              {value ? "Pass" : "Fail"}: {key.replace(/_/g, " ")}
            </span>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Gaps requiring follow-up -->
    {#if gaps && gaps.length > 0}
      <div class="mb-4">
        <p class="text-label mb-1.5">
          Follow-up Questions
        </p>
        <ul class="space-y-1.5">
          {#each gaps as gap}
            <li class="rounded-lg bg-gap-bg px-3 py-2 text-xs text-gap-text">
              <span class="font-medium">Section {gap.section}, P{gap.paragraph}:</span> {gap.question}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Suggested improvements -->
    {#if improvements && improvements.length > 0}
      <div>
        <p class="text-label mb-1.5">
          Suggested Improvements
        </p>
        <ul class="space-y-1">
          {#each improvements as imp}
            <li class="text-xs text-gray-600">{imp}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet renderNode(node: TiptapNode)}
  {#if node.type === "heading"}
    {@const level = (node.attrs?.level as number) ?? 2}
    {#if level === 1}
      <h1 class="mb-2 text-2xl font-bold text-gray-900">{extractText(node)}</h1>
    {:else}
      <h2 class="mb-3 mt-8 text-lg font-semibold text-navy">{extractText(node)}</h2>
    {/if}
  {:else if node.type === "paragraph"}
    <p class="mb-4 text-sm leading-relaxed text-gray-800">{#each node.content ?? [] as child}{@render inlineNode(child)}{/each}</p>
  {:else if node.type === "horizontalRule"}
    <hr class="my-6 border-gray-200" />
  {:else if node.type === "codeBlock"}
    {@const text = extractText(node)}
    {@const parsed = tryParseJson(text)}
    {#if parsed && "overall_score" in parsed}
      {@render qaScorecard(parsed)}
    {:else}
      <pre class="mb-4 overflow-x-auto rounded-lg bg-gray-50 p-4 text-xs text-gray-700">{text}</pre>
    {/if}
  {/if}
{/snippet}

{#if !doc || !doc.content}
  <p class="text-sm text-gray-400">Could not render report content.</p>
{:else}
  <div class="report-viewer font-serif">
    {#each doc.content as node}{@render renderNode(node)}{/each}
  </div>
{/if}

<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../convex/_generated/dataModel";
  import { createUIMessages } from "$lib/chat/uiMessages.svelte";
  import type { UIMessage } from "@convex-dev/agent";
  import ProposalCard from "$lib/components/chat/ProposalCard.svelte";
  import ChatIcon from "$lib/components/ui/ChatIcon.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import ResearchFeed from "$lib/components/research/ResearchFeed.svelte";
  import type { ResearchSelection } from "$lib/components/editor/types";
  import { DropdownMenu } from "bits-ui";
  import { SvelteMap } from "svelte/reactivity";
  import { fade } from "svelte/transition";
  import {
    ChatContainer,
    ScrollButton,
    Message,
    MessageContent,
    MessageAvatar,
    MessageActions,
    ActionButton,
    PromptInput,
    PromptInputTextarea,
    PromptInputActions,
    Loader,
    Suggestion,
  } from "$lib/components/chat/primitives";
  import {
    parseFileToText,
    isSupportedFile,
    SUPPORTED_ACCEPT,
    SUPPORTED_LABEL,
  } from "$lib/parseDocument";
  import {
    CONTEXT_CATEGORIES,
    type ContextCategoryId,
    categoryMeta,
  } from "$lib/contextCategories";

  // Agent-based chat rail (BNH-10 P2) — streaming replacement for ChatPanel.
  // Messages come from the @convex-dev/agent component (token-streamed into
  // createUIMessages, our Svelte port of useUIMessages); edit/highlight cards
  // come from the reactive chatProposals table. Rendering is composed from
  // the chat primitives in $lib/components/chat/primitives.

  type Proposal = Doc<"chatProposals">;

  interface Props {
    projectId: Id<"projects">;
    reportId: Id<"reports">;
    pendingHighlight?: { from: number; to: number; text: string } | null;
    onClearHighlight?: () => void;
    pendingResearch?: ResearchSelection | null;
    onClearResearch?: () => void;
    isFull?: boolean;
    onToggleFull?: () => void;
    onReferenceText?: (texts: string[], scrollTo?: string) => void;
    onReviewReplacements?: (
      pairs: { find: string; replaceWith: string }[],
      proposalId: string
    ) => void;
    /** Live "Show changes" preview: render the proposal as strikethrough +
     * inline insertions in the real editor (on), or clear the preview (off). */
    onPreviewProposal?: (
      pairs: { find: string; replaceWith: string }[],
      on: boolean
    ) => void;
    reviewingId?: string | null;
    onBeforeApply?: () => Promise<unknown>;
  }

  let {
    projectId,
    reportId,
    pendingHighlight,
    onClearHighlight,
    pendingResearch,
    onClearResearch,
    isFull,
    onToggleFull,
    onReferenceText,
    onReviewReplacements,
    onPreviewProposal,
    reviewingId,
    onBeforeApply,
  }: Props = $props();

  /** The source passages a proposal references — for scroll-and-highlight. */
  function proposalRefs(p: Proposal): string[] {
    if (p.kind === "references") return p.references ?? [];
    if (p.replacements && p.replacements.length) {
      return p.replacements.map((r) => r.find).filter(Boolean);
    }
    if (p.targetText) return [p.targetText];
    return [];
  }

  function trimName(name: string): string {
    return name.length > 40 ? name.slice(0, 37) + "…" : name;
  }

  function guessFileType(
    name: string
  ): "txt" | "md" | "pdf" | "docx" | "msg" | "eml" | "xlsx" | "image" | "other" {
    const l = name.toLowerCase();
    if (l.endsWith(".pdf")) return "pdf";
    if (l.endsWith(".docx")) return "docx";
    if (l.endsWith(".msg")) return "msg";
    if (l.endsWith(".eml") || l.endsWith(".mbox")) return "eml";
    if (l.endsWith(".xlsx") || l.endsWith(".xls") || l.endsWith(".csv")) return "xlsx";
    if (l.endsWith(".md") || l.endsWith(".markdown")) return "md";
    if (l.endsWith(".txt")) return "txt";
    return "other";
  }

  /** Visible text of a UIMessage (joins text parts; ignores tool/reasoning). */
  function messageText(m: UIMessage): string {
    return m.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
  }

  /** Split the appended highlight excerpt back out of a writer message. */
  function splitWriterMessage(text: string): { content: string; highlight?: string } {
    const marker = "\n\n[Writer highlighted this excerpt from the report]:\n\"\"\"";
    const idx = text.indexOf(marker);
    if (idx === -1) return { content: text };
    const rest = text.slice(idx + marker.length);
    const end = rest.lastIndexOf('"""');
    return {
      content: text.slice(0, idx),
      highlight: end >= 0 ? rest.slice(0, end) : rest,
    };
  }

  /** Hide structured proposal-refinement context appended to saved messages. */
  function visibleWriterMessage(text: string) {
    const marker = "\n\n[Writer is refining suggestion ";
    const index = text.indexOf(marker);
    return index === -1 ? text : text.slice(0, index);
  }

  /** SR&ED-relevant conversation starters for the empty state. */
  const STARTERS = [
    "Tighten section 242's uncertainty framing",
    "Find every mention of the prototype",
    "Check this report for banned words",
    "Make the work-performed section more chronological",
  ];

  const HINT_KEY = "banhall.chat.hintSeen";

  /** 0ms transitions when the writer prefers reduced motion. */
  function motionDuration(ms: number): number {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : ms;
  }

  const threadsQ = useQuery(api.chatV2.listThreads, () => ({ reportId }));
  let selectedThreadId = $state<string | null>(null);

  /** True between "New chat" and the first send — keeps the auto-select
   * effect from snapping back to the newest existing thread. */
  let startingNewChat = $state(false);

  // Default to the newest thread (unless the writer just started a new chat).
  $effect(() => {
    const threads = threadsQ.data;
    if (
      selectedThreadId === null &&
      !startingNewChat &&
      threads &&
      threads.length > 0
    ) {
      selectedThreadId = threads[0].agentThreadId;
    }
  });

  const threadTitle = $derived.by(() => {
    if (startingNewChat || !selectedThreadId) return "New chat";
    const t = threadsQ.data?.find((t) => t.agentThreadId === selectedThreadId);
    return t?.title ?? "New chat";
  });

  function startNewThread() {
    startingNewChat = true;
    selectedThreadId = null;
    input = "";
    refiningProposal = null;
    onClearHighlight?.();
    onClearResearch?.();
    textareaEl?.focus();
  }

  function selectThread(threadId: string) {
    startingNewChat = false;
    selectedThreadId = threadId;
    input = "";
    refiningProposal = null;
  }

  const ui = createUIMessages(
    api.chatV2.listMessages,
    () => (selectedThreadId ? { threadId: selectedThreadId } : "skip"),
    { initialNumItems: 80 }
  );
  const messages = $derived(ui.results);

  const proposalsQ = useQuery(api.chatV2.listProposals, () =>
    selectedThreadId ? { threadId: selectedThreadId } : "skip"
  );

  const researchSessionsQ = useQuery(api.research.listSessions, () => ({ reportId }));
  const hasResearch = $derived((researchSessionsQ.data?.length ?? 0) > 0);

  const sendMessage = useMutation(api.chatV2.sendMessage);
  const abortStreaming = useMutation(api.chatV2.abortStreaming);
  const uploadDocument = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const startResearch = useMutation(api.research.startResearch);


  let input = $state("");
  let sending = $state(false);
  let researchStarting = $state(false);
  let researchError = $state<string | null>(null);
  let sendError = $state<string | null>(null);
  let retryText = $state<string | null>(null);
  let refiningProposal = $state<Proposal | null>(null);
  let stopping = $state(false);
  let uploading = $state(false);

  // Copy-to-clipboard feedback (assistant hover actions).
  let copiedId = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyMessage(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedId = id;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedId = null), 1600);
    } catch (e) {
      console.error("Copy failed", e);
    }
  }

  // Keyboard hint under the composer — shown until the writer's first send
  // (persisted so it never comes back once learned).
  let showHint = $state(false);
  $effect(() => {
    try {
      showHint = localStorage.getItem(HINT_KEY) !== "1";
    } catch {
      showHint = false;
    }
  });

  function dismissHint() {
    if (!showHint) return;
    showHint = false;
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  }
  let uploadError = $state<string | null>(null);
  let attachments = $state<
    { documentId: Id<"projectDocuments">; fileName: string; category: ContextCategoryId }[]
  >([]);
  let pendingFiles = $state<File[] | null>(null);

  let fileInputEl: HTMLInputElement | null = $state(null);
  let textareaEl: HTMLTextAreaElement | null = $state(null);
  let pillEl: HTMLSpanElement | null = $state(null);
  let pillWidth = $state(0);
  let chatContainer: ChatContainer | null = $state(null);

  function messageToolCallIds(message: UIMessage) {
    return new Set(
      message.parts.flatMap((part) =>
        "toolCallId" in part && typeof part.toolCallId === "string"
          ? [part.toolCallId]
          : []
      )
    );
  }

  // Associate proposal cards with their exact assistant tool call. Older rows
  // fall back to the reply sharing their prompt's order, then nearby creation
  // time, instead of accumulating in a detached stack at the bottom.
  const grouped = $derived.by(() => {
    const byMessage = new SvelteMap<string, Proposal[]>();
    const orphans: Proposal[] = [];
    const allMessages = messages ?? [];
    const assistantMessages = allMessages.filter((m) => m.role === "assistant");
    const toolOwners = new SvelteMap<string, UIMessage>();
    for (const message of assistantMessages) {
      for (const toolCallId of messageToolCallIds(message)) {
        toolOwners.set(toolCallId, message);
      }
    }
    const messageById = new SvelteMap(allMessages.map((message) => [message.id, message]));

    const proposals = proposalsQ.data ?? [];
    const latestPendingIndexByPrompt = new SvelteMap<string, number>();
    proposals.forEach((proposal, index) => {
      if (proposal.state === "pending" && proposal.promptMessageId) {
        latestPendingIndexByPrompt.set(proposal.promptMessageId, index);
      }
    });

    for (const [proposalIndex, proposal] of proposals.entries()) {
      // A refinement turn supersedes the previous pending card from that prompt.
      // Keep the latest actionable wording in the timeline instead of stacking
      // every intermediate iteration in the narrow chat rail.
      if (
        proposal.state === "pending" &&
        proposal.promptMessageId &&
        latestPendingIndexByPrompt.get(proposal.promptMessageId) !== proposalIndex
      ) {
        continue;
      }
      let owner = proposal.toolCallId ? toolOwners.get(proposal.toolCallId) : undefined;
      if (!owner && proposal.promptMessageId) {
        const prompt = messageById.get(proposal.promptMessageId);
        if (prompt) {
          owner = assistantMessages.find((message) => message.order === prompt.order);
        }
      }
      if (!owner && proposal.messageId) owner = messageById.get(proposal.messageId);
      if (!owner) {
        owner = [...assistantMessages]
          .reverse()
          .find((message) => message._creationTime <= proposal.createdAt);
      }
      if (!owner) {
        orphans.push(proposal);
        continue;
      }
      const list = byMessage.get(owner.id) ?? [];
      list.push(proposal);
      byMessage.set(owner.id, list);
    }
    return { byMessage, orphans };
  });

  const composerSelection = $derived(pendingResearch ?? pendingHighlight);
  const composerContextActive = $derived(refiningProposal !== null || composerSelection !== null);
  const canLoadOlder = $derived(ui.status === "CanLoadMore" || ui.status === "LoadingMore");

  // Measure the selected-text pill so the textarea's first line starts beside it.
  $effect(() => {
    void composerSelection?.text;
    void refiningProposal?._id;
    if (composerContextActive && pillEl) {
      pillWidth = pillEl.offsetWidth + 10;
    } else {
      pillWidth = 0;
    }
  });

  // BNH-25: when a NEW proposal references passages, auto scroll the document
  // to them and highlight. Seed on first load so opening a thread doesn't jump
  // to a historical edit — only fire for fresh proposals.
  let lastProposalId: string | null = null;
  let proposalSeeded = false;
  $effect(() => {
    const proposals = proposalsQ.data;
    if (!proposals || proposals.length === 0) return;
    const latest = proposals[proposals.length - 1];
    if (!proposalSeeded) {
      proposalSeeded = true;
      lastProposalId = latest._id;
      return;
    }
    if (lastProposalId === latest._id) return;
    lastProposalId = latest._id;
    const refs = proposalRefs(latest);
    if (refs.length) onReferenceText?.(refs);
  });

  // Selecting editor text for chat or research moves focus into the shared composer.
  $effect(() => {
    if (composerSelection) textareaEl?.focus();
  });

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (
      (!trimmed && !pendingHighlight && !pendingResearch) ||
      sending ||
      researchStarting ||
      isStreaming
    ) return;

    if (pendingResearch) {
      researchStarting = true;
      researchError = null;
      try {
        await startResearch({
          reportId,
          selectedText: pendingResearch.text,
          selectionFrom: pendingResearch.from,
          selectionTo: pendingResearch.to,
          surroundingContext: pendingResearch.context,
          instruction: trimmed,
        });
        input = "";
        onClearResearch?.();
        dismissHint();
        chatContainer?.scrollToBottom("instant");
      } catch (e) {
        researchError =
          e instanceof Error ? e.message : "Research could not be started.";
      } finally {
        researchStarting = false;
      }
      return;
    }

    sending = true;
    sendError = null;
    try {
      const res = await sendMessage({
        reportId,
        content: trimmed,
        ...(selectedThreadId ? { threadId: selectedThreadId } : {}),
        ...(pendingHighlight ? { highlight: pendingHighlight } : {}),
        ...(refiningProposal ? { refineProposalId: refiningProposal._id } : {}),
        ...(startingNewChat ? { newThread: true } : {}),
      });
      selectedThreadId = res.threadId;
      startingNewChat = false;
      input = "";
      refiningProposal = null;
      onClearHighlight?.();
      dismissHint();
      // Re-pin to the bottom even if the writer had scrolled up — a fresh
      // send should always bring their message (and the reply) into view.
      chatContainer?.scrollToBottom("instant");
    } catch (e) {
      console.error("Failed to send message", e);
      retryText = trimmed;
      sendError = e instanceof Error ? e.message : "Your message could not be sent.";
    } finally {
      sending = false;
    }
  }

  async function uploadFiles(files: File[], category: ContextCategoryId) {
    if (!files || files.length === 0) return;
    pendingFiles = null;
    uploading = true;
    uploadError = null;
    try {
      for (const file of files) {
        let storageId: Id<"_storage"> | undefined;
        try {
          const url = await generateUploadUrl({});
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

        let parsed;
        try {
          parsed = await parseFileToText(file);
        } catch (e) {
          console.error("Parse failed", e);
          parsed = { fileName: file.name, fileType: guessFileType(file.name), content: "" };
        }

        const documentId = await uploadDocument({
          projectId,
          reportId,
          fileName: file.name,
          fileType: parsed.fileType,
          content: parsed.content,
          source: "chat_upload",
          category,
          ...(storageId ? { storageId } : {}),
          ...(file.type ? { mimeType: file.type } : {}),
        });
        attachments = [...attachments, { documentId, fileName: file.name, category }];

        if (!parsed.content.trim()) {
          uploadError = `"${trimName(file.name)}" was added to Files, but no readable text was found for the assistant to use (outlined fonts or a scanned image).`;
        }
      }
    } catch (e) {
      console.error("Upload failed", e);
      uploadError = "Upload failed. Please try again.";
    } finally {
      uploading = false;
      if (fileInputEl) fileInputEl.value = "";
    }
  }

  const highlightLineCount = $derived(
    composerSelection ? composerSelection.text.split("\n").length : 0
  );

  const isEmpty = $derived(!messages || messages.length === 0);
  const isConversationEmpty = $derived(isEmpty && !hasResearch && !pendingResearch);

  // Typing dots while the reply hasn't started streaming text yet.
  const lastMessage = $derived(
    messages.length ? messages[messages.length - 1] : undefined
  );
  const awaitingReply = $derived(
    !!lastMessage &&
      (lastMessage.role === "user" ||
        (lastMessage.role === "assistant" &&
          lastMessage.status === "streaming" &&
          !messageText(lastMessage)))
  );

  // A reply is in flight (queued or token-streaming) — send becomes Stop.
  const isStreaming = $derived(
    !!lastMessage &&
      (awaitingReply ||
        (lastMessage.role === "assistant" &&
          (lastMessage.status === "streaming" ||
            lastMessage.status === "pending")))
  );

  /** Abort the in-flight reply. The reply shares its prompt's order, so the
   * last message's order addresses the stream whether or not tokens have
   * started rendering. */
  async function stopGeneration() {
    if (!selectedThreadId || !lastMessage || stopping) return;
    stopping = true;
    try {
      await abortStreaming({
        threadId: selectedThreadId,
        order: lastMessage.order,
      });
    } catch (e) {
      console.error("Failed to stop generation", e);
    } finally {
      stopping = false;
    }
  }

  // ── Day separators ──────────────────────────────────────────────────────
  function sameDay(a: number, b: number): boolean {
    const da = new Date(a);
    const db = new Date(b);
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  }

  function dayLabel(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const startOfDay = (x: Date) =>
      new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    });
  }
</script>

{#snippet proposalView(p: Proposal)}
  {#if p.kind === "references"}
    {@const refs = p.references ?? []}
    {#if refs.length && onReferenceText}
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span class="inline-flex items-center gap-1 text-xs text-gray-400">
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {refs.length === 1 ? "Jump to:" : `Jump to (${refs.length}):`}
        </span>
        {#each refs as ref, i (i)}
          <button
            onclick={() => onReferenceText?.([ref], ref)}
            title={ref.length > 90 ? `${ref.slice(0, 90)}…` : ref}
            class="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-gray-200 px-2 text-xs font-semibold text-navy transition-colors hover:border-primary/50 hover:bg-primary/5"
          >
            {i + 1}
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <ProposalCard
      proposal={p}
      {onBeforeApply}
      {onReferenceText}
      {onReviewReplacements}
      {onPreviewProposal}
      onRefine={(proposal) => {
        refiningProposal = proposal;
        input = "";
        retryText = null;
        textareaEl?.focus();
        chatContainer?.scrollToBottom("smooth");
      }}
      reviewing={reviewingId === p._id}
    />
  {/if}
{/snippet}

{#snippet composer()}
  {#if sendError}
    <div class="mb-2 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
      <span class="min-w-0 flex-1">{sendError}</span>
      <div class="flex shrink-0 items-center gap-1">
        {#if retryText}
          <ActionButton
            variant="danger"
            class="min-h-7 px-2"
            onclick={() => sendText(retryText ?? "")}
            disabled={sending || isStreaming}
          >
            Retry
          </ActionButton>
        {/if}
        <ActionButton
          variant="icon"
          class="h-7 w-7 text-red-500 hover:bg-red-100 hover:text-red-700"
          tooltip="Dismiss error"
          aria-label="Dismiss send error"
          onclick={() => {
            sendError = null;
            retryText = null;
          }}
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </ActionButton>
      </div>
    </div>
  {/if}

  {#if uploadError}
    <div class="mb-2 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600">
      <span>{uploadError}</span>
      <button
        aria-label="Dismiss"
        onclick={() => (uploadError = null)}
        class="mt-0.5 flex-shrink-0 text-red-400 hover:text-red-600"
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  {/if}

  {#if pendingFiles}
    {@const files = pendingFiles}
    <div class="mb-2 rounded-xl border border-navy/15 bg-navy/5 p-3">
      <p class="mb-2 text-xs text-navy">
        What {files.length > 1 ? "are these files" : `is “${trimName(files[0].name)}”`}? Pick a category:
      </p>
      <div class="flex flex-wrap gap-1.5">
        {#each CONTEXT_CATEGORIES as c (c.id)}
          <button
            onclick={() => uploadFiles(files, c.id)}
            class={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 ${c.pill}`}
          >
            {c.label}
          </button>
        {/each}
        <button
          onclick={() => (pendingFiles = null)}
          class="rounded-full px-2.5 py-1 text-[11px] font-medium text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  {#if attachments.length > 0}
    <div class="mb-2 flex flex-wrap gap-1.5">
      {#each attachments as a, i (`${a.documentId}-${i}`)}
        {@const meta = categoryMeta(a.category)}
        <span class="inline-flex items-center gap-1 rounded-md bg-chrome px-2 py-1 text-[11px] text-gray-600">
          <svg class="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          {trimName(a.fileName)}
          {#if meta}
            <span class={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${meta.pill}`}>
              {meta.label}
            </span>
          {/if}
          <span class="ml-1 text-[10px] text-ink-muted">Project context</span>
        </span>
      {/each}
    </div>
  {/if}

  {#if researchError}
    <div class="mb-2 flex items-start justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">
      <span>{researchError}</span>
      <button
        type="button"
        aria-label="Dismiss research error"
        onclick={() => (researchError = null)}
        class="shrink-0 text-red-400 transition-colors hover:text-red-600"
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  {/if}

  <PromptInput bind:value={input} isLoading={sending || researchStarting} onSubmit={(v) => sendText(v)}>
    <PromptInputActions>
      <ActionButton
        variant="icon"
        class="mb-0.5 h-9 w-9 rounded-full"
        onclick={() => fileInputEl?.click()}
        disabled={uploading}
        tooltip="Add a document to project context"
        aria-label="Add a document to project context"
      >
        {#if uploading}
          <Spinner size="sm" class="border-gray-300 border-t-gray-500" />
        {:else}
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        {/if}
      </ActionButton>
      <input
        bind:this={fileInputEl}
        type="file"
        multiple
        accept={SUPPORTED_ACCEPT}
        class="hidden"
        onchange={(e) => {
          const target = e.currentTarget;
          if (target.files && target.files.length) {
            const all = Array.from(target.files);
            const ok = all.filter((f) => isSupportedFile(f.name));
            const bad = all.filter((f) => !isSupportedFile(f.name));
            if (bad.length) {
              uploadError = `Unsupported file type: ${bad
                .map((f) => f.name)
                .join(", ")}. Supported: ${SUPPORTED_LABEL}.`;
            }
            if (ok.length) pendingFiles = ok;
          }
          target.value = "";
        }}
      />
    </PromptInputActions>

    <PromptInputTextarea
      bind:ref={textareaEl}
      aria-label="Message the report assistant"
      textIndent={composerContextActive ? pillWidth : undefined}
      placeholder={pendingResearch
        ? "What should the research verify?"
        : refiningProposal
          ? "How should I revise this suggestion?"
          : pendingHighlight
            ? "Add instructions…"
            : isEmpty
              ? "Ask anything about this report…"
              : "Ask a follow-up…"}
    >
      {#snippet pill()}
        {#if refiningProposal}
          <span
            bind:this={pillEl}
            class="absolute left-1 top-1 z-10 inline-flex max-w-[70%] items-center gap-1.5 rounded-full bg-primary-wash px-2.5 py-1 text-xs font-medium text-primary-selected shadow-sm"
          >
            <svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
            </svg>
            <span class="truncate">Refining suggestion</span>
            <button
              type="button"
              onclick={() => (refiningProposal = null)}
              class="shrink-0 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Stop refining suggestion"
            >
              <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        {:else if composerSelection}
          <span
            bind:this={pillEl}
            title={composerSelection.text}
            class={`absolute left-1 top-1 z-10 inline-flex max-w-[70%] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm ${
              pendingResearch ? "bg-primary-wash text-primary-selected" : "bg-white text-navy"
            }`}
          >
            <svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              {#if pendingResearch}
                <circle cx="11" cy="11" r="7" />
                <path stroke-linecap="round" d="m20 20-3.4-3.4" />
              {:else}
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              {/if}
            </svg>
            <span class="truncate">
              {pendingResearch ? `Research: ${composerSelection.text.replace(/\s+/g, " ").trim()}` : "Pasted text #1"}
            </span>
            {#if highlightLineCount > 1}
              <span class="shrink-0">+{highlightLineCount} lines</span>
            {/if}
            <button
              type="button"
              onclick={pendingResearch ? onClearResearch : onClearHighlight}
              class="shrink-0 opacity-50 transition-opacity hover:opacity-100"
              aria-label={pendingResearch ? "Remove research selection" : "Remove pasted text"}
            >
              <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        {/if}
      {/snippet}
    </PromptInputTextarea>

    <PromptInputActions>
      {#if isStreaming}
        <button
          onclick={stopGeneration}
          disabled={stopping || !selectedThreadId}
          class="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-white transition-colors hover:bg-navy-light disabled:opacity-50"
          title="Stop generating"
          aria-label="Stop generating"
        >
          <svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </svg>
        </button>
      {:else}
        <button
          onclick={() => sendText(input)}
          disabled={sending || researchStarting || (!input.trim() && !pendingHighlight && !pendingResearch)}
          class="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-white transition-colors hover:bg-navy-light disabled:opacity-30"
          title={pendingResearch ? "Start research" : "Send"}
          aria-label="Send message"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      {/if}
    </PromptInputActions>
  </PromptInput>

  {#if showHint}
    <p
      transition:fade={{ duration: motionDuration(300) }}
      class="pt-1.5 text-center text-[11px] text-gray-400"
    >
      Enter to send&nbsp;&nbsp;·&nbsp;&nbsp;Shift+Enter for new line
    </p>
  {/if}
{/snippet}

<div class="flex h-full flex-col bg-white">
  <!-- Header (pr-12 clears the workspace's overlay close button) -->
  <div class="flex shrink-0 items-center gap-2.5 border-b border-chrome py-2.5 pl-5 pr-12">
    <MessageAvatar>
      <ChatIcon class="h-3 w-3" />
    </MessageAvatar>
    <div class="min-w-0 flex-1 leading-tight">
      <span class="block text-sm font-semibold text-navy">Assistant</span>
      <span class="block truncate text-[11px] text-gray-500">{threadTitle}</span>
    </div>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Conversation menu"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="end"
          sideOffset={8}
          class="z-[100] max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg"
        >
          <DropdownMenu.Item
            onSelect={startNewThread}
            class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-navy outline-none hover:bg-primary-wash focus:bg-primary-wash"
          >
            <svg class="h-4 w-4 text-primary-selected" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" d="M12 5v14M5 12h14" />
            </svg>
            New conversation
          </DropdownMenu.Item>
          {#if (threadsQ.data?.length ?? 0) > 0}
            <div class="my-1 border-t border-line-soft"></div>
            {#each threadsQ.data ?? [] as thread (thread._id)}
              <DropdownMenu.Item
                onSelect={() => selectThread(thread.agentThreadId)}
                class={`block w-full rounded-lg px-3 py-2 text-left outline-none hover:bg-primary-wash focus:bg-primary-wash ${thread.agentThreadId === selectedThreadId ? "bg-primary-wash text-navy" : "text-ink-secondary"}`}
              >
                <span class="block truncate text-sm font-medium">{thread.title}</span>
                <span class="text-data mt-0.5 block text-ink-muted">
                  {new Date(thread.createdAt).toLocaleDateString()}
                </span>
              </DropdownMenu.Item>
            {/each}
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    {#if onToggleFull}
      <button
        onclick={onToggleFull}
        title={isFull ? "Exit full screen" : "Expand to full screen"}
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
      >
        {#if isFull}
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 9L4 4m0 0v4m0-4h4m7 5l5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4m7-5l5 5m0 0v-4m0 4h-4" />
          </svg>
        {:else}
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        {/if}
      </button>
    {/if}
  </div>


  {#if isConversationEmpty}
    <!-- Empty state: brand mark, capability blurb, starter suggestions -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8">
      <span class="mb-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-white">
        <ChatIcon class="h-5 w-5" />
      </span>
      <h2 class="text-center text-[19px] font-semibold text-navy">
        How can I help with this report?
      </h2>
      <p class="mt-1.5 max-w-[320px] text-center text-xs leading-relaxed text-ink-muted">
        I can tighten language, find passages, check compliance, and propose
        edits — grounded in this report and its source documents.
      </p>
      <div class="mb-7 mt-6 flex w-full max-w-[340px] flex-col gap-1.5">
        {#each STARTERS as starter (starter)}
          <Suggestion
            class="w-full justify-start rounded-lg px-3 py-2 text-left"
            disabled={sending}
            onclick={() => sendText(starter)}
          >
            {starter}
          </Suggestion>
        {/each}
      </div>
      <div class="w-full">{@render composer()}</div>
    </div>
  {:else}
    <ChatContainer
      bind:this={chatContainer}
      class="min-h-0 flex-1"
      viewportClass="px-5 py-4"
      contentClass="space-y-3"
    >
      {#if canLoadOlder}
        <div class="flex justify-center pb-1">
          <ActionButton
            variant="ghost"
            onclick={() => ui.loadMore(40)}
            loading={ui.status === "LoadingMore"}
            loadingLabel="Loading…"
          >
            Load earlier messages
          </ActionButton>
        </div>
      {/if}

      {#each messages as m, i (m.key)}
        {@const text = messageText(m)}
        {@const prev = i > 0 ? messages[i - 1] : undefined}
        {#if prev && !sameDay(prev._creationTime, m._creationTime)}
          <div class="flex items-center gap-3 py-1" role="separator" aria-label={dayLabel(m._creationTime)}>
            <span class="h-px flex-1 bg-line-soft"></span>
            <span class="text-label">{dayLabel(m._creationTime)}</span>
            <span class="h-px flex-1 bg-line-soft"></span>
          </div>
        {/if}
        {#if m.role === "user"}
          {@const split = splitWriterMessage(visibleWriterMessage(text))}
          <Message role="user">
            <MessageContent>
              {#if split.highlight}
                <p class="mb-2 italic text-navy/80">&ldquo;{split.highlight}&rdquo;</p>
              {/if}
              {#if split.content}
                <p class="whitespace-pre-wrap">{split.content}</p>
              {/if}
            </MessageContent>
          </Message>
        {:else if m.role === "assistant"}
          {@const own = grouped.byMessage.get(m.id) ?? []}
          <Message role="assistant" class="group">
            {#if text}
              <MessageContent
                markdown
                {text}
                class={m.status === "failed" ? "text-red-500" : undefined}
              />
            {/if}
            {#each own as p (p._id)}
              {@render proposalView(p)}
            {/each}
            {#if text && m.status !== "streaming" && m.status !== "pending"}
              <MessageActions>
                <Tooltip text={copiedId === m.id ? "Copied!" : "Copy message"} side="bottom" delayDuration={300}>
                  {#snippet children({ props })}
                <button
                  {...props}
                  type="button"
                  onclick={() => copyMessage(m.id, text)}
                  aria-label={copiedId === m.id ? "Copied" : "Copy message"}
                  class="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
                >
                  {#if copiedId === m.id}
                    <svg class="h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  {:else}
                    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path stroke-linecap="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  {/if}
                </button>
                {/snippet}
                </Tooltip>
              </MessageActions>
            {/if}
          </Message>
        {/if}
      {/each}

      <!-- Proposals we couldn't pin to a specific message -->
      {#if grouped.orphans.length > 0}
        <Message role="assistant">
          {#each grouped.orphans as p (p._id)}
            {@render proposalView(p)}
          {/each}
        </Message>
      {/if}

      <ResearchFeed
        {reportId}
        {onReferenceText}
        {onPreviewProposal}
        {onBeforeApply}
        onRefineProposal={(proposal) => {
          refiningProposal = proposal;
          input = "";
          textareaEl?.focus();
          chatContainer?.scrollToBottom("smooth");
        }}
      />

      {#if awaitingReply}
        <Loader class="py-1" />
      {/if}

      <ScrollButton />
    </ChatContainer>

    <div class="shrink-0 border-t border-chrome px-4 py-3">{@render composer()}</div>
  {/if}
</div>

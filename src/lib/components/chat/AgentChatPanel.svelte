<script lang="ts">
  import { tick, untrack } from "svelte";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { appendOutbox } from "$lib/uploads/attemptOutbox";
  import {
    ATTEMPT_BATCH_LIMIT,
    flushOutboxFor,
    shouldDropOutboxEntry,
    withUploadTimeout,
  } from "$lib/uploads/outboxFlush";
  import UploadReceipt from "$lib/components/upload/UploadReceipt.svelte";
  import {
    buildReceiptRows,
    type EphemeralEntry,
    type ReceiptRow,
  } from "$lib/uploads/receiptRows";
  import { deriveProcessingStatus } from "../../../../shared/documentStatus";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../convex/_generated/dataModel";
  import { createUIMessages } from "$lib/chat/uiMessages.svelte";
  import type { UIMessage } from "@convex-dev/agent";
  import AssistantTurn from "$lib/components/chat/AssistantTurn.svelte";
  import {
    correlateProposals,
    associateTurnPrompts,
    canRegenerateTurn,
    normalizeTurnParts,
    type TurnTiming,
  } from "$lib/chat/turnParts";
  import ChatIcon from "$lib/components/ui/ChatIcon.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import ResearchFeed from "$lib/components/research/ResearchFeed.svelte";
  import type { ResearchSelection } from "$lib/components/editor/types";
  import { DropdownMenu } from "bits-ui";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import Button from "$lib/components/ui/Button.svelte";
  import { fade } from "svelte/transition";
  import {
    ChatContainer,
    ScrollButton,
    Message,
    MessageContent,
    MessageAvatar,
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
  import { createRequestId } from "$lib/requestId";

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
    return normalizeTurnParts(m).text;
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
  let draftConversationId = $state(createRequestId());
  const conversationScope = $derived(selectedThreadId ? `thread:${selectedThreadId}` : `draft:${draftConversationId}`);

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

  function startNewThread() {
    startingNewChat = true;
    draftConversationId = createRequestId();
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
  const recordUploadAttempts = useMutation(api.uploadAttempts.recordUploadAttempts);
  const dismissUploadAttempt = useMutation(api.uploadAttempts.dismissUploadAttempt);

  // Only needed to scope the offline outbox to whoever queued an entry: a
  // failure recorded by one user must never be flushed under another's session.
  const uploadAuth = useAuth();
  const currentUserQ = useQuery(api.users.getCurrentUser, () =>
    uploadAuth.isAuthenticated ? {} : "skip"
  );


  let input = $state("");
  let sending = $state(false);
  let researchStarting = $state(false);
  let researchError = $state<string | null>(null);
  type SendIntent = { kind: "composer" } | { kind: "regenerate"; threadId: string };
  type LocalSend = {
    key: string;
    scope: string;
    intent: SendIntent;
    args: Parameters<typeof sendMessage>[0];
    display: { content: string; highlight?: string };
    startOrder: number;
    afterOrder: number;
    conversationNumber: number;
    retried: boolean;
    state: { kind: "sending" } | { kind: "failed"; error: string } |
      { kind: "published"; threadId: string; messageId: string };
  };
  let localSends = $state<LocalSend[]>([]);
  let nextConversationNumber = 1;
  const unresolvedDraftSend = $derived(!selectedThreadId && localSends.some(request => request.scope === conversationScope));
  const composerChatBlocked = $derived(!pendingResearch && unresolvedDraftSend);
  const visibleLocalSends = $derived(localSends.filter(request => request.scope === conversationScope &&
    !(request.state.kind === "published" && ui.hasPersistedMessage(request.state))));
  // Presentation-only placement. Orders are captured anchors, never synthetic
  // UIMessage orders; every timing/action/query consumer still uses messages.
  type TranscriptRow = { kind: "message"; key: string; message: UIMessage; previous?: UIMessage } |
    { kind: "local"; key: string; request: LocalSend };
  const transcriptRows = $derived.by(() => {
    const rows: TranscriptRow[] = [];
    let remaining = visibleLocalSends;
    for (const [index, message] of messages.entries()) {
      const before = remaining.filter(request => request.afterOrder < message.order);
      rows.push(...before.map(request => ({ kind: "local" as const, key: `local:${request.key}`, request })));
      remaining = remaining.filter(request => !before.includes(request));
      rows.push({ kind: "message", key: `message:${message.key}`, message, previous: messages[index - 1] });
    }
    rows.push(...remaining.map(request => ({ kind: "local" as const, key: `local:${request.key}`, request })));
    return rows;
  });

  function unsentConversationLabel(request: LocalSend) {
    const preview = (request.display.content || request.display.highlight || "Selected excerpt").replace(/\s+/g, " ").trim();
    return `Unsent conversation ${request.conversationNumber}: ${preview.length > 72 ? `${preview.slice(0, 71)}…` : preview}`;
  }

  function dismissRequest(key: string, button: HTMLButtonElement) {
    if (document.activeElement === button) textareaEl?.focus();
    localSends = localSends.filter(request => request.key !== key || request.state.kind !== "failed");
  }

  async function revealRequest(request: LocalSend) {
    await tick();
    if (conversationScope !== request.scope) return;
    chatContainer?.scrollToBottom("instant");
    document.getElementById(`local-send-${request.key}`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }

  // Keep the existing explicit return affordance for a failed historical send.
  const displacedHistoricalFailure = $derived(localSends.find(request =>
    request.intent.kind === "regenerate" && request.scope !== conversationScope && request.state.kind === "failed"));
  const unsavedConversations = $derived(localSends.filter((request, index) =>
    request.scope.startsWith("draft:") && localSends.findIndex(other => other.scope === request.scope) === index));

  $effect(() => {
    const reconciled = localSends.filter(request => request.state.kind === "published" && ui.hasPersistedMessage(request.state));
    if (reconciled.length) localSends = localSends.filter(request => !reconciled.includes(request));
  });
  // A successful mutation may precede its live query update. Hold the shared
  // send guard until that exact durable turn reaches a terminal state.
  // Retaining its original window also covers navigation past its message page.
  const pendingSendByThread = new SvelteMap<string, { messageId: string; startOrder: number; searchEndOrder?: number }>();
  let pendingResearchId = $state<Id<"researchSessions"> | null>(null);
  let refiningProposal = $state<Proposal | null>(null);
  let stopping = $state(false);
  let uploading = $state(false);

  // Copy-to-clipboard feedback (assistant hover actions).
  let copiedId = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  /** Load a suggestion into the composer for a refinement turn. */
  function refineProposal(proposal: Proposal) {
    refiningProposal = proposal;
    input = "";
    textareaEl?.focus();
    chatContainer?.scrollToBottom("smooth");
  }

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
  /**
   * The live receipt: one entry per file in the current batch. Plain data only
   * — the `File` objects live in `retryableFiles` below, deliberately outside
   * reactive state, because host objects don't belong in a proxy.
   */
  let receiptEntries = $state<EphemeralEntry[]>([]);
  const retryableFiles = new Map<string, { file: File; category: ContextCategoryId }>();
  const receiptBusy = new SvelteSet<string>();
  const receiptRows = $derived(buildReceiptRows([], [], receiptEntries));
  const receiptSettled = $derived(receiptEntries.some((entry) => entry.status !== null));
  let attachments = $state<
    { documentId: Id<"projectDocuments">; fileName: string; category: ContextCategoryId }[]
  >([]);
  let pendingFiles = $state<File[] | null>(null);

  let fileInputEl: HTMLInputElement | null = $state(null);
  let textareaEl: HTMLTextAreaElement | null = $state(null);
  let pillEl: HTMLSpanElement | null = $state(null);
  let pillWidth = $state(0);
  let chatContainer: ChatContainer | null = $state(null);

  // Proposal→message association lives in $lib/chat/turnParts so the exact
  // toolCallId match and its legacy fallbacks stay unit-testable.
  const grouped = $derived(
    correlateProposals(messages ?? [], proposalsQ.data ?? [])
  );

  // Durable turn timing ("Worked for 12s"). The agent component's UIMessage
  // can't express it: its _creationTime is enqueue time and is regenerated on
  // every streaming re-derive, so the app records start/end itself. Scoped to
  // the orders currently loaded, so pagination doesn't widen the read.
  // Primitive bounds, not an object: token deltas change `messages` constantly
  // while the order range holds steady, and a fresh object would tear down and
  // recreate the subscription on every delta.
  const startOrder = $derived(
    messages.length ? Math.min(...messages.map((m) => m.order)) : -1
  );
  const endOrder = $derived(
    messages.length ? Math.max(...messages.map((m) => m.order)) : -1
  );

  const turnsQ = useQuery(api.chatV2.listTurns, () => {
    if (!selectedThreadId || startOrder < 0) return "skip";
    const pending = pendingSendByThread.get(selectedThreadId);
    return { threadId: selectedThreadId, startOrder: pending ? Math.min(startOrder, pending.startOrder) : startOrder, endOrder };
  });

  // listTurns returns at most the newest 200 records. If an unobserved send
  // is older, walk bounded windows backwards without widening the live feed.
  const pendingTurnsQ = useQuery(api.chatV2.listTurns, () => {
    if (!selectedThreadId) return "skip";
    const pending = pendingSendByThread.get(selectedThreadId);
    return pending?.searchEndOrder === undefined ? "skip" : {
      threadId: selectedThreadId, startOrder: pending.startOrder, endOrder: pending.searchEndOrder,
    };
  });
  const pendingResearchQ = useQuery(api.research.getSessionDetails, () =>
    pendingResearchId && researchSessionsQ.data?.length === 20 &&
      !researchSessionsQ.data.some(session => session._id === pendingResearchId)
      ? { sessionId: pendingResearchId } : "skip"
  );

  // The reply shares its prompt's order, so order is the join key.
  const timingByOrder = $derived.by(() => {
    const map = new SvelteMap<number, TurnTiming>();
    for (const turn of turnsQ.data ?? []) {
      map.set(turn.order, {
        status: turn.status,
        ...(turn.startedAt !== undefined ? { startedAt: turn.startedAt } : {}),
        ...(turn.endedAt !== undefined ? { endedAt: turn.endedAt } : {}),
        stepCount: turn.stepCount,
      });
    }
    return map;
  });

  const turnPrompts = $derived(associateTurnPrompts(messages));
  const regenerationLoading = $derived(ui.isLoading || turnsQ.isLoading || turnsQ.isStale || !!turnsQ.error);

  $effect(() => {
    const threadId = selectedThreadId;
    if (!threadId || regenerationLoading) return;
    const pending = pendingSendByThread.get(threadId);
    if (!pending) return;
    const scanning = pending.searchEndOrder !== undefined;
    const query = scanning ? pendingTurnsQ : turnsQ;
    if (query.isLoading || query.isStale || query.error) return;
    const turns = query.data ?? [];
    const ownTurn = turns.find(turn => turn.promptMessageId === pending.messageId);
    if (ownTurn) {
      if (ownTurn.status === "completed" || ownTurn.status === "failed" || ownTurn.status === "aborted") {
        pendingSendByThread.delete(threadId);
      }
    } else if (turns.length === 200) {
      const nextEnd = Math.min(...turns.map(turn => turn.order)) - 1;
      if (nextEnd >= pending.startOrder && nextEnd < (pending.searchEndOrder ?? Infinity)) {
        pendingSendByThread.set(threadId, { ...pending, searchEndOrder: nextEnd });
      }
    }
  });

  $effect(() => {
    if (researchSessionsQ.isLoading || researchSessionsQ.isStale || researchSessionsQ.error) return;
    const listedResearch = researchSessionsQ.data?.find(session => session._id === pendingResearchId);
    if (listedResearch) {
      // Keep observing our active session if newer report research later
      // displaces it from the capped list.
      if (listedResearch.status === "completed" || listedResearch.status === "failed" || listedResearch.status === "canceled") pendingResearchId = null;
    } else if (pendingResearchId && !pendingResearchQ.isLoading && !pendingResearchQ.isStale && !pendingResearchQ.error) {
      const status = pendingResearchQ.data?.session.status;
      if (pendingResearchQ.data === null || status === "completed" || status === "failed" || status === "canceled") pendingResearchId = null;
    }
  });

  const publicationPending = $derived(!!pendingResearchId ||
    !!(selectedThreadId && pendingSendByThread.has(selectedThreadId)));

  function returnToRequest(request: LocalSend) {
    if (request.scope.startsWith("thread:")) {
      selectedThreadId = request.scope.slice("thread:".length);
      startingNewChat = false;
    } else {
      draftConversationId = request.scope.slice("draft:".length);
      selectedThreadId = null;
      startingNewChat = true;
    }
  }

  function regeneration(order: number, text: string | undefined, status: UIMessage["status"] | undefined, timing: TurnTiming | undefined) {
    const threadId = selectedThreadId;
    if (!threadId || regenerationLoading || text === undefined || !canRegenerateTurn(status, timing)) return undefined;
    // An absent timing record outside the capped window is not proof of a
    // legacy turn; it could be a stopped or still-running durable turn.
    if (!timing && turnsQ.data?.length === 200 && order < Math.min(...turnsQ.data.map(turn => turn.order))) return undefined;
    const excerpt = text.replace(/\s+/g, " ").trim();
    return {
      disabled: regenerationBusy,
      description: `Regenerate response to: ${excerpt.length > 160 ? `${excerpt.slice(0, 159)}…` : excerpt}`,
      onRegenerate: () => sendText(text, { kind: "regenerate", threadId }),
    };
  }

  // A tool-using turn can span several message rows. Rate it once, after its
  // final visible answer, using the durable turn rather than a streaming ID.
  const feedbackTurnByMessage = $derived.by(() => {
    const lastAnswerByOrder = new Map<number, UIMessage>();
    for (const message of messages) {
      if (message.role === "assistant" && message.status === "success" &&
          message.parts.some(part => part.type === "text" && part.text.trim())) {
        lastAnswerByOrder.set(message.order, message);
      }
    }
    const map = new Map<string, Id<"chatTurns">>();
    for (const turn of (turnsQ.data ?? [])) {
      const answer = lastAnswerByOrder.get(turn.order);
      if (turn.status === "completed" && answer) map.set(answer.id, turn._id);
    }
    return map;
  });
  // Keep the subscription stable as streamed parts update unchanged turn IDs.
  const feedbackTurnIdKey = $derived([...feedbackTurnByMessage.values()].join(","));
  const feedbackTurnIds = $derived.by(() => {
    void feedbackTurnIdKey;
    return untrack(() => [...feedbackTurnByMessage.values()]);
  });
  const eligibleFeedbackViewer = $derived(uploadAuth.isAuthenticated &&
    !!currentUserQ.data?.role && currentUserQ.data.isAnonymous !== true);
  const feedbackQ = useQuery(api.chatFeedback.getViewerVotes, () =>
    eligibleFeedbackViewer && selectedThreadId && feedbackTurnIds.length
      ? { reportId, threadId: selectedThreadId, turnIds: feedbackTurnIds }
      : "skip"
  );
  const submitAnswerFeedback = useMutation(api.chatFeedback.submitFeedback);
  const savedVotes = new SvelteMap<string, 1 | -1>();
  const feedbackBusy = new SvelteSet<string>();
  const feedbackErrors = new SvelteMap<string, string>();
  function feedbackKey(turnId: Id<"chatTurns">) {
    return `${currentUserQ.data?._id ?? ""}:${turnId}`;
  }
  async function rateAnswer(turnId: Id<"chatTurns">, vote: 1 | -1) {
    const key = feedbackKey(turnId);
    if (feedbackBusy.has(key) || savedVotes.has(key) || feedbackQ.data?.some(row => row.turnId === turnId) || feedbackQ.isLoading || feedbackQ.error || !eligibleFeedbackViewer) return;
    feedbackBusy.add(key);
    feedbackErrors.delete(key);
    try {
      const recordedVote = await submitAnswerFeedback({ turnId, vote });
      savedVotes.set(key, recordedVote);
    } catch {
      feedbackErrors.set(key, "Could not save feedback. Please try again.");
    } finally {
      feedbackBusy.delete(key);
    }
  }
  function answerFeedback(messageId: string) {
    const turnId = feedbackTurnByMessage.get(messageId);
    if (!turnId || !eligibleFeedbackViewer) return undefined;
    const key = feedbackKey(turnId);
    return {
      value: savedVotes.get(key) ?? feedbackQ.data?.find((row) => row.turnId === turnId)?.vote ?? null,
      disabled: feedbackQ.isLoading || !!feedbackQ.error || !currentUserQ.data || feedbackBusy.has(key),
      error: feedbackQ.error ? "Feedback is unavailable. Please refresh this page to try again." : feedbackErrors.get(key),
      onVote: (vote: 1 | -1) => rateAnswer(turnId, vote),
    };
  }

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

  async function sendText(text: string, intent: SendIntent = { kind: "composer" }) {
    const historical = intent.kind === "regenerate";
    const trimmed = historical ? text : text.trim();
    if (
      (historical ? !trimmed.trim() : (!trimmed && !pendingHighlight && !pendingResearch)) ||
      (intent.kind === "regenerate" && (intent.threadId !== selectedThreadId || regenerationBusy)) ||
      sending ||
      researchStarting ||
      publicationPending ||
      (!historical && composerChatBlocked) ||
      isStreaming
    ) return;

    if (!historical && pendingResearch) {
      researchStarting = true;
      researchError = null;
      try {
        const sessionId = await startResearch({
          reportId,
          selectedText: pendingResearch.text,
          selectionFrom: pendingResearch.from,
          selectionTo: pendingResearch.to,
          surroundingContext: pendingResearch.context,
          instruction: trimmed,
        });
        pendingResearchId = sessionId;
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

    const args: Parameters<typeof sendMessage>[0] = {
      reportId,
      content: trimmed,
      ...(intent.kind === "regenerate" ? { threadId: intent.threadId } : {
        ...(selectedThreadId ? { threadId: selectedThreadId } : {}),
        ...(pendingHighlight ? { highlight: { ...pendingHighlight } } : {}),
        ...(refiningProposal ? { refineProposalId: refiningProposal._id } : {}),
        ...(!selectedThreadId ? { newThread: true } : {}),
      }),
    };
    const request: LocalSend = {
      key: createRequestId(), scope: conversationScope, intent, args,
      display: historical ? splitWriterMessage(visibleWriterMessage(trimmed)) : {
        content: trimmed, ...(args.highlight ? { highlight: args.highlight.text } : {}),
      },
      startOrder: Math.max(0, endOrder), afterOrder: endOrder,
      conversationNumber: nextConversationNumber++, retried: false, state: { kind: "sending" },
    };
    localSends = [...localSends, request];
    // Consume only the captured composer, synchronously. Later edits/context
    // are never cleared by mutation completion or retry.
    if (!historical) {
      if (!selectedThreadId) startingNewChat = true;
      input = "";
      refiningProposal = null;
      onClearHighlight?.();
    }
    dismissHint();
    const transmission = transmitRequest(request);
    void revealRequest(request);
    await transmission;
  }

  function retryRequest(key: string, button: HTMLButtonElement) {
    const request = localSends.find(candidate => candidate.key === key);
    if (!request || request.state.kind !== "failed" || request.scope !== conversationScope ||
      sending || researchStarting || publicationPending || isStreaming ||
      (request.intent.kind === "regenerate" && regenerationBusy)) return;
    void transmitRequest(request, button);
  }

  async function transmitRequest(request: LocalSend, retryButton?: HTMLButtonElement) {
    sending = true;
    localSends = localSends.map(candidate => candidate.key === request.key
      ? { ...candidate, retried: candidate.retried || !!retryButton, state: { kind: "sending" } } : candidate);
    try {
      const res = await sendMessage(request.args);
      if (res.messageId) pendingSendByThread.set(res.threadId, { messageId: res.messageId, startOrder: request.startOrder });
      const isOriginVisible = conversationScope === request.scope;
      // Keep Retry mounted during transmission. On success hand keyboard focus
      // to the composer only if the writer is still on this originating button.
      if (isOriginVisible && retryButton && document.activeElement === retryButton) textareaEl?.focus();
      localSends = localSends.map(candidate => candidate.key === request.key ? {
        ...candidate, scope: `thread:${res.threadId}`,
        state: { kind: "published", threadId: res.threadId, messageId: res.messageId },
      } : candidate);
      if (isOriginVisible && request.intent.kind === "composer") {
        selectedThreadId = res.threadId;
        startingNewChat = false;
      }
      if (isOriginVisible) chatContainer?.scrollToBottom("instant");
    } catch (e) {
      localSends = localSends.map(candidate => candidate.key === request.key ? {
        ...candidate, state: { kind: "failed", error: e instanceof Error && e.message.trim() ? e.message : "Your message could not be sent." },
      } : candidate);
    } finally {
      sending = false;
    }
  }

  type AttemptInfo = { attemptKey: string; fileName: string; fileSizeBytes: number };

  /**
   * Record failures durably. If the server is unreachable the failure is queued
   * locally instead, because a network failure is precisely the case that
   * leaves no server-side trace. Never throws: failing to record a failure must
   * not also break the upload flow.
   */
  async function recordFailedChatAttempts(
    entries: AttemptInfo[],
    failureCode: "rejected_unsupported" | "upload_failed"
  ) {
    for (let i = 0; i < entries.length; i += ATTEMPT_BATCH_LIMIT) {
      const slice = entries.slice(i, i + ATTEMPT_BATCH_LIMIT);
      try {
        await withUploadTimeout(
          recordUploadAttempts({
            projectId,
            attempts: slice.map((a) => ({
              attemptKey: a.attemptKey,
              fileName: a.fileName,
              fileSizeBytes: a.fileSizeBytes,
              origin: "chat_upload" as const,
              failureCode,
            })),
          })
        );
      } catch (err) {
        console.error("Failed to record upload attempts", err);
        // The server considered it and refused: queueing would be poison.
        if (shouldDropOutboxEntry(err)) continue;
        const userId = currentUserQ.data?._id;
        if (!userId) continue;
        for (const a of slice) {
          appendOutbox(userId, {
            userId,
            projectId,
            attemptKey: a.attemptKey,
            fileName: a.fileName,
            fileSizeBytes: a.fileSizeBytes,
            origin: "chat_upload",
            failureCode,
            at: Date.now(),
          });
        }
      }
    }
  }

  /** Update one receipt row in place, keyed by its attempt. */
  function patchReceipt(attemptKey: string, patch: Partial<EphemeralEntry>) {
    receiptEntries = receiptEntries.map((entry) =>
      entry.attemptKey === attemptKey ? { ...entry, ...patch } : entry
    );
  }

  /**
   * Run one file all the way through: store the bytes, extract the text, and
   * record the document. Returns whether the row ended up on the receipt as a
   * success, so the caller can decide about the rest of the batch.
   */
  async function uploadOne(
    file: File,
    attemptKey: string,
    category: ContextCategoryId
  ): Promise<boolean> {
    let storageId: Id<"_storage"> | undefined;
    try {
      const url = await withUploadTimeout(generateUploadUrl({}));
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const json = (await res.json()) as { storageId: Id<"_storage"> };
      storageId = json.storageId;
    } catch (e) {
      // Losing the original bytes still leaves the extracted text worth having.
      console.error("File storage upload failed", e);
    }

    let parsed;
    let extractionFailed = false;
    try {
      parsed = await parseFileToText(file);
    } catch (e) {
      console.error("Parse failed", e);
      extractionFailed = true;
      parsed = { fileName: file.name, fileType: guessFileType(file.name), content: "" };
    }

    try {
      const documentId = await withUploadTimeout(
        uploadDocument({
          projectId,
          reportId,
          fileName: file.name,
          fileType: parsed.fileType,
          content: parsed.content,
          source: "chat_upload",
          category,
          // A validated enum, never the error itself: the server decides
          // what the failure means, and no provider text can ride along.
          extractionOutcome: extractionFailed ? "failed" : "ok",
          // Resolves this file's attempt in the same transaction as the insert.
          attemptKey,
          ...(storageId ? { storageId } : {}),
          ...(file.type ? { mimeType: file.type } : {}),
        })
      );

      // The server owns the stored status; deriving the same facts here only
      // decides what this row shows, and uses the very same function.
      const derived = deriveProcessingStatus({
        fileName: file.name,
        content: parsed.content,
        extractionFailed,
      });
      patchReceipt(attemptKey, {
        status: derived.status,
        detail: derived.detail,
        documentId,
        hasFile: false,
      });
      // The bytes are only needed for a retry, and this one succeeded.
      retryableFiles.delete(attemptKey);
      attachments = [...attachments, { documentId, fileName: file.name, category }];
      return true;
    } catch (e) {
      console.error("Upload failed", e);
      patchReceipt(attemptKey, { status: "upload_failed", hasFile: true });
      await recordFailedChatAttempts(
        [{ attemptKey, fileName: file.name, fileSizeBytes: file.size }],
        "upload_failed"
      );
      return false;
    }
  }

  async function uploadFiles(files: File[], category: ContextCategoryId) {
    if (!files || files.length === 0) return;
    pendingFiles = null;
    uploading = true;

    const flushUserId = currentUserQ.data?._id;
    if (flushUserId) {
      // Opportunistic: anything queued while offline goes out now that we know
      // the network is being used again.
      void flushOutboxFor(flushUserId, projectId, (attempts) =>
        recordUploadAttempts({ projectId, attempts })
      );
    }

    const batch = files.map((file) => ({ file, attemptKey: createRequestId() }));

    // Every file appears immediately as its own row, so the user watches the
    // batch resolve instead of waiting for one message at the end.
    receiptEntries = [
      ...receiptEntries,
      ...batch.map(({ file, attemptKey }) => ({
        attemptKey,
        fileName: file.name,
        fileSizeBytes: file.size,
        status: null,
        hasFile: true,
      })),
    ];
    for (const { file, attemptKey } of batch) {
      retryableFiles.set(attemptKey, { file, category });
    }

    try {
      for (let i = 0; i < batch.length; i += ATTEMPT_BATCH_LIMIT) {
        await withUploadTimeout(
          recordUploadAttempts({
            projectId,
            attempts: batch.slice(i, i + ATTEMPT_BATCH_LIMIT).map((b) => ({
              attemptKey: b.attemptKey,
              fileName: b.file.name,
              fileSizeBytes: b.file.size,
              origin: "chat_upload" as const,
            })),
          })
        );
      }
    } catch (e) {
      // A lost begin is safe: the failure path upserts its own row, and
      // resolving a non-existent attempt is a no-op.
      console.error("Failed to open upload attempts", e);
    }

    try {
      for (const { file, attemptKey } of batch) {
        const ok = await uploadOne(file, attemptKey, category);
        if (!ok) {
          // The batch stops at the first failure, so mark the files that never
          // got their turn rather than leaving them reading forever.
          const remaining = batch.slice(batch.findIndex((b) => b.attemptKey === attemptKey) + 1);
          for (const b of remaining) {
            patchReceipt(b.attemptKey, { status: "upload_failed", hasFile: true });
          }
          if (remaining.length) {
            await recordFailedChatAttempts(
              remaining.map((b) => ({
                attemptKey: b.attemptKey,
                fileName: b.file.name,
                fileSizeBytes: b.file.size,
              })),
              "upload_failed"
            );
          }
          break;
        }
      }
    } finally {
      uploading = false;
      if (fileInputEl) fileInputEl.value = "";
    }
  }

  async function retryUpload(row: ReceiptRow) {
    const key = row.attemptKey;
    if (!key || uploading || receiptBusy.has(row.key)) return;
    const held = retryableFiles.get(key);
    if (!held) return;

    receiptBusy.add(row.key);
    patchReceipt(key, { status: null });
    try {
      // Same attemptKey throughout: the server upsert flips the row back to
      // in-progress, so a retry can never create a second record.
      await withUploadTimeout(
        recordUploadAttempts({
          projectId,
          attempts: [
            {
              attemptKey: key,
              fileName: held.file.name,
              fileSizeBytes: held.file.size,
              origin: "chat_upload" as const,
            },
          ],
        })
      );
    } catch (e) {
      console.error("Failed to reopen upload attempt", e);
    }
    try {
      await uploadOne(held.file, key, held.category);
    } finally {
      receiptBusy.delete(row.key);
    }
  }

  async function removeReceiptRow(row: ReceiptRow) {
    const key = row.attemptKey;
    if (!key) return;
    retryableFiles.delete(key);
    receiptEntries = receiptEntries.filter((entry) => entry.attemptKey !== key);
    try {
      await withUploadTimeout(dismissUploadAttempt({ projectId, attemptKey: key }));
    } catch (e) {
      // The row is already gone from view; the durable row ages out on its own.
      console.error("Could not dismiss upload attempt", e);
    }
  }

  /** Clears rows that have finished, keeping anything still in flight. */
  function dismissReceipt() {
    const settledKeys = new Set(
      receiptEntries
        .filter((entry) => entry.status !== null)
        .map((entry) => entry.attemptKey)
    );
    for (const key of settledKeys) retryableFiles.delete(key);
    receiptEntries = receiptEntries.filter((entry) => entry.status === null);
  }

  const highlightLineCount = $derived(
    composerSelection ? composerSelection.text.split("\n").length : 0
  );

  const isEmpty = $derived(!messages || messages.length === 0);
  const isConversationEmpty = $derived(isEmpty && visibleLocalSends.length === 0 && !hasResearch && !pendingResearch);

  // Typing dots while the reply hasn't started streaming text yet.
  const lastMessage = $derived(
    messages.length ? messages[messages.length - 1] : undefined
  );
  /**
   * The turn row for a reply that has no assistant message yet. It carries the
   * queued/working state during the scheduler gap — and, crucially, the
   * terminal state when a turn is stopped or fails *before* producing a
   * message, which is the only record that the turn is over.
   */
  const pendingTiming = $derived(
    lastMessage?.role === "user" ? timingByOrder.get(lastMessage.order) : undefined
  );

  /** A trailing prompt whose turn already ended without ever replying. */
  const pendingTurnEnded = $derived(
    pendingTiming !== undefined &&
      pendingTiming.status !== "queued" &&
      pendingTiming.status !== "running"
  );

  const awaitingReply = $derived(
    !!lastMessage &&
      !pendingTurnEnded &&
      (lastMessage.role === "user" ||
        (lastMessage.role === "assistant" &&
          lastMessage.status === "streaming" &&
          !messageText(lastMessage)))
  );

  // A reply is in flight (queued or token-streaming) — send becomes Stop.
  const isStreaming = $derived(
    !!lastMessage &&
      !pendingTurnEnded &&
      (awaitingReply ||
        (lastMessage.role === "assistant" &&
          (lastMessage.status === "streaming" ||
            lastMessage.status === "pending")))
  );

  const regenerationBusy = $derived(regenerationLoading || sending || researchStarting || isStreaming ||
    researchSessionsQ.isLoading || researchSessionsQ.isStale || !!researchSessionsQ.error ||
    publicationPending ||
    (turnsQ.data ?? []).some(turn => turn.status === "queued" || turn.status === "running") ||
    (researchSessionsQ.data ?? []).some(session =>
      session.status === "queued" || session.status === "researching" || session.status === "reviewing"));

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

{#snippet writerContent(split: { content: string; highlight?: string })}
  {#if split.highlight}
    <p class="mb-2 italic text-navy/80">&ldquo;{split.highlight}&rdquo;</p>
  {/if}
  {#if split.content.trim()}
    <p class="whitespace-pre-wrap">{split.content.trim()}</p>
  {/if}
{/snippet}

{#snippet localMessage(request: LocalSend)}
  <div id={`local-send-${request.key}`} data-local-request={request.key} data-send-state={request.state.kind}>
    <Message role="user">
      <MessageContent class="min-w-0 [overflow-wrap:anywhere]">
        <div id={`local-send-content-${request.key}`}>{@render writerContent(request.display)}</div>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {#if request.state.kind === "failed"}
            <span class="text-red-700" role="alert">{request.state.error}</span>
          {:else}
            <span class="text-ink-muted" role="status">{request.state.kind === "published" ? "Sent" : "Sending…"}</span>
          {/if}
          {#if request.state.kind === "failed" || request.retried}
            <ActionButton variant="danger" class="min-h-7 px-2 font-medium aria-disabled:opacity-50"
              aria-label="Retry"
              aria-describedby={`local-send-content-${request.key}`}
              aria-disabled={request.state.kind !== "failed"}
              disabled={request.state.kind === "failed" && (request.intent.kind === "regenerate" ? regenerationBusy : sending || researchStarting || publicationPending || isStreaming)}
              onclick={(event) => retryRequest(request.key, event.currentTarget)}>Retry</ActionButton>
          {/if}
          {#if request.state.kind === "failed"}
            <ActionButton variant="danger" class="min-h-7 px-2 font-medium" aria-label="Dismiss send error"
              aria-describedby={`local-send-content-${request.key}`}
              onclick={(event) => dismissRequest(request.key, event.currentTarget)}>Dismiss</ActionButton>
          {/if}
        </div>
      </MessageContent>
    </Message>
  </div>
{/snippet}

{#snippet composer()}
  {#if displacedHistoricalFailure && displacedHistoricalFailure.state.kind === "failed"}
    <div class="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
      <span class="min-w-0 [overflow-wrap:anywhere]">{displacedHistoricalFailure.state.error}</span>
      <ActionButton variant="danger" onclick={() => displacedHistoricalFailure && returnToRequest(displacedHistoricalFailure)}>
        Return to original conversation
      </ActionButton>
      <ActionButton variant="danger" aria-label="Dismiss send error"
        onclick={(event) => displacedHistoricalFailure && dismissRequest(displacedHistoricalFailure.key, event.currentTarget)}>Dismiss</ActionButton>
    </div>
  {/if}

  {#if receiptRows.length > 0}
    <!-- One row per file, replacing the single overwriting error message: in a
         mixed batch that message could only ever describe one file. -->
    <div class="mb-2 rounded-xl border border-line bg-chrome/50 px-3 py-2">
      <UploadReceipt
        rows={receiptRows}
        heading="Uploads"
        busy={receiptBusy}
        onRetry={retryUpload}
        onRemove={removeReceiptRow}
      />
      {#if receiptSettled}
        <div class="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" class="min-h-11" onclick={dismissReceipt}>
            Dismiss
          </Button>
        </div>
      {/if}
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

  <PromptInput bind:value={input} isLoading={sending || researchStarting} onSubmit={(v) => sendText(v)} class="flex-col items-stretch gap-0 rounded-[20px] p-1.5">
    <!-- Obvious v3-prompt: p-1.5 box, p-2 text region, action row below. -->
    <div class="p-2">
    <PromptInputTextarea
      bind:ref={textareaEl}
      class="min-h-7"
      aria-label="Message the report assistant"
      textIndent={composerContextActive ? pillWidth : undefined}
      placeholder={pendingResearch
        ? "What should the research verify?"
        : refiningProposal
          ? "How should I revise this suggestion?"
          : pendingHighlight
            ? "Add instructions…"
            : isEmpty
              ? "What should we work on?"
              : "What should we work on?"}
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
    </div>
    <!-- Obvious anatomy: actions on a row BELOW the text — attach left, send right. -->
    <div class="flex items-center justify-between">
    <PromptInputActions>
      <ActionButton
        variant="icon"
        class="size-7 rounded-full"
        onclick={() => fileInputEl?.click()}
        disabled={uploading}
        tooltip="Add a document to project context"
        aria-label="Add a document to project context"
      >
        {#if uploading}
          <Spinner size="sm" class="border-gray-300 border-t-gray-500" />
        {:else}
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 7V12M12 12V17M12 12H7M12 12H17" />
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
              const rejected = bad.map((f) => ({
                attemptKey: createRequestId(),
                fileName: f.name,
                fileSizeBytes: f.size,
              }));
              // Each rejected file gets its own receipt row saying why, instead
              // of one message listing them all.
              receiptEntries = [
                ...receiptEntries,
                ...rejected.map((r) => ({
                  ...r,
                  status: "skipped_unsupported" as const,
                  detail: "unsupported_extension" as const,
                  hasFile: false,
                })),
              ];
              // These never reach the server, so without a recorded attempt the
              // rejection would vanish on reload with nothing to show for it.
              void recordFailedChatAttempts(rejected, "rejected_unsupported");
            }
            if (ok.length) pendingFiles = ok;
          }
          target.value = "";
        }}
      />
    </PromptInputActions>
    <PromptInputActions>
      {#if isStreaming}
        <button
          onclick={stopGeneration}
          disabled={stopping || !selectedThreadId}
          class="flex h-8 shrink-0 items-center justify-center rounded-full bg-navy px-4 text-white transition-[box-shadow,transform] hover:bg-navy-light active:translate-y-px disabled:opacity-50"
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
          disabled={sending || researchStarting || publicationPending || composerChatBlocked || (!input.trim() && !pendingHighlight && !pendingResearch)}
          class="group flex h-8 shrink-0 items-center justify-center rounded-full bg-navy px-4 text-white transition-[box-shadow,transform] hover:bg-navy-light active:translate-y-px disabled:opacity-10"
          title={pendingResearch ? "Start research" : "Send"}
          aria-label="Send message"
        >
          <svg class="h-4 w-4 transition-transform group-hover:-translate-y-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 10L12 4L18 10M12 5V20" />
          </svg>
        </button>
      {/if}
    </PromptInputActions>
    </div>
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
  <div class="flex shrink-0 items-center gap-1 border-b border-chrome py-1.5 pl-2.5 pr-12">
    <!-- Obvious thread bar: one ghost rounded-full pill IS the thread
         selector — "Assistant · thread ⌄" opens the conversation menu. -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Conversation menu"
        class="group flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm transition-colors hover:bg-chrome/60 data-[state=open]:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:min-h-11"
      >
        <span class="font-medium text-ink">Assistant</span>
        <span aria-hidden="true" class="text-ink-muted">•</span>
        <span class="text-ink-muted">{threadsQ.data?.length ?? 0}</span>
        <svg class="size-3.5 shrink-0 text-ink-faint transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
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
            class="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink outline-none hover:bg-chrome/60 focus:bg-chrome/60"
          >
            <svg class="h-4 w-4 shrink-0 text-primary-selected" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" d="M12 5v14M5 12h14" />
            </svg>
            New conversation
          </DropdownMenu.Item>
          {#each unsavedConversations as request (request.scope)}
            <DropdownMenu.Item onSelect={() => returnToRequest(request)}
              class="flex min-h-8 w-full items-center rounded-md px-2 text-sm font-medium text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash">
              <span class="min-w-0 truncate">{unsentConversationLabel(request)}</span>
            </DropdownMenu.Item>
          {/each}
          {#if (threadsQ.data?.length ?? 0) > 0}
            <div class="my-1 border-t border-line-soft"></div>
            {#each threadsQ.data ?? [] as thread (thread._id)}
              <DropdownMenu.Item
                onSelect={() => selectThread(thread.agentThreadId)}
                class={`flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-sm outline-none hover:bg-chrome/60 focus:bg-chrome/60 ${thread.agentThreadId === selectedThreadId ? "bg-chrome" : ""}`}
              >
                <span class="size-2 shrink-0 rounded-full bg-primary-selected" aria-hidden="true"></span>
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{thread.title}</span>
                <span class="shrink-0 text-xs text-ink-faint">
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
        title={isFull ? "Exit focus mode" : "Enter focus mode"}
        aria-label={isFull ? "Exit focus mode" : "Enter focus mode"}
        class="ml-auto flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink motion-reduce:transition-none"
      >
        <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10 4H4V10M20 14V20H14M4.75 4.75L10 10M14 14L19.25 19.25" />
        </svg>
      </button>
    {/if}
  </div>


  {#if isConversationEmpty}
    <!-- Empty state: brand mark, capability blurb, starter suggestions; the
         composer stays pinned to the bottom (Obvious anatomy) in EVERY state. -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-6">
      <span class="mb-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-white">
        <ChatIcon class="h-4 w-4" />
      </span>
      <h2 class="text-center text-[15px] font-medium text-ink">
        How can I help with this report?
      </h2>
      <p class="mt-1 max-w-[300px] text-center text-xs leading-relaxed text-ink-muted">
        I can tighten language, find passages, check compliance, and propose
        edits — grounded in this report and its source documents.
      </p>
      <div class="mt-5 flex w-full max-w-[320px] flex-col gap-1.5">
        {#each STARTERS as starter (starter)}
          <Suggestion
            class="w-full justify-start rounded-lg px-3 py-1.5 text-left text-[13px]"
            disabled={sending || researchStarting || publicationPending || composerChatBlocked || isStreaming}
            onclick={() => sendText(starter)}
          >
            {starter}
          </Suggestion>
        {/each}
      </div>
    </div>
  {:else}
    <ChatContainer
      bind:this={chatContainer}
      class="min-h-0 flex-1"
      viewportClass="px-5 py-4"
      contentClass="chat-scale space-y-3"
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

      {#each transcriptRows as entry (entry.key)}
        {#if entry.kind === "local"}
          {@render localMessage(entry.request)}
        {:else}
        {@const m = entry.message}
        {@const text = messageText(m)}
        {@const prev = entry.previous}
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
            <MessageContent class="min-w-0 [overflow-wrap:anywhere]">
              {@render writerContent(split)}
            </MessageContent>
          </Message>
          {#if !turnPrompts.assistantOrders.has(m.order) && timingByOrder.has(m.order)}
            <!-- Keep a durable turn without an assistant row at its prompt's
                 position, even after later prompts and replies arrive. -->
            <AssistantTurn timing={timingByOrder.get(m.order)} onRefine={refineProposal}
              regeneration={regeneration(m.order, turnPrompts.promptByOrder.get(m.order), undefined, timingByOrder.get(m.order))} />
          {/if}
        {:else if m.role === "assistant"}
          <AssistantTurn
            message={m}
            regeneration={regeneration(m.order, turnPrompts.promptByAssistantId.get(m.id), m.status, timingByOrder.get(m.order))}
            feedback={answerFeedback(m.id)}
            proposals={grouped.byMessageId.get(m.id) ?? []}
            timing={timingByOrder.get(m.order)}
            copied={copiedId === m.id}
            onCopy={copyMessage}
            onRefine={refineProposal}
            {onBeforeApply}
            {onReferenceText}
            {onReviewReplacements}
            {onPreviewProposal}
            {reviewingId}
          />
        {/if}
        {/if}
      {/each}

      <!-- Proposals we couldn't pin to a specific message -->
      {#if grouped.orphans.length > 0}
        <AssistantTurn
          proposals={grouped.orphans}
          onRefine={refineProposal}
          {onBeforeApply}
          {onReferenceText}
          {onReviewReplacements}
          {onPreviewProposal}
          {reviewingId}
        />
      {/if}

      <ResearchFeed
        {reportId}
        {onReferenceText}
        {onPreviewProposal}
        {onBeforeApply}
        onRefineProposal={refineProposal}
      />

      {#if awaitingReply && !pendingTiming}
        <Loader class="py-1" />
      {/if}

      <ScrollButton />
    </ChatContainer>

  {/if}
  <!-- Preserve the composer and keyboard focus across the first local row. -->
  <div class="shrink-0 px-2 pb-2.5 pt-2">{@render composer()}</div>
</div>

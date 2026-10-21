<script lang="ts">
  import { tick, untrack } from "svelte";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../convex/_generated/dataModel";
  import { createUIMessages } from "$lib/chat/uiMessages.svelte";
  import type { UIMessage } from "@convex-dev/agent";
  import AssistantTurn from "$lib/components/chat/AssistantTurn.svelte";
  import {
    correlateProposals,
    associateTurnPrompts,
    canRegenerateTurn,
    continueLabel,
    continueMessage,
    contextBoundaryOrder,
    normalizeTurnParts,
    type TurnTiming,
  } from "$lib/chat/turnParts";
  import { turnPhaseFields } from "$lib/chat/turnContracts";
  import { webSearchesByOrder } from "$lib/chat/webSources";
  import { chatSendErrorMessage, chatStopErrorMessage } from "$lib/chat/chatRefusals";
  import { NEW_CONVERSATION, clearDraft, draftKey, readDraft, readLastThread, writeDraft, writeLastThread } from "$lib/chat/chatDrafts";
  import { OFFLINE_MESSAGE, useChatConnection } from "$lib/chat/connectionState.svelte";
  import { CHAT_MAX_PINNED_FILES, MAX_CHAT_HIGHLIGHT_CHARS, MAX_CHAT_MESSAGE_CHARS } from "../../../../shared/chatLimits";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import AssistantPanelSkeleton from "./AssistantPanelSkeleton.svelte";
  import StopReplyDialog from "./StopReplyDialog.svelte";
  // Phase C (W2): Edit, Regenerate as an alternative, and the switcher.
  import MessageEditor from "./MessageEditor.svelte";
  import WriterMessageFooter from "./WriterMessageFooter.svelte";
  import { alternativeAuthorLine, alternativeSwitchErrorMessage, canEditTurn } from "$lib/chat/alternatives";
  import DeleteConversationDialog from "./DeleteConversationDialog.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import { copyRenderedAnswer } from "$lib/chat/richCopy";
  import type { ChatFeedbackReasonCode } from "../../../../shared/chatFeedback";
  import { VET_NOTE_MAX_CHARS } from "../../../../shared/researchPresets";
  import { notificationsSupported, notifyRepliesEnabled, setNotifyReplies } from "$lib/chat/replySignal.svelte";
  import ResearchFeed from "$lib/components/research/ResearchFeed.svelte";
  import type { ResearchSelection } from "$lib/components/editor/types";
  import { DropdownMenu, Checkbox, Popover } from "bits-ui";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
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
  import { createRequestId } from "$lib/requestId";
  import { userErrorMessage } from "$lib/errors";

  // Agent-based chat rail (BNH-10 P2) — streaming replacement for ChatPanel.
  // Messages come from the @convex-dev/agent component (token-streamed into
  // createUIMessages, our Svelte port of useUIMessages); edit/highlight cards
  // come from the reactive chatProposals table. Rendering is composed from
  // the chat primitives in $lib/components/chat/primitives.

  type Proposal = Doc<"chatProposals">;

  interface Props {
    /** Phase C (2026-10-20): the project whose files the writer can pin to a
     * message ("Read a file in full"). Nothing is uploaded from the chat. */
    projectId: Id<"projects">;
    reportId: Id<"reports">;
    pendingHighlight?: { from: number; to: number; text: string } | null;
    onClearHighlight?: () => void;
    pendingResearch?: ResearchSelection | null;
    onClearResearch?: () => void;
    isFull?: boolean;
    onToggleFull?: () => void;
    /** Keep header room for a host's overlaid close button (default true). */
    closeInset?: boolean;
    /** Height of the pinned composer area, for hosts that float notices above it. */
    composerHeight?: number;
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
    closeInset = true,
    composerHeight = $bindable(0),
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

  /**
   * SR&ED-relevant conversation starters for the empty state. Phase C (W3):
   * a starter fills the empty composer and focuses it; the writer sends it.
   */
  const STARTERS = [
    "Tighten the uncertainty framing in Line 242",
    "Find every mention of the prototype",
    "Check this report for banned words",
    "Make Line 244 (work performed) more chronological",
  ];

  function useStarter(starter: string) {
    if (input.trim()) return;
    input = starter;
    void tick().then(() => {
      textareaEl?.focus();
      textareaEl?.setSelectionRange(starter.length, starter.length);
    });
  }

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

  // Reopen the conversation last used on this report in this tab (Phase A,
  // task 9), else the newest, unless the writer just started a new chat.
  $effect(() => {
    const threads = threadsQ.data;
    if (
      selectedThreadId === null &&
      !startingNewChat &&
      threads &&
      threads.length > 0
    ) {
      const last = untrack(() => readLastThread(reportId));
      // The writer was last in an unsaved new conversation: reopen it, with
      // its draft (review P2).
      if (last === NEW_CONVERSATION) {
        startingNewChat = true;
        return;
      }
      carryDraftOnScopeChange = true;
      selectedThreadId = threads.find((thread) => thread.agentThreadId === last)?.agentThreadId ??
        threads[0].agentThreadId;
    }
  });
  $effect(() => {
    const report = untrack(() => reportId);
    if (selectedThreadId) writeLastThread(report, selectedThreadId);
    else if (startingNewChat) writeLastThread(report, NEW_CONVERSATION);
  });

  function startNewThread() {
    startingNewChat = true;
    draftWebSearch = true;
    draftConversationId = createRequestId();
    selectedThreadId = null;
    refiningProposal = null;
    onClearHighlight?.();
    onClearResearch?.();
    textareaEl?.focus();
  }

  function selectThread(threadId: string) {
    if (threadId === selectedThreadId && !startingNewChat) return;
    startingNewChat = false;
    selectedThreadId = threadId;
    refiningProposal = null;
  }

  // Phase C (W3): rename, archive and restore for anyone on the report, and
  // an admin's permanent delete. Archived conversations leave the menu for
  // their own list and stay readable; a send in one restores it.
  type ThreadSummary = { agentThreadId: string; title: string };
  const archivedThreadsQ = useQuery(api.chatV2.listArchivedThreads, () => ({ reportId }));
  const archivedThreads = $derived(archivedThreadsQ.data ?? []);
  const selectedArchivedThread = $derived(
    selectedThreadId ? archivedThreads.find((thread) => thread.agentThreadId === selectedThreadId) : undefined
  );
  const renameThreadMutation = useMutation(api.chatV2.renameThread);
  const archiveThreadMutation = useMutation(api.chatV2.archiveThread);
  const restoreThreadMutation = useMutation(api.chatV2.restoreThread);
  const deleteThreadMutation = useMutation(api.chatV2.deleteThread);
  let conversationError = $state<string | null>(null);
  let renaming = $state<{ threadId: string; title: string } | null>(null);
  let renameDraft = $state("");
  let renameSaving = $state(false);
  let renameField: HTMLDivElement | null = $state(null);
  // Moving to another conversation closes an open rename row.
  $effect(() => { conversationScope; renaming = null; renameDraft = ""; });
  let deleteTarget = $state<ThreadSummary | null>(null);
  let deleteOpen = $state(false);
  // Set by a menu action that places focus itself (Rename): the menu must
  // not hand focus back to its trigger.
  let conversationMenuFocus: (() => void) | null = null;
  // Review R2 P3-3: rename and delete hand focus back to the menu button.
  let conversationMenuButton: HTMLButtonElement | null = $state(null);
  function focusConversationMenu() {
    void tick().then(() => conversationMenuButton?.focus());
  }

  // Review R2 P3-2, round 2 N2: a conversation someone else deleted. The
  // menu lists are bounded (50 rows), so a conversation missing from both
  // may simply have dropped out of them; only its own status, read by id,
  // says it is gone. Read only while the selection is in neither list.
  const selectedUnlisted = $derived.by(() => {
    const open = threadsQ.data;
    const archived = archivedThreadsQ.data;
    const selected = selectedThreadId;
    if (!selected || !open || !archived) return null;
    return open.some((thread) => thread.agentThreadId === selected) ||
      archived.some((thread) => thread.agentThreadId === selected)
      ? null
      : selected;
  });
  const selectedStatusQ = useQuery(api.chatV2.threadStatus, () =>
    selectedUnlisted ? { threadId: selectedUnlisted } : "skip"
  );
  $effect(() => {
    const status = selectedStatusQ.data;
    const selected = selectedUnlisted;
    // A status still read for the previous selection says nothing.
    if (!selected || selectedStatusQ.isStale || (status !== "deleting" && status !== "missing")) return;
    untrack(() => leaveConversation(selected));
  });

  /** Leave a conversation that left the menu: the next open one, or a new one. */
  function leaveConversation(threadId: string) {
    if (selectedThreadId !== threadId) return;
    const next = threadsQ.data?.find((thread) => thread.agentThreadId !== threadId);
    if (next) selectThread(next.agentThreadId);
    else startNewThread();
  }

  function beginRename(thread: ThreadSummary) {
    conversationError = null;
    renaming = { threadId: thread.agentThreadId, title: thread.title };
    renameDraft = thread.title;
    conversationMenuFocus = focusRenameField;
  }

  /**
   * The rename row renders as the conversation menu (and its "Conversation
   * actions" submenu) closes, and a menu can hand focus back to its trigger a
   * moment later. For a few frames, put focus on the field whenever it is on
   * the menu button or nowhere; focus the writer moved elsewhere is left
   * alone. Escape and typing then always reach the field.
   */
  function focusRenameField() {
    let frames = 0;
    let selected = false;
    const attempt = () => {
      const field = renameField?.querySelector("input");
      const active = document.activeElement;
      if (field && renaming && active !== field && (!active || active === document.body || active === conversationMenuButton || !selected)) {
        field.focus();
        if (!selected) field.select();
        selected = true;
      }
      if (renaming && ++frames < 10) requestAnimationFrame(attempt);
    };
    attempt();
  }

  /** Escape anywhere in the rename row (field, Save or Cancel) cancels it. */
  function renameKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelRename();
  }

  function cancelRename() {
    renaming = null;
    renameDraft = "";
    focusConversationMenu();
  }

  async function saveRename() {
    if (!renaming || renameSaving) return;
    const title = renameDraft.replace(/\s+/g, " ").trim();
    if (!title || title === renaming.title) {
      cancelRename();
      return;
    }
    renameSaving = true;
    conversationError = null;
    try {
      await renameThreadMutation({ threadId: renaming.threadId, title });
      cancelRename();
    } catch (e) {
      conversationError = userErrorMessage(e, "The conversation could not be renamed. Try again.");
    } finally {
      renameSaving = false;
    }
  }

  async function archiveConversation(thread: ThreadSummary) {
    conversationError = null;
    try {
      await archiveThreadMutation({ threadId: thread.agentThreadId });
      leaveConversation(thread.agentThreadId);
    } catch (e) {
      conversationError = userErrorMessage(e, "The conversation could not be archived. Try again.");
    }
  }

  async function restoreConversation(thread: ThreadSummary) {
    conversationError = null;
    try {
      await restoreThreadMutation({ threadId: thread.agentThreadId });
    } catch (e) {
      conversationError = userErrorMessage(e, "The conversation could not be restored. Try again.");
    }
  }

  function askDelete(thread: ThreadSummary) {
    conversationError = null;
    deleteTarget = thread;
    deleteOpen = true;
  }

  async function confirmDelete() {
    const thread = deleteTarget;
    deleteTarget = null;
    if (!thread) return;
    focusConversationMenu();
    try {
      await deleteThreadMutation({ threadId: thread.agentThreadId });
      leaveConversation(thread.agentThreadId);
    } catch (e) {
      conversationError = userErrorMessage(e, "The conversation could not be deleted. Try again.");
    }
  }

  const ui = createUIMessages(
    api.chatV2.listMessages,
    () => (selectedThreadId ? { threadId: selectedThreadId } : "skip"),
    { initialNumItems: 80 }
  );
  const messages = $derived(ui.results);

  // Phase C (W2): the server leaves other alternatives' rows out of each
  // page, so a page can come back short. Load more, a few pages at most,
  // until enough of the conversation shows or its start is reached.
  const SHORT_PAGE_MESSAGES = 10;
  const MAX_SHORT_PAGE_LOADS = 5;
  let shortPageLoads = $state(0);
  $effect(() => { void selectedThreadId; shortPageLoads = 0; });
  $effect(() => {
    if (ui.status !== "CanLoadMore" || ui.results.length >= SHORT_PAGE_MESSAGES) return;
    untrack(() => {
      if (shortPageLoads >= MAX_SHORT_PAGE_LOADS) return;
      shortPageLoads += 1;
      ui.loadMore(80);
    });
  });

  const proposalsQ = useQuery(api.chatV2.listProposals, () =>
    selectedThreadId ? { threadId: selectedThreadId } : "skip"
  );

  const researchSessionsQ = useQuery(api.research.listSessions, () => ({ reportId }));
  const hasResearch = $derived((researchSessionsQ.data?.length ?? 0) > 0);

  // 2026-10-06: until the conversation list is here, a send cannot know
  // whether it continues the newest conversation or starts one, and an empty
  // transcript cannot be told from one still loading. So the welcome and
  // its starters wait, and Send waits, for the first data; until then the
  // message area shows the loading skeleton. A failed read of the list or
  // of the conversation counts as here, so an error never leaves the
  // skeleton up (a failed conversation read shows its own notice).
  const threadsLoading = $derived(threadsQ.data === undefined && !threadsQ.error);
  // The list failed before any data (review P1): whether a conversation
  // exists is unknown, so Send waits and the panel says so, unless the
  // writer chose New conversation from the menu or a conversation is
  // already selected (the one that choice just created, say).
  const threadsUnreadable = $derived(
    threadsQ.data === undefined && !!threadsQ.error && !startingNewChat && selectedThreadId === null
  );
  // The selected conversation failed to load: a send would land in a
  // conversation the writer cannot see, so Send waits for another choice.
  const conversationUnreadable = $derived(!!selectedThreadId && !!ui.error && ui.results.length === 0);
  const transcriptReady = $derived(
    !threadsLoading &&
      // The newest conversation is about to be selected (an effect does it).
      !(selectedThreadId === null && !startingNewChat && (threadsQ.data?.length ?? 0) > 0) &&
      (!selectedThreadId || ui.status !== "LoadingFirstPage" || !!ui.error) &&
      // Phase C (W2): a page with only other alternatives' rows is not an
      // empty conversation; more is loading (below).
      (!selectedThreadId || ui.results.length > 0 || !!ui.error || shortPageLoads >= MAX_SHORT_PAGE_LOADS ||
        (ui.status !== "CanLoadMore" && ui.status !== "LoadingMore")) &&
      // Research only decides between the welcome and a research-only feed.
      (ui.results.length > 0 || researchSessionsQ.data !== undefined || !!researchSessionsQ.error)
  );

  const sendMessage = useMutation(api.chatV2.sendMessage);
  const sendAlternative = useMutation(api.chatV2.sendAlternative);
  const setActiveAlternative = useMutation(api.chatV2.setActiveAlternative);
  const abortStreaming = useMutation(api.chatV2.abortStreaming);
  const startResearch = useMutation(api.research.startResearch);

  // Answer feedback is offered only to a signed-in, non-anonymous user with a
  // role, and each saved vote is keyed by that user.
  const auth = useAuth();
  const currentUserQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );


  let input = $state("");

  // Phase A (task 9): each conversation keeps its unsent draft in this tab's
  // sessionStorage. A writer's switch restores the draft of the conversation
  // they chose; the panel's own switches (opening the remembered conversation,
  // a new conversation getting its thread on first send) carry the text along.
  // An unsaved new conversation has one stable key per report ("new"), so its
  // draft survives a reload (review P2). While the conversation list is still
  // deciding which conversation opens, there is no key: text typed meanwhile
  // goes to the conversation that opens, unless that one has its own draft.
  const draftScope = $derived(
    selectedThreadId
      ? `thread:${selectedThreadId}`
      : startingNewChat || !!threadsQ.error || threadsQ.data?.length === 0
        ? NEW_CONVERSATION
        : null
  );
  const draftStorageKey = $derived(draftScope ? draftKey(reportId, draftScope) : null);
  let loadedDraftKey: string | null = null;
  let carryDraftOnScopeChange = false;
  $effect(() => {
    const key = draftStorageKey;
    const value = input;
    if (key === null) return;
    if (key === loadedDraftKey) {
      writeDraft(key, value);
      return;
    }
    const previous = loadedDraftKey;
    loadedDraftKey = key;
    const saved = readDraft(key);
    if ((carryDraftOnScopeChange || previous === null) && !saved) {
      carryDraftOnScopeChange = false;
      if (previous) clearDraft(previous);
      writeDraft(key, value);
      return;
    }
    carryDraftOnScopeChange = false;
    input = saved;
  });

  // Phase A (task 11): the server's limits, mirrored before a send. The
  // composer sends trimmed text, so the trimmed length is what counts.
  const composedLength = $derived(input.trim().length);
  const messageTooLong = $derived(composedLength > MAX_CHAT_MESSAGE_CHARS);
  const highlightTooLong = $derived((pendingHighlight?.text.length ?? 0) > MAX_CHAT_HIGHLIGHT_CHARS);
  const showCounter = $derived(composedLength >= MAX_CHAT_MESSAGE_CHARS * 0.8);
  // Phase C (W3, review R2 P3-7): a Vet note has its own, shorter limit.
  const vetNoteActive = $derived(pendingResearch?.preset === "vet");
  const vetNoteTooLong = $derived(vetNoteActive && composedLength > VET_NOTE_MAX_CHARS);
  const showVetCounter = $derived(vetNoteActive && composedLength >= VET_NOTE_MAX_CHARS * 0.8);

  // Phase A (task 10): Convex connection state.
  const connection = useChatConnection();
  let allowBrain = $state(false);
  $effect(() => { conversationScope; allowBrain = false; });
  // Phase C (W1): project files pinned to the next message, read in full
  // with it. Picked from the project's files (never uploaded here), cleared
  // after a send like a per-message option. The file list is subscribed
  // once Message options has been opened.
  type PinnedFile = { id: Id<"projectDocuments">; name: string };
  let pinnedFiles = $state<PinnedFile[]>([]);
  let filePickerWanted = $state(false);
  let filePickerOpen = $state(false);
  let openFilePickerOnClose = false;
  let messageOptionsButton = $state<HTMLElement | null>(null);
  $effect(() => { conversationScope; pinnedFiles = []; filePickerOpen = false; });
  const projectFilesQ = useQuery(api.documents.listDocuments, () => (filePickerWanted ? { projectId } : "skip"));
  const pinnableFiles = $derived((projectFilesQ.data ?? []).filter((file) => !file.archived));
  // A pinned file archived or removed meanwhile is dropped before a send.
  $effect(() => {
    const files = projectFilesQ.data;
    if (!files) return;
    const live = new Set(files.filter((file) => !file.archived).map((file) => file._id));
    if (untrack(() => pinnedFiles).some((file) => !live.has(file.id))) {
      pinnedFiles = untrack(() => pinnedFiles).filter((file) => live.has(file.id));
    }
  });
  function setPinned(file: { _id: Id<"projectDocuments">; fileName: string }, on: boolean) {
    if (!on) {
      pinnedFiles = pinnedFiles.filter((pinned) => pinned.id !== file._id);
    } else if (!pinnedFiles.some((pinned) => pinned.id === file._id) && pinnedFiles.length < CHAT_MAX_PINNED_FILES) {
      pinnedFiles = [...pinnedFiles, { id: file._id, name: file.fileName }];
    }
  }
  // Phase B (W3): web search (terms and CRA only) is a setting of the
  // conversation, on unless turned off, and stays as set across sends. An
  // unsaved new conversation keeps it here until its first send writes it.
  // A switch on a saved conversation shows at once and is cleared when the
  // conversation list carries the new value.
  const setThreadWebSearch = useMutation(api.chatV2.setThreadWebSearch);
  let draftWebSearch = $state(true);
  const webSearchPending = new SvelteMap<string, boolean>();
  let webSearchError = $state<string | null>(null);
  const selectedThreadWebSearch = $derived(
    (threadsQ.data?.find((thread) => thread.agentThreadId === selectedThreadId) ?? selectedArchivedThread)?.webSearch
  );
  // Review R2 P3-6: null while a saved conversation's setting is unknown (the
  // list is loading, or no longer holds it): no chip, and the switch waits.
  const webSearchSetting = $derived<boolean | null>(
    selectedThreadId
      ? (webSearchPending.get(selectedThreadId) ?? selectedThreadWebSearch ?? null)
      : draftWebSearch
  );
  const webSearchOn = $derived(webSearchSetting === true);
  $effect(() => {
    for (const thread of threadsQ.data ?? []) {
      if (untrack(() => webSearchPending.get(thread.agentThreadId)) === thread.webSearch) {
        webSearchPending.delete(thread.agentThreadId);
      }
    }
  });
  $effect(() => { conversationScope; webSearchError = null; });
  async function setWebSearch(on: boolean) {
    webSearchError = null;
    const threadId = selectedThreadId;
    if (!threadId) {
      draftWebSearch = on;
      return;
    }
    webSearchPending.set(threadId, on);
    try {
      await setThreadWebSearch({ threadId, enabled: on });
    } catch (e) {
      webSearchPending.delete(threadId);
      webSearchError = userErrorMessage(e, "Web search could not be changed. Try again.");
    }
  }
  let sending = $state(false);
  let researchStarting = $state(false);
  let researchError = $state<string | null>(null);
  // "continue" is the Continue offer's message (Phase A, task 7): sent into
  // the thread like a regenerate, without consuming the composer.
  type SendIntent = { kind: "composer" } | { kind: "regenerate" | "continue" | "edit"; threadId: string };
  // Phase C (W2): Edit and Regenerate make an alternative of a turn; the
  // server rebuilds its prompt.
  type AlternativeSend = { kind: "edit" | "regenerate"; ofPromptMessageId: string; content?: string };
  type LocalSend = {
    key: string;
    scope: string;
    intent: SendIntent;
    args: Parameters<typeof sendMessage>[0];
    alternative?: AlternativeSend;
    display: { content: string; highlight?: string; pinned?: string[] };
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
    request.intent.kind !== "composer" && request.scope !== conversationScope && request.state.kind === "failed"));
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
  // Phase A (task 1): a refused or failed Stop says so here, never through
  // console.error, which raises the crash toast.
  let stopError = $state<string | null>(null);

  // Copy-to-clipboard feedback (assistant hover actions).
  let copiedId = $state<string | null>(null);
  let copyFailedId = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  /** Load a suggestion into the composer for a refinement turn. */
  function refineProposal(proposal: Proposal) {
    refiningProposal = proposal;
    input = "";
    textareaEl?.focus();
    chatContainer?.scrollToBottom("smooth");
  }

  async function copyMessage(id: string, text: string, answer: HTMLElement | null = null) {
    clearTimeout(copyTimer);
    try {
      // Phase C (W3): the answer as shown (HTML and plain text, citations
      // as "[n]"), else its text.
      await copyRenderedAnswer(answer, text);
      copiedId = id;
      copyFailedId = null;
      copyTimer = setTimeout(() => (copiedId = null), 1600);
    } catch {
      // A blocked clipboard is the browser's answer, not a crash: the copy
      // button says it did not work, and no crash toast is raised.
      copiedId = null;
      copyFailedId = id;
      copyTimer = setTimeout(() => (copyFailedId = null), 2400);
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
        // Phase A: progress, continuation and historyStartOrder.
        ...turnPhaseFields(turn),
      });
    }
    return map;
  });

  // Phase B (W3): each reply's web searches (query as sent, numbered
  // sources), joined to the reply through its turn's prompt.
  const webSourcesQ = useQuery(api.chatV2.listTurnWebSources, () =>
    selectedThreadId ? { threadId: selectedThreadId } : "skip"
  );
  const webSearchesByTurn = $derived(webSearchesByOrder(webSourcesQ.data ?? [], turnsQ.data ?? []));

  const turnPrompts = $derived(associateTurnPrompts(messages));
  // The last assistant row of each turn carries the turn's Continue offer.
  const finalAssistantIds = $derived.by(() => {
    const last = new Map<number, string>();
    for (const message of messages) if (message.role === "assistant") last.set(message.order, message.id);
    return new Set(last.values());
  });
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
    // A recovery jump to an unsent message, not a menu choice: the text being
    // typed comes along unless that conversation has a draft of its own.
    if (request.scope !== conversationScope) carryDraftOnScopeChange = true;
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
    // Phase C (W2): a durable turn's Regenerate makes an alternative, which
    // the server rebuilds; a stopped turn may be regenerated once it stopped.
    // A row saved before turns were recorded resends its stored prompt.
    const turn = turnByOrder.get(order);
    const excerpt = text.replace(/\s+/g, " ").trim();
    return {
      disabled: regenerationBusy,
      description: `Regenerate response to: ${excerpt.length > 160 ? `${excerpt.slice(0, 159)}…` : excerpt}`,
      onRegenerate: () => sendText(text, { kind: "regenerate", threadId },
        turn?.promptMessageId ? { kind: "regenerate", ofPromptMessageId: turn.promptMessageId } : undefined),
    };
  }

  // Phase A (task 7): the newest ended turn's structured Continue offer. A
  // reply cut off ends "failed" with continuation { reason: "cut_off" }, so
  // any ended turn but a stopped one may carry it (review P1). The offer
  // hides while its message is on the way (the local send row), comes back
  // if that send fails and is dismissed, and goes once the next message is
  // saved; AssistantTurn guards a double click.
  function continueOffer(order: number, timing: TurnTiming | undefined) {
    const threadId = selectedThreadId;
    if (!threadId || order !== endOrder || !timing) return undefined;
    if (timing.status !== "completed" && timing.status !== "failed") return undefined;
    const label = continueLabel(timing.continuation);
    const text = continueMessage(timing.continuation);
    if (!label || !text || visibleLocalSends.length > 0) return undefined;
    // Phase B: why the job did not carry on by itself, when it says.
    const skipped = turnByOrder.get(order)?.autoContinueSkipped;
    const skipNote = skipped === "budget" || skipped === "no_progress" ? SKIP_NOTES[skipped] : undefined;
    return {
      label,
      disabled: regenerationBusy,
      onContinue: () => sendText(text, { kind: "continue", threadId }),
      ...(skipNote ? { skipNote } : {}),
    };
  }

  // Phase B (2026-10-20), W2: each turn by its order, for author labels,
  // automatic links and the Stop check.
  type ListedTurn = NonNullable<typeof turnsQ.data>[number];
  const turnByOrder = $derived.by(() => {
    const map = new Map<number, ListedTurn>();
    for (const turn of turnsQ.data ?? []) map.set(turn.order, turn);
    return map;
  });
  // Author labels show only when the conversation has messages from more
  // than one person. A link speaks for whoever started the job.
  const multipleAuthors = $derived.by(() => {
    const authors = new Set<string>();
    for (const turn of turnsQ.data ?? []) {
      if (turn.origin === "auto_continue") continue;
      authors.add(turn.userId ?? (turn.fromCurrentUser ? "you" : `name:${turn.senderName ?? ""}`));
    }
    return authors.size > 1;
  });
  function authorLabel(order: number): string | null {
    if (!multipleAuthors) return null;
    const turn = turnByOrder.get(order);
    if (!turn) return null;
    return turn.fromCurrentUser ? "You" : (turn.senderName ?? null);
  }
  /** The muted chip a server-started link shows instead of a writer message. */
  function autoContinueChip(order: number, text: string): string | null {
    if (turnByOrder.get(order)?.origin !== "auto_continue") return null;
    const line = /^Continue with Line (242|244|246)\.$/.exec(text.trim())?.[1];
    return line ? `Continuing with Line ${line}` : "Continuing";
  }
  // Phase C (W2): Edit on a finished writer message on the path (never an
  // automatic link), the switcher between alternatives, and who made one.
  let editingOrder = $state<number | null>(null);
  let switchError = $state<{ order: number; message: string } | null>(null);
  $effect(() => { conversationScope; editingOrder = null; switchError = null; });
  function editOffer(order: number) {
    if (!selectedThreadId || !canEditTurn(turnByOrder.get(order))) return undefined;
    return { disabled: regenerationBusy || editingOrder !== null, onEdit: () => { editingOrder = order; } };
  }
  async function sendEdit(order: number, text: string) {
    const turn = turnByOrder.get(order);
    const threadId = selectedThreadId;
    editingOrder = null;
    // Review R2 P3-3: focus goes where a normal send leaves it, the composer.
    textareaEl?.focus();
    if (!turn || !threadId) return;
    await sendText(text, { kind: "edit", threadId },
      { kind: "edit", ofPromptMessageId: turn.promptMessageId, content: text });
  }
  /** Review R2 P3-3: Cancel hands focus back to the message's Edit button. */
  async function cancelEdit(order: number) {
    editingOrder = null;
    await tick();
    document.querySelector<HTMLButtonElement>(`[data-writer-order="${order}"] [data-edit-message]`)?.focus();
  }
  async function switchAlternative(order: number, promptMessageId: string) {
    const threadId = selectedThreadId;
    if (!threadId) return;
    switchError = null;
    try {
      await setActiveAlternative({ threadId, promptMessageId });
    } catch (e) {
      switchError = { order, message: alternativeSwitchErrorMessage(e) };
    }
  }
  function writerFooter(order: number) {
    const turn = turnByOrder.get(order);
    return {
      edit: editOffer(order),
      alternatives: turn?.alternatives,
      authorLine: turn ? alternativeAuthorLine(turn.alternativeKind, turn.alternativeAuthorName, turn.fromCurrentUser) : null,
      error: switchError?.order === order ? switchError.message : null,
    };
  }

  const SKIP_NOTES = {
    budget: "Stopped continuing automatically: this project's daily chat budget is used up.",
    no_progress: "Stopped continuing automatically because the last reply made no progress.",
  } as const;

  // Phase A (task 8): where the model stopped reading older messages.
  const contextBoundary = $derived(contextBoundaryOrder(
    (turnsQ.data ?? []).map((turn) => ({ order: turn.order, ...turnPhaseFields(turn) })),
    messages.map((message) => message.order),
    ui.status === "CanLoadMore" || ui.status === "LoadingMore",
  ));
  const CONTEXT_NOTICE_KEY = "banhall.chat.contextNoticeSeen.";
  let contextNoticeDismissed = $state<string | null>(null);
  const showContextNotice = $derived.by(() => {
    if (contextBoundary === null || !selectedThreadId || contextNoticeDismissed === selectedThreadId) return false;
    try {
      return localStorage.getItem(`${CONTEXT_NOTICE_KEY}${selectedThreadId}`) !== "1";
    } catch {
      return true;
    }
  });
  function dismissContextNotice() {
    const threadId = selectedThreadId;
    if (!threadId) return;
    contextNoticeDismissed = threadId;
    try {
      localStorage.setItem(`${CONTEXT_NOTICE_KEY}${threadId}`, "1");
    } catch {
      /* ignore */
    }
  }

  // Phase A (task 6): announce a finished reply once. Only turns seen running
  // in this session count, so opening an old conversation announces nothing.
  const liveTurnIds = new Set<string>();
  let replyAnnouncement = $state("");
  $effect(() => {
    for (const turn of turnsQ.data ?? []) {
      if (turn.status === "queued" || turn.status === "running") {
        liveTurnIds.add(turn._id);
      } else if (liveTurnIds.delete(turn._id) && turn.status === "completed") {
        replyAnnouncement = "";
        void tick().then(() => (replyAnnouncement = "The assistant's reply is ready."));
      }
    }
  });

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
  const eligibleFeedbackViewer = $derived(auth.isAuthenticated &&
    !!currentUserQ.data?.role && currentUserQ.data.isAnonymous !== true);
  const feedbackQ = useQuery(api.chatFeedback.getViewerVotes, () =>
    eligibleFeedbackViewer && selectedThreadId && feedbackTurnIds.length
      ? { reportId, threadId: selectedThreadId, turnIds: feedbackTurnIds }
      : "skip"
  );
  const submitAnswerFeedback = useMutation(api.chatFeedback.submitFeedback);
  type SavedFeedback = { vote: 1 | -1; reasonCode?: ChatFeedbackReasonCode; reasonText?: string };
  const savedVotes = new SvelteMap<string, SavedFeedback>();
  const feedbackBusy = new SvelteSet<string>();
  const feedbackErrors = new SvelteMap<string, string>();
  function feedbackKey(turnId: Id<"chatTurns">) {
    return `${currentUserQ.data?._id ?? ""}:${turnId}`;
  }
  function currentFeedback(turnId: Id<"chatTurns">): SavedFeedback | undefined {
    return savedVotes.get(feedbackKey(turnId)) ?? feedbackQ.data?.find((row) => row.turnId === turnId);
  }
  // Phase C (W3): a vote can be changed, and a thumbs down can carry a
  // reason. The same thumbs down again keeps its reason.
  async function rateAnswer(turnId: Id<"chatTurns">, vote: 1 | -1, reason?: { code: ChatFeedbackReasonCode; text: string }) {
    const key = feedbackKey(turnId);
    if (feedbackBusy.has(key) || feedbackQ.isLoading || feedbackQ.error || !eligibleFeedbackViewer) return;
    const previous = currentFeedback(turnId);
    if (previous?.vote === vote && !reason) return;
    feedbackBusy.add(key);
    feedbackErrors.delete(key);
    try {
      const recordedVote = await submitAnswerFeedback({
        turnId,
        vote,
        ...(reason ? { reasonCode: reason.code, ...(reason.text ? { reasonText: reason.text } : {}) } : {}),
      });
      const kept = recordedVote === -1
        ? (reason ? { reasonCode: reason.code, ...(reason.text ? { reasonText: reason.text } : {}) }
          : previous?.vote === -1 ? { reasonCode: previous.reasonCode, reasonText: previous.reasonText } : {})
        : {};
      savedVotes.set(key, { vote: recordedVote, ...kept });
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
    const current = currentFeedback(turnId);
    return {
      value: current?.vote ?? null,
      reasonCode: current?.reasonCode ?? null,
      reasonText: current?.reasonText ?? null,
      disabled: feedbackQ.isLoading || !!feedbackQ.error || !currentUserQ.data || feedbackBusy.has(key),
      error: feedbackQ.error ? "Feedback is unavailable. Please refresh this page to try again." : feedbackErrors.get(key),
      onVote: (vote: 1 | -1) => rateAnswer(turnId, vote),
      onReason: (code: ChatFeedbackReasonCode, text: string) => rateAnswer(turnId, -1, { code, text }),
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

  async function sendText(text: string, intent: SendIntent = { kind: "composer" }, alternative?: AlternativeSend) {
    const historical = intent.kind !== "composer";
    const trimmed = historical ? text : text.trim();
    if (
      (historical ? !trimmed.trim() : (!trimmed && !pendingHighlight && !pendingResearch)) ||
      (intent.kind !== "composer" && (intent.threadId !== selectedThreadId || regenerationBusy)) ||
      (!historical && !pendingResearch && (messageTooLong || highlightTooLong)) ||
      (!historical && vetNoteTooLong) ||
      sending ||
      researchStarting ||
      publicationPending ||
      (!historical && composerChatBlocked) ||
      (!historical && (threadsLoading || threadsUnreadable || conversationUnreadable)) ||
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
          // Phase C (W3): the server builds Vet's instruction; the text is
          // only the writer's optional note.
          ...(pendingResearch.preset ? { preset: pendingResearch.preset } : {}),
        });
        pendingResearchId = sessionId;
        input = "";
        onClearResearch?.();
        dismissHint();
        chatContainer?.scrollToBottom("instant");
      } catch (e) {
        // The server's own words (the hourly research limit, say), never
        // the client's raw "[CONVEX M(...)]" line.
        researchError = userErrorMessage(e, "Research could not be started.");
      } finally {
        researchStarting = false;
      }
      return;
    }

    const args: Parameters<typeof sendMessage>[0] = {
      reportId,
      content: trimmed,
      ...(!historical && allowBrain ? { allowBrain: true } : {}),
      // Phase C (W1): the files pinned to this message. Regenerate and
      // Continue carry none.
      ...(!historical && pinnedFiles.length ? { pinnedDocumentIds: pinnedFiles.map((file) => file.id) } : {}),
      // Phase B: a saved conversation's web setting is already stored (the
      // switch saves it, and this client's mutations run in order), so a send
      // names it only to seed a new conversation that starts with it off.
      // Regenerate and Continue never do; they use the stored setting.
      ...(!historical && !selectedThreadId && !webSearchOn ? { allowWeb: false } : {}),
      ...(intent.kind !== "composer" ? { threadId: intent.threadId } : {
        ...(selectedThreadId ? { threadId: selectedThreadId } : {}),
        ...(pendingHighlight ? { highlight: { ...pendingHighlight } } : {}),
        ...(refiningProposal ? { refineProposalId: refiningProposal._id } : {}),
        ...(!selectedThreadId ? { newThread: true } : {}),
      }),
    };
    const request: LocalSend = {
      key: createRequestId(), scope: conversationScope, intent, args,
      ...(alternative ? { alternative } : {}),
      display: alternative?.kind === "edit" ? { content: trimmed } : historical ? splitWriterMessage(visibleWriterMessage(trimmed)) : {
        content: trimmed, ...(args.highlight ? { highlight: args.highlight.text } : {}),
        ...(args.pinnedDocumentIds ? { pinned: pinnedFiles.map((file) => file.name) } : {}),
      },
      startOrder: Math.max(0, endOrder), afterOrder: endOrder,
      conversationNumber: nextConversationNumber++, retried: false, state: { kind: "sending" },
    };
    localSends = [...localSends, request];
    // Consume only the captured composer, synchronously. Later edits/context
    // are never cleared by mutation completion or retry.
    if (!historical) {
      if (!selectedThreadId) startingNewChat = true;
      if (draftStorageKey) clearDraft(draftStorageKey);
      input = "";
      refiningProposal = null;
      allowBrain = false;
      pinnedFiles = [];
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
      (request.intent.kind !== "composer" && regenerationBusy)) return;
    void transmitRequest(request, button);
  }

  async function transmitRequest(request: LocalSend, retryButton?: HTMLButtonElement) {
    sending = true;
    localSends = localSends.map(candidate => candidate.key === request.key
      ? { ...candidate, retried: candidate.retried || !!retryButton, state: { kind: "sending" } } : candidate);
    try {
      const alternative = request.alternative;
      const res = alternative && request.intent.kind !== "composer"
        ? await sendAlternative({
          threadId: request.intent.threadId,
          ofPromptMessageId: alternative.ofPromptMessageId,
          kind: alternative.kind,
          ...(alternative.content !== undefined ? { content: alternative.content } : {}),
        })
        : await sendMessage(request.args);
      if (res.messageId) pendingSendByThread.set(res.threadId, { messageId: res.messageId, startOrder: request.startOrder });
      const isOriginVisible = conversationScope === request.scope;
      // Keep Retry mounted during transmission. On success hand keyboard focus
      // to the composer only if the writer is still on this originating button.
      if (isOriginVisible && retryButton && document.activeElement === retryButton) textareaEl?.focus();
      localSends = localSends.map(candidate => candidate.key === request.key ? {
        ...candidate, scope: `thread:${res.threadId}`,
        state: { kind: "published", threadId: res.threadId, messageId: res.messageId },
      } : candidate);
      // Phase B: a new conversation keeps the web setting it was sent with
      // until the conversation list carries it.
      // (Sent without a setting, it started with the default: on.)
      if (request.intent.kind === "composer" && request.args.threadId === undefined) {
        webSearchPending.set(res.threadId, request.args.allowWeb ?? true);
      }
      if (isOriginVisible && request.intent.kind === "composer") {
        // The new conversation got its thread: whatever the writer typed
        // since the send stays in the composer.
        if (selectedThreadId !== res.threadId) carryDraftOnScopeChange = true;
        selectedThreadId = res.threadId;
        startingNewChat = false;
      }
      if (isOriginVisible) chatContainer?.scrollToBottom("instant");
    } catch (e) {
      // Phase A (task 1): plain words for a refusal, never the Convex
      // client's raw "[CONVEX M(...)] [Request ID: ...]" text.
      localSends = localSends.map(candidate => candidate.key === request.key ? {
        ...candidate, state: { kind: "failed", error: chatSendErrorMessage(e, { resend: request.intent.kind !== "composer" && request.intent.kind !== "edit" }) },
      } : candidate);
    } finally {
      sending = false;
    }
  }

  const highlightLineCount = $derived(
    composerSelection ? composerSelection.text.split("\n").length : 0
  );

  const isEmpty = $derived(!messages || messages.length === 0);
  // Phase C (W2): older pages may still hold this path's messages.
  const isConversationEmpty = $derived(isEmpty && visibleLocalSends.length === 0 && !hasResearch && !pendingResearch && !canLoadOlder);

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
    stopError = null;
    try {
      await abortStreaming({
        threadId: selectedThreadId,
        order: lastMessage.order,
      });
    } catch (e) {
      stopError = chatStopErrorMessage(e);
    } finally {
      stopping = false;
    }
  }
  $effect(() => {
    if (!isStreaming) stopError = null;
  });

  // Phase B (2026-10-20), W2: Stop on a reply someone else started asks
  // first. It never restricts Stop.
  let stopConfirmOpen = $state(false);
  let stopConfirmName = $state<string | undefined>(undefined);
  function requestStop() {
    if (!selectedThreadId || !lastMessage || stopping) return;
    const turn = turnByOrder.get(lastMessage.order);
    if (turn && turn.fromCurrentUser === false && (turn.status === "queued" || turn.status === "running")) {
      stopConfirmName = turn.senderName;
      stopConfirmOpen = true;
      return;
    }
    void stopGeneration();
  }

  // Phase B: the opt-in for a browser notification when a reply is ready
  // (the page-level reply signal fires it, only while the tab is hidden).
  let canNotify = $state(false);
  let notifyReplies = $state(false);
  $effect(() => {
    canNotify = notificationsSupported();
    notifyReplies = notifyRepliesEnabled();
  });
  async function toggleNotifyReplies(on: boolean) {
    notifyReplies = on;
    notifyReplies = await setNotifyReplies(on);
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

{#snippet writerContent(split: { content: string; highlight?: string; pinned?: string[] })}
  {#if split.highlight}
    <p class="mb-2 italic text-navy/80">&ldquo;{split.highlight}&rdquo;</p>
  {/if}
  {#if split.content.trim()}
    <p class="whitespace-pre-wrap">{split.content.trim()}</p>
  {/if}
  {#if split.pinned?.length}
    <!-- Phase C (W1): the project files this message asked the assistant to read in full. -->
    <ul class="mt-2 flex flex-wrap gap-1" aria-label="Files read in full with this message" data-pinned-files>
      {#each split.pinned as name, index (index)}
        <li class="inline-flex h-[1.375rem] max-w-full min-w-0 items-center gap-1 rounded-full border border-line bg-white px-2 text-[0.6875rem] text-ink-secondary">
          <svg class="shrink-0" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></svg>
          <span class="truncate">{name}</span>
        </li>
      {/each}
    </ul>
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
            <ActionButton variant="danger" class="min-h-7 px-2 font-medium aria-disabled:opacity-50 pointer-coarse:min-h-11"
              aria-label="Retry"
              aria-describedby={`local-send-content-${request.key}`}
              aria-disabled={request.state.kind !== "failed"}
              disabled={request.state.kind === "failed" && (request.intent.kind !== "composer" ? regenerationBusy : sending || researchStarting || publicationPending || isStreaming)}
              onclick={(event) => retryRequest(request.key, event.currentTarget)}>Retry</ActionButton>
          {/if}
          {#if request.state.kind === "failed"}
            <ActionButton variant="danger" class="min-h-7 px-2 font-medium pointer-coarse:min-h-11" aria-label="Dismiss send error"
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

  {#if connection.offline}
    <!-- Phase A (task 10): Convex queues a send made offline and sends it
         on reconnect; the elapsed timers pause meanwhile. -->
    <div class="mb-2 flex items-center gap-2 rounded-lg bg-chrome px-3 py-2 text-xs text-ink-secondary" role="status" data-offline-banner>
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true"></span>
      <span>{OFFLINE_MESSAGE}</span>
    </div>
  {/if}

  {#if showContextNotice}
    <!-- Phase A (task 8): shown once per conversation, beside the divider
         drawn in the transcript. -->
    <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-chrome px-3 py-2 text-xs text-ink-secondary" data-context-notice>
      <span class="min-w-0 flex-1">This conversation is long, so the assistant now reads only its newest messages. A new conversation gives it a clean start.</span>
      <span class="flex items-center gap-1">
        <ActionButton variant="ghost" class="min-h-7 px-2 pointer-coarse:min-h-11" onclick={() => { dismissContextNotice(); startNewThread(); }}>New conversation</ActionButton>
        <ActionButton variant="ghost" class="min-h-7 px-2 pointer-coarse:min-h-11" aria-label="Dismiss this notice" onclick={dismissContextNotice}>Dismiss</ActionButton>
      </span>
    </div>
  {/if}

  {#if selectedArchivedThread}
    <!-- Phase C (W3): an archived conversation stays readable; a send restores it. -->
    <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-chrome px-3 py-2 text-xs text-ink-secondary" data-archived-notice>
      <span class="min-w-0 flex-1">This conversation is archived. Sending a message restores it.</span>
      <ActionButton variant="ghost" class="min-h-7 px-2 pointer-coarse:min-h-11"
        onclick={() => selectedArchivedThread && void restoreConversation(selectedArchivedThread)}>Restore</ActionButton>
    </div>
  {/if}

  {#if stopError}
    <p class="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert" data-stop-error>{stopError}</p>
  {/if}

  {#if webSearchError}
    <p class="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert" data-web-search-error>{webSearchError}</p>
  {/if}

  {#if highlightTooLong && pendingHighlight}
    <p class="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert" data-highlight-too-long>
      The selected text is {pendingHighlight.text.length.toLocaleString("en-US")} characters. Select up to {MAX_CHAT_HIGHLIGHT_CHARS.toLocaleString("en-US")} characters to send it.
    </p>
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

  <PromptInput bind:value={input} isLoading={sending || researchStarting} onSubmit={(v) => sendText(v)} class="flex-col items-stretch gap-3 rounded-xl px-3.5 py-3">
    <!-- Board 2.1 composer: the text on top, then message options at the left
         and a round send button at the right. -->
    <div>
    <PromptInputTextarea
      bind:ref={textareaEl}
      wrapperClass="py-0"
      class="min-h-[1.125rem] px-0 text-[0.8125rem] leading-[1.125rem] text-ink placeholder:text-ink-faint md:text-[0.8125rem]"
      aria-label="Message the report assistant"
      textIndent={composerContextActive ? pillWidth : undefined}
      placeholder={pendingResearch?.preset === "vet"
        ? "Anything to focus on? (optional)"
        : pendingResearch
        ? "What should the research verify?"
        : refiningProposal
          ? "How should I revise this suggestion?"
          : pendingHighlight
            ? "Add instructions…"
            : "Ask about this report…"}
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
              <!-- Phase A (task 11): a report selection, not something pasted. -->
              {pendingResearch ? `${pendingResearch.preset === "vet" ? "Vet" : "Research"}: ${composerSelection.text.replace(/\s+/g, " ").trim()}` : "Selected text"}
            </span>
            {#if highlightLineCount > 1}
              <span class="shrink-0">+{highlightLineCount} lines</span>
            {/if}
            <button
              type="button"
              onclick={pendingResearch ? onClearResearch : onClearHighlight}
              class="shrink-0 opacity-50 transition-opacity hover:opacity-100"
              aria-label={pendingResearch ? "Remove research selection" : "Remove selected text"}
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
    <!-- Board 2.1 anatomy: message options at the left (Brain examples, web search,
         files read in full), send at the right. The composer uploads nothing:
         "Read a file in full" pins files already in the project's Files panel
         (owner, 2026-10-19; Phase C, 2026-10-20). No drop, paste or file input. -->
    {#if pinnedFiles.length && !pendingResearch}
      <!-- Phase C (W1): the files pinned to this message stay visible until it is sent. -->
      <div class="mb-1.5 flex flex-wrap items-center gap-1.5" data-pinned-chips>
        {#each pinnedFiles as file (file.id)}
          <span data-pinned-chip class="inline-flex h-[1.375rem] max-w-56 min-w-0 items-center gap-1 rounded-full bg-primary-wash pr-1 pl-2 text-[0.6875rem] text-primary-selected">
            <span class="truncate">{file.name}</span>
            <button
              type="button"
              onclick={() => (pinnedFiles = pinnedFiles.filter((pinned) => pinned.id !== file.id))}
              disabled={sending || isStreaming}
              aria-label={`Remove ${file.name}`}
              class="relative flex size-4 shrink-0 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-3.5 pointer-coarse:before:content-['']"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </span>
        {/each}
      </div>
    {/if}
    <div class="flex items-center justify-between gap-2">
    <PromptInputActions class="min-w-0 items-center gap-1.5">
      {#if !pendingResearch}
        <DropdownMenu.Root onOpenChange={(open) => { if (open) filePickerWanted = true; }}>
          <!-- Fable review F3 P3-2: focus returns here when the file picker
               closes; the tooltip must not then cover the pinned chips. -->
          <Tooltip text="Message options" ignoreNonKeyboardFocus>
            {#snippet children({ props: tooltipProps })}
              <DropdownMenu.Trigger
                {...tooltipProps}
                bind:ref={messageOptionsButton}
                aria-label="Message options"
                class="flex size-[1.625rem] shrink-0 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-primary-wash data-[state=open]:bg-primary-wash motion-reduce:transition-none pointer-coarse:size-11"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
                  <circle cx="15" cy="7" r="2" />
                  <circle cx="9" cy="17" r="2" />
                </svg>
              </DropdownMenu.Trigger>
            {/snippet}
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={8}
              class="z-[100] w-72 rounded-xl border border-line bg-white p-1 shadow-lg"
              onCloseAutoFocus={(event) => {
                // Phase C (W1): "Read a file in full" hands focus to its picker.
                if (!openFilePickerOnClose) return;
                event.preventDefault();
                openFilePickerOnClose = false;
                filePickerOpen = true;
              }}
            >
              <DropdownMenu.CheckboxItem
                bind:checked={allowBrain}
                disabled={sending || isStreaming}
                closeOnSelect={false}
                title="Allow a new search of approved past reports. Previous conversation remains available."
                class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash data-[disabled]:opacity-50 pointer-coarse:min-h-11"
              >
                {#snippet children({ checked })}
                  <span class={`flex size-4 shrink-0 items-center justify-center rounded border ${checked ? "border-primary-selected bg-primary-selected text-white" : "border-line"}`} aria-hidden="true">
                    {#if checked}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                    {/if}
                  </span>
                  Use Brain examples for this message
                {/snippet}
              </DropdownMenu.CheckboxItem>
              <!-- Phase B: a setting of the conversation, shown as a switch. -->
              <DropdownMenu.CheckboxItem
                checked={webSearchOn}
                onCheckedChange={(on) => void setWebSearch(on)}
                disabled={sending || webSearchSetting === null}
                closeOnSelect={false}
                title="Allow web searches for what a term or method means, or for CRA guidance. Names are removed before anything is searched."
                class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash data-[disabled]:opacity-50 pointer-coarse:min-h-11"
                data-web-switch
              >
                {#snippet children({ checked })}
                  <span class={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none ${checked ? "bg-primary-selected" : "bg-gray-300"}`} aria-hidden="true">
                    <span class={`inline-block size-3 rounded-full bg-white transition-transform motion-reduce:transition-none ${checked ? "translate-x-3.5" : "translate-x-0.5"}`}></span>
                  </span>
                  Search the web in this conversation
                {/snippet}
              </DropdownMenu.CheckboxItem>
              <!-- Phase C (W1): pick project files to read in full with this message.
                   It opens its own picker above the composer, so it fits a narrow panel. -->
              <DropdownMenu.Item
                disabled={sending || isStreaming}
                onSelect={() => { openFilePickerOnClose = true; }}
                class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash data-[disabled]:opacity-50 pointer-coarse:min-h-11"
                data-file-picker-trigger
              >
                <svg class="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
                <span class="min-w-0 flex-1 truncate">Read a file in full</span>
                {#if pinnedFiles.length}
                  <span class="text-data text-ink-muted" aria-hidden="true">{pinnedFiles.length}/{CHAT_MAX_PINNED_FILES}</span>
                {/if}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <!-- Phase C (W1): the file picker. It lists the project's files that are
             not archived and uploads nothing. -->
        <Popover.Root bind:open={filePickerOpen}>
          <Popover.Portal>
            <Popover.Content
              customAnchor={messageOptionsButton}
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={8}
              aria-labelledby="chat-file-picker-heading"
              onOpenAutoFocus={(event) => {
                // The picker opens as Message options closes. bits-ui 2.19
                // guards its own deferred focus against that teardown, so the
                // picker moves focus to its first file itself, a frame later.
                // With no file to choose (loading, or none yet), the picker
                // itself takes focus. bits-ui can run this twice as the picker
                // opens; a frame that arrives after Esc closed it does nothing.
                event.preventDefault();
                requestAnimationFrame(() => {
                  if (!filePickerOpen) return;
                  const picker = document.querySelector<HTMLElement>("[data-file-picker]");
                  const first = picker?.querySelector<HTMLElement>("[data-checkbox-root]:not([disabled]), button:not([disabled])");
                  (first ?? picker)?.focus();
                });
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                messageOptionsButton?.focus();
              }}
              class="z-[100] flex max-h-96 w-72 max-w-[calc(100vw-1rem)] flex-col rounded-xl border border-line bg-white p-1 shadow-lg outline-none"
              data-file-picker
            >
              <p id="chat-file-picker-heading" class="px-2 pt-1.5 pb-1 text-xs text-ink-muted">
                Choose up to {CHAT_MAX_PINNED_FILES} project files to read with this message
              </p>
              {#if projectFilesQ.data === undefined}
                <p class="px-2 py-1.5 text-[0.8125rem] text-ink-muted" role="status">{projectFilesQ.error ? "The project's files could not be loaded." : "Loading files…"}</p>
              {:else if pinnableFiles.length === 0}
                <p class="px-2 py-1.5 text-[0.8125rem] text-ink-muted">No files in this project yet. Add them in the Files panel.</p>
              {:else}
                <ul class="min-h-0 overflow-y-auto" aria-labelledby="chat-file-picker-heading">
                  {#each pinnableFiles as file (file._id)}
                    {@const isPinned = pinnedFiles.some((pinned) => pinned.id === file._id)}
                    {@const blocked = sending || isStreaming || (!isPinned && pinnedFiles.length >= CHAT_MAX_PINNED_FILES)}
                    <li>
                      <label class={`flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink hover:bg-primary-wash has-[:focus-visible]:bg-primary-wash pointer-coarse:min-h-11 ${blocked ? "opacity-50" : ""}`} data-file-option>
                        <Checkbox.Root
                          checked={isPinned}
                          onCheckedChange={(on) => setPinned(file, on)}
                          disabled={blocked}
                          class="flex size-4 shrink-0 items-center justify-center rounded border border-line outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[state=checked]:border-primary-selected data-[state=checked]:bg-primary-selected data-[state=checked]:text-white"
                        >
                          {#snippet children({ checked })}
                            {#if checked}
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
                            {/if}
                          {/snippet}
                        </Checkbox.Root>
                        <span class="min-w-0 flex-1 truncate">{file.fileName}</span>
                      </label>
                    </li>
                  {/each}
                </ul>
              {/if}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      {/if}
      {#if allowBrain && !pendingResearch}
        <!-- The per-message Brain choice stays visible while it is on. -->
        <span data-brain-chip class="inline-flex h-[1.375rem] min-w-0 items-center gap-1 rounded-full bg-primary-wash pr-1 pl-2 text-[0.6875rem] text-primary-selected">
          <span class="truncate">Brain examples</span>
          <button
            type="button"
            onclick={() => (allowBrain = false)}
            disabled={sending || isStreaming}
            aria-label="Stop using Brain examples for this message"
            class="relative flex size-4 shrink-0 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-3.5 pointer-coarse:before:content-['']"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
      {/if}
    </PromptInputActions>
    <PromptInputActions class="items-center gap-2">
      {#if showVetCounter}
        <span class={`text-data ${vetNoteTooLong ? "text-red-600" : "text-ink-muted"}`} data-vet-note-counter>
          {composedLength.toLocaleString("en-US")} / {VET_NOTE_MAX_CHARS.toLocaleString("en-US")}
          {#if vetNoteTooLong}<span class="sr-only">characters. This note is too long to send.</span>{:else}<span class="sr-only">characters</span>{/if}
        </span>
      {/if}
      {#if showCounter && !pendingResearch}
        <!-- Phase A (task 11): the server's message limit, shown near it. -->
        <span class={`text-data ${messageTooLong ? "text-red-600" : "text-ink-muted"}`} data-composer-counter>
          {composedLength.toLocaleString("en-US")} / {MAX_CHAT_MESSAGE_CHARS.toLocaleString("en-US")}
          {#if messageTooLong}<span class="sr-only">characters. This message is too long to send.</span>{:else}<span class="sr-only">characters</span>{/if}
        </span>
      {/if}
      {#if isStreaming}
        <button
          onclick={requestStop}
          disabled={stopping || !selectedThreadId}
          class="flex size-[1.625rem] shrink-0 items-center justify-center rounded-full bg-primary-selected text-white transition-[background-color,transform] hover:bg-primary-dark active:translate-y-px disabled:opacity-50 motion-reduce:transition-none pointer-coarse:size-11"
          title="Stop generating"
          aria-label="Stop generating"
        >
          <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </svg>
        </button>
      {:else}
        <button
          onclick={() => sendText(input)}
          disabled={sending || researchStarting || publicationPending || composerChatBlocked || threadsLoading || threadsUnreadable || conversationUnreadable || (!input.trim() && !pendingHighlight && !pendingResearch) || (!pendingResearch && (messageTooLong || highlightTooLong)) || vetNoteTooLong}
          class="group flex size-[1.625rem] shrink-0 items-center justify-center rounded-full bg-primary-selected text-white transition-[background-color,opacity,transform] hover:bg-primary-dark active:translate-y-px disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11"
          title={pendingResearch?.preset === "vet" ? "Vet against public sources" : pendingResearch ? "Start research" : "Send"}
          aria-label="Send message"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M6 10V2M2.5 5.5L6 2l3.5 3.5" />
          </svg>
        </button>
      {/if}
    </PromptInputActions>
    </div>
  </PromptInput>

  {#if showHint}
    <p
      transition:fade={{ duration: motionDuration(300) }}
      class="pt-1.5 text-center text-[0.6875rem] text-gray-400"
    >
      Enter to send, Shift+Enter for a new line
    </p>
  {/if}
{/snippet}

<!-- data-assistant-draft (Phase A, task 2): the report page's Esc handler
     keeps the Assistant open while the composer holds unsent text. Fable
     review F3 P3-1: also while files are pinned, Brain is on for the next
     message, or a card or selection is being refined or researched. -->
<div class="flex h-full flex-col bg-white" data-assistant-panel data-assistant-draft={input.trim() || pinnedFiles.length || allowBrain || composerContextActive ? "" : undefined}>
  <p class="sr-only" aria-live="polite" aria-atomic="true" data-reply-announcement>{replyAnnouncement}</p>
  <!-- Header (pr-12 clears a host's overlay close button when it has one) -->
  <!-- Board 2.1 header: Aurora mark, "Assistant" and the expand control.
       The title opens the conversation menu (history, new conversation). -->
  <div class={`box-content flex h-7 shrink-0 items-center gap-2.5 pt-5 pb-2 ${isFull ? "px-6 lg:px-0" : `pl-6 ${closeInset ? "pr-12" : "pr-6"}`}`}>
    <AuroraMark size={20} />
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        bind:ref={conversationMenuButton}
        aria-label="Conversation menu"
        title="Conversations"
        class="group -ml-1.5 flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[0.8125rem] leading-[1.125rem] font-medium text-ink transition-colors hover:bg-chrome/60 data-[state=open]:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:min-h-11"
      >
        Assistant
        <svg class="size-3 shrink-0 text-ink-faint opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:rotate-180 group-data-[state=open]:opacity-100 motion-reduce:transition-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="end"
          sideOffset={8}
          onCloseAutoFocus={(event) => {
            const focus = conversationMenuFocus;
            conversationMenuFocus = null;
            if (!focus) return;
            event.preventDefault();
            focus();
          }}
          class="z-[100] max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg"
        >
          <DropdownMenu.Item
            onSelect={startNewThread}
            class="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink outline-none hover:bg-chrome/60 focus:bg-chrome/60 pointer-coarse:h-11"
          >
            <svg class="h-4 w-4 shrink-0 text-primary-selected" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" d="M12 5v14M5 12h14" />
            </svg>
            New conversation
          </DropdownMenu.Item>
          {#each unsavedConversations as request (request.scope)}
            <DropdownMenu.Item onSelect={() => returnToRequest(request)}
              class="flex min-h-8 w-full items-center rounded-md px-2 text-sm font-medium text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash pointer-coarse:min-h-11">
              <span class="min-w-0 truncate">{unsentConversationLabel(request)}</span>
            </DropdownMenu.Item>
          {/each}
          {#if (threadsQ.data?.length ?? 0) > 0}
            <div class="my-1 border-t border-line-soft"></div>
            {#each threadsQ.data ?? [] as thread (thread._id)}
              <!-- Phase C (W3): each conversation has its own actions. -->
              <div class="flex items-center gap-0.5" data-thread-row>
                <DropdownMenu.Item
                  onSelect={() => selectThread(thread.agentThreadId)}
                  class={`flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none hover:bg-chrome/60 focus:bg-chrome/60 pointer-coarse:min-h-11 ${thread.agentThreadId === selectedThreadId ? "bg-chrome" : ""}`}
                >
                  <span class="size-2 shrink-0 rounded-full bg-primary-selected" aria-hidden="true"></span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span id={`thread-title-${thread._id}`} class="truncate text-sm font-medium text-ink">{thread.title}</span>
                    {#if !thread.startedByCurrentUser && thread.createdByName}
                      <!-- Phase B: a conversation someone else started says who. -->
                      <span class="truncate text-xs text-ink-muted" data-thread-starter>Started by {thread.createdByName}</span>
                    {/if}
                  </span>
                  <span class="shrink-0 text-xs text-ink-faint">
                    {new Date(thread.lastActivityAt ?? thread.createdAt).toLocaleDateString()}
                  </span>
                </DropdownMenu.Item>
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger
                    aria-label="Conversation actions"
                    aria-describedby={`thread-title-${thread._id}`}
                    data-thread-actions
                    class="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-chrome/60 focus:bg-chrome/60 data-[state=open]:bg-chrome/60 pointer-coarse:size-11"
                  >
                    <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
                    </svg>
                  </DropdownMenu.SubTrigger>
                  <!-- The conversation menu scrolls, which clips anything drawn
                       inside it, so its submenus render outside it. -->
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent sideOffset={4} class="z-[110] w-48 rounded-xl border border-line bg-white p-1 shadow-lg">
                      <DropdownMenu.Item onSelect={() => beginRename(thread)}
                        class="flex min-h-8 w-full items-center rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash pointer-coarse:min-h-11">Rename</DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => void archiveConversation(thread)}
                        class="flex min-h-8 w-full items-center rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash pointer-coarse:min-h-11">Archive</DropdownMenu.Item>
                      {#if currentUserQ.data?.role === "admin"}
                        <DropdownMenu.Item onSelect={() => askDelete(thread)} data-delete-conversation
                          class="flex min-h-8 w-full items-center rounded-md px-2 text-[0.8125rem] text-red-600 outline-none hover:bg-red-50 focus:bg-red-50 pointer-coarse:min-h-11">Delete permanently</DropdownMenu.Item>
                      {/if}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              </div>
            {/each}
          {/if}
          {#if archivedThreads.length > 0}
            <div class="my-1 border-t border-line-soft"></div>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger data-archived-conversations
                class="flex min-h-8 w-full items-center justify-between gap-1.5 rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-chrome/60 focus:bg-chrome/60 data-[state=open]:bg-chrome/60 pointer-coarse:min-h-11">
                Archived conversations
                <svg class="size-3 shrink-0 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent sideOffset={4} class="z-[110] max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg">
                  {#each archivedThreads as thread (thread._id)}
                    <div class="flex items-center gap-0.5" data-archived-row>
                      <DropdownMenu.Item onSelect={() => selectThread(thread.agentThreadId)}
                        class={`flex min-h-8 min-w-0 flex-1 items-center rounded-md px-2 py-1 text-sm outline-none hover:bg-chrome/60 focus:bg-chrome/60 pointer-coarse:min-h-11 ${thread.agentThreadId === selectedThreadId ? "bg-chrome" : ""}`}>
                        <span id={`archived-title-${thread._id}`} class="truncate text-ink">{thread.title}</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => void restoreConversation(thread)}
                        aria-describedby={`archived-title-${thread._id}`}
                        class="flex min-h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-primary-selected outline-none hover:bg-primary-wash focus:bg-primary-wash pointer-coarse:min-h-11">Restore</DropdownMenu.Item>
                    </div>
                  {/each}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          {/if}
          {#if canNotify}
            <div class="my-1 border-t border-line-soft"></div>
            <DropdownMenu.CheckboxItem
              checked={notifyReplies}
              onCheckedChange={(on) => void toggleNotifyReplies(on)}
              closeOnSelect={false}
              data-notify-replies
              class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash pointer-coarse:min-h-11"
            >
              {#snippet children({ checked })}
                <span class={`flex size-4 shrink-0 items-center justify-center rounded border ${checked ? "border-primary-selected bg-primary-selected text-white" : "border-line"}`} aria-hidden="true">
                  {#if checked}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                  {/if}
                </span>
                Notify me when a reply is ready
              {/snippet}
            </DropdownMenu.CheckboxItem>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    {#if onToggleFull}
      <button
        onclick={onToggleFull}
        title={isFull ? "Collapse assistant" : "Expand assistant"}
        aria-label={isFull ? "Collapse assistant" : "Expand assistant"}
        aria-pressed={isFull}
        class="ml-auto flex size-[1.625rem] shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-chrome/60 hover:text-ink motion-reduce:transition-none pointer-coarse:size-11"
      >
        {#if isFull}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
          </svg>
        {:else}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        {/if}
      </button>
    {/if}
  </div>


  {#if renaming}
    <!-- Phase C (W3): rename in place. Enter saves, Escape cancels. -->
    <form
      class={`flex shrink-0 items-center gap-2 pb-2 ${isFull ? "px-6 lg:px-0" : "px-6"}`}
      data-rename-conversation
      onsubmit={(event) => {
        event.preventDefault();
        void saveRename();
      }}
    >
      <div class="min-w-0 flex-1" bind:this={renameField} {@attach (field: HTMLElement) => {
        // Opened from the menu, the menu hands focus over as it closes;
        // otherwise the field takes it once it is in the page.
        requestAnimationFrame(() => {
          if (field.isConnected && !field.contains(document.activeElement)) focusRenameField();
        });
      }}>
        <Input
          bind:value={renameDraft}
          aria-label="Conversation name"
          maxlength={80}
          readonly={renameSaving}
          onkeydown={renameKeydown}
          class="h-8 w-full px-2.5 py-1 text-[0.8125rem] pointer-coarse:h-11"
        />
      </div>
      <ActionButton variant="primary" type="submit" class="min-h-8 pointer-coarse:min-h-11" disabled={renameSaving || !renameDraft.trim()} onkeydown={renameKeydown}>Save</ActionButton>
      <ActionButton variant="ghost" class="min-h-8 pointer-coarse:min-h-11" onclick={cancelRename} onkeydown={renameKeydown}>Cancel</ActionButton>
    </form>
  {/if}
  {#if conversationError}
    <div class={`shrink-0 pb-2 ${isFull ? "px-6 lg:px-0" : "px-6"}`}>
      <p class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert" data-conversation-error>{conversationError}</p>
    </div>
  {/if}

  {#if !transcriptReady && visibleLocalSends.length === 0 && !pendingResearch}
    <AssistantPanelSkeleton part="body" {isFull} />
  {:else if threadsUnreadable && visibleLocalSends.length === 0}
    <!-- The conversation list failed to load: never the welcome. -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6">
      <p class="max-w-[18.75rem] text-center text-xs leading-relaxed text-ink-muted" role="alert">
        Your conversations could not load. Reload the page, or start a new one from the Assistant menu.
      </p>
    </div>
  {:else if conversationUnreadable && visibleLocalSends.length === 0}
    <!-- A conversation that failed to load says so, never the welcome. -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6">
      <p class="max-w-[18.75rem] text-center text-xs leading-relaxed text-ink-muted" role="alert">
        This conversation could not load. Pick another from the Assistant menu, or start a new one.
      </p>
    </div>
  {:else if isConversationEmpty}
    <!-- Empty state: brand mark, capability blurb, starter suggestions; the
         composer stays pinned to the bottom (Obvious anatomy) in EVERY state. -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-6">
      <AuroraMark size={36} class="mb-3" />
      <h2 class="text-center text-[0.9375rem] font-medium text-ink">
        How can I help with this report?
      </h2>
      <p class="mt-1 max-w-[18.75rem] text-center text-xs leading-relaxed text-ink-muted">
        I can tighten language, find passages, check compliance and propose
        edits, grounded in this report and its source documents.
      </p>
      {#if !input.trim()}
      <div class="mt-5 flex w-full max-w-[20rem] flex-col gap-1.5" data-starters>
        {#each STARTERS as starter (starter)}
          <Suggestion
            class="w-full justify-start rounded-lg px-3 py-1.5 text-left text-[0.8125rem] pointer-coarse:min-h-11"
            onclick={() => useStarter(starter)}
          >
            {starter}
          </Suggestion>
        {/each}
      </div>
      {/if}
    </div>
  {:else}
    <ChatContainer
      bind:this={chatContainer}
      class="min-h-0 flex-1"
      viewportClass={isFull ? "px-6 py-4 lg:px-0" : "px-6 py-4"}
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
        {#if contextBoundary !== null && m.order === contextBoundary && (!prev || prev.order < contextBoundary)}
          <!-- Phase A (task 8): the model no longer reads anything above. -->
          <div class="flex items-center gap-3 py-1" role="separator" aria-label="The assistant no longer reads messages above this line." data-context-divider>
            <span class="h-px flex-1 bg-line"></span>
            <span class="text-center text-xs text-ink-muted">The assistant no longer reads messages above this line.</span>
            <span class="h-px flex-1 bg-line"></span>
          </div>
        {/if}
        {#if prev && !sameDay(prev._creationTime, m._creationTime)}
          <div class="flex items-center gap-3 py-1" role="separator" aria-label={dayLabel(m._creationTime)}>
            <span class="h-px flex-1 bg-line-soft"></span>
            <span class="text-label">{dayLabel(m._creationTime)}</span>
            <span class="h-px flex-1 bg-line-soft"></span>
          </div>
        {/if}
        {#if m.role === "user"}
          {@const pinnedNames = turnByOrder.get(m.order)?.pinnedFiles?.map((file) => file.name)}
          {@const split = { ...splitWriterMessage(visibleWriterMessage(text)), ...(pinnedNames?.length ? { pinned: pinnedNames } : {}) }}
          {@const chip = autoContinueChip(m.order, text)}
          {@const author = chip ? null : authorLabel(m.order)}
          {#if chip}
            <!-- Phase B: a link the server started carries the job on; it is
                 not something a person wrote. -->
            <div class="flex justify-center" data-auto-continue-chip>
              <span class="rounded-full bg-chrome px-2.5 py-0.5 text-[0.6875rem] leading-4 text-ink-muted">{chip}</span>
            </div>
          {:else}
            {@const footer = writerFooter(m.order)}
            <div class="group flex flex-col gap-1" data-writer-order={m.order}>
              {#if author}
                <!-- Phase B: who wrote it, when more than one person wrote here. -->
                <p class="text-right text-[0.6875rem] leading-4 text-ink-muted" data-message-author>{author}</p>
              {/if}
              {#if editingOrder === m.order}
                <!-- Phase C (W2): Enter sends an alternative, Escape cancels. -->
                <MessageEditor initial={split.content.trim()} disabled={regenerationBusy}
                  onSend={(text) => sendEdit(m.order, text)} onCancel={() => void cancelEdit(m.order)} />
              {:else}
                <Message role="user">
                  <MessageContent class="min-w-0 [overflow-wrap:anywhere]">
                    {@render writerContent(split)}
                  </MessageContent>
                </Message>
              {/if}
              <WriterMessageFooter edit={editingOrder === m.order ? undefined : footer.edit}
                alternatives={footer.alternatives} switchDisabled={regenerationBusy}
                onSwitch={(promptMessageId) => switchAlternative(m.order, promptMessageId)}
                authorLine={footer.authorLine} error={footer.error} />
            </div>
          {/if}
          {#if !turnPrompts.assistantOrders.has(m.order) && timingByOrder.has(m.order)}
            <!-- Keep a durable turn without an assistant row at its prompt's
                 position, even after later prompts and replies arrive. -->
            <AssistantTurn timing={timingByOrder.get(m.order)} onRefine={refineProposal}
              paused={connection.offline}
              continuation={continueOffer(m.order, timingByOrder.get(m.order))}
              regeneration={regeneration(m.order, turnPrompts.promptByOrder.get(m.order), undefined, timingByOrder.get(m.order))} />
          {/if}
        {:else if m.role === "assistant"}
          <AssistantTurn
            message={m}
            regeneration={regeneration(m.order, turnPrompts.promptByAssistantId.get(m.id), m.status, timingByOrder.get(m.order))}
            feedback={answerFeedback(m.id)}
            proposals={grouped.byMessageId.get(m.id) ?? []}
            timing={timingByOrder.get(m.order)}
            paused={connection.offline}
            webSearches={webSearchesByTurn.get(m.order)}
            showSources={finalAssistantIds.has(m.id)}
            continuation={finalAssistantIds.has(m.id) ? continueOffer(m.order, timingByOrder.get(m.order)) : undefined}
            copied={copiedId === m.id}
            copyFailed={copyFailedId === m.id}
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
  <div bind:offsetHeight={composerHeight} class={`shrink-0 pt-2 pb-6 ${isFull ? "px-6 lg:px-0" : "px-6"}`}>{@render composer()}</div>
  <StopReplyDialog bind:open={stopConfirmOpen} name={stopConfirmName} onConfirm={() => void stopGeneration()} />
  <DeleteConversationDialog bind:open={deleteOpen} title={deleteTarget?.title} onConfirm={() => void confirmDelete()} onCloseFocus={focusConversationMenu} />
</div>

<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../convex/_generated/dataModel";
  import { createUIMessages } from "$lib/chat/uiMessages.svelte";
  import type { UIMessage } from "@convex-dev/agent";
  import ProposedEditCard from "$lib/components/chat/ProposedEditCard.svelte";
  import ChatIcon from "$lib/components/ui/ChatIcon.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { fade } from "svelte/transition";
  import {
    ChatContainer,
    ScrollButton,
    Message,
    MessageContent,
    MessageAvatar,
    MessageActions,
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
    isFull?: boolean;
    onToggleFull?: () => void;
    onReferenceText?: (texts: string[], scrollTo?: string) => void;
    onReviewReplacements?: (
      pairs: { find: string; replaceWith: string }[],
      proposalId: string
    ) => void;
    reviewingId?: string | null;
  }

  let {
    projectId,
    reportId,
    pendingHighlight,
    onClearHighlight,
    isFull,
    onToggleFull,
    onReferenceText,
    onReviewReplacements,
    reviewingId,
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
  ): "txt" | "md" | "pdf" | "docx" | "msg" | "eml" | "other" {
    const l = name.toLowerCase();
    if (l.endsWith(".pdf")) return "pdf";
    if (l.endsWith(".docx")) return "docx";
    if (l.endsWith(".msg")) return "msg";
    if (l.endsWith(".eml") || l.endsWith(".mbox")) return "eml";
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

  const ui = createUIMessages(
    api.chatV2.listMessages,
    () => (selectedThreadId ? { threadId: selectedThreadId } : "skip"),
    { initialNumItems: 80 }
  );
  const messages = $derived(ui.results);

  const proposalsQ = useQuery(api.chatV2.listProposals, () =>
    selectedThreadId ? { threadId: selectedThreadId } : "skip"
  );

  const sendMessage = useMutation(api.chatV2.sendMessage);
  const abortStreaming = useMutation(api.chatV2.abortStreaming);
  const applyProposal = useMutation(api.chatV2.applyProposal);
  const rejectProposal = useMutation(api.chatV2.rejectProposal);
  const uploadDocument = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);

  let input = $state("");
  let sending = $state(false);
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

  // Group proposals under the assistant message they came from; anything the
  // component ids don't line up with lands after the final message.
  const grouped = $derived.by(() => {
    const byMessage = new Map<string, Proposal[]>();
    const orphans: Proposal[] = [];
    const messageIds = new Set((messages ?? []).map((m) => m.id));
    for (const p of proposalsQ.data ?? []) {
      if (p.messageId && messageIds.has(p.messageId)) {
        const list = byMessage.get(p.messageId) ?? [];
        list.push(p);
        byMessage.set(p.messageId, list);
      } else {
        orphans.push(p);
      }
    }
    return { byMessage, orphans };
  });

  // Measure the pasted-text pill so the textarea's first line starts beside it.
  $effect(() => {
    void pendingHighlight?.text; // re-measure when the highlighted text changes
    if (pendingHighlight && pillEl) {
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

  // Focus the input when a highlight is piped in from the editor.
  $effect(() => {
    if (pendingHighlight) textareaEl?.focus();
  });

  async function sendText(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !pendingHighlight) || sending || isStreaming) return;
    sending = true;
    try {
      const res = await sendMessage({
        reportId,
        content: trimmed,
        ...(selectedThreadId ? { threadId: selectedThreadId } : {}),
        ...(pendingHighlight ? { highlight: pendingHighlight } : {}),
        ...(startingNewChat ? { newThread: true } : {}),
      });
      selectedThreadId = res.threadId;
      startingNewChat = false;
      input = "";
      attachments = [];
      onClearHighlight?.();
      dismissHint();
      // Re-pin to the bottom even if the writer had scrolled up — a fresh
      // send should always bring their message (and the reply) into view.
      chatContainer?.scrollToBottom("instant");
    } catch (e) {
      console.error("Failed to send message", e);
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
    pendingHighlight ? pendingHighlight.text.split("\n").length : 0
  );

  const isEmpty = $derived(!messages || messages.length === 0);

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
            onclick={() => onReferenceText?.(refs, ref)}
            title={ref.length > 90 ? `${ref.slice(0, 90)}…` : ref}
            class="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-gray-200 px-2 text-xs font-semibold text-navy transition-colors hover:border-primary/50 hover:bg-primary/5"
          >
            {i + 1}
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <ProposedEditCard
      newText={p.newText}
      replacements={p.replacements}
      state={p.state}
      onReplace={async () => {
        await applyProposal({ proposalId: p._id });
      }}
      onReject={async () => {
        await rejectProposal({ proposalId: p._id });
      }}
      onShowInDoc={proposalRefs(p).length > 0
        ? () => onReferenceText?.(proposalRefs(p))
        : undefined}
      onReviewOneByOne={p.replacements && p.replacements.length > 0 && onReviewReplacements
        ? () => onReviewReplacements(p.replacements!, p._id)
        : undefined}
      reviewing={reviewingId === p._id}
    />
  {/if}
{/snippet}

{#snippet composer()}
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
          <button
            aria-label="Remove attachment"
            onclick={() => (attachments = attachments.filter((_, idx) => idx !== i))}
            class="ml-0.5 text-gray-400 hover:text-gray-600"
          >
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <PromptInput bind:value={input} isLoading={sending} onSubmit={(v) => sendText(v)}>
    <PromptInputActions>
      <button
        onclick={() => fileInputEl?.click()}
        disabled={uploading}
        title="Attach a document"
        class="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-primary-wash hover:text-gray-600 disabled:opacity-50"
      >
        {#if uploading}
          <Spinner size="sm" class="border-gray-300 border-t-gray-500" />
        {:else}
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        {/if}
      </button>
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
      textIndent={pendingHighlight ? pillWidth : undefined}
      placeholder={pendingHighlight
        ? "Add instructions…"
        : isEmpty
          ? "Ask anything about this report…"
          : "Ask a follow-up…"}
    >
      {#snippet pill()}
        {#if pendingHighlight}
          <span
            bind:this={pillEl}
            class="absolute left-1 top-1 z-10 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-navy shadow-sm"
          >
            <svg class="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            Pasted text #1
            {highlightLineCount > 1 ? ` +${highlightLineCount} lines` : ""}
            <button onclick={onClearHighlight} class="text-navy/40 hover:text-navy" title="Remove">
              <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
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
          disabled={sending || (!input.trim() && !pendingHighlight)}
          class="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-white transition-colors hover:bg-navy-light disabled:opacity-30"
          title="Send"
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

  {#if isEmpty}
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
      contentClass="space-y-4"
    >
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
          {@const split = splitWriterMessage(text)}
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

      {#if awaitingReply}
        <Loader class="py-1" />
      {/if}

      <ScrollButton />
    </ChatContainer>

    <div class="shrink-0 border-t border-chrome px-4 py-3">{@render composer()}</div>
  {/if}
</div>

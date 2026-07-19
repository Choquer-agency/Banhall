<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import Markdown from "svelte-exmarkdown";
  import { gfmPlugin } from "svelte-exmarkdown/gfm";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import ProposedEditCard from "$lib/components/chat/ProposedEditCard.svelte";
  import ChatIcon from "$lib/components/ui/ChatIcon.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
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

  interface Props {
    projectId: Id<"projects">;
    reportId: Id<"reports">;
    pendingHighlight?: { from: number; to: number; text: string } | null;
    onClearHighlight?: () => void;
    isFull?: boolean;
    onToggleFull?: () => void;
    // BNH-25: highlight the given passages in the document panel, scrolling to
    // `scrollTo` (one of them) or the first if omitted.
    onReferenceText?: (texts: string[], scrollTo?: string) => void;
    // BNH-30: start the one-by-one replace-and-scan-next review in the document.
    onReviewReplacements?: (
      pairs: { find: string; replaceWith: string }[],
      messageId: Id<"chatMessages">
    ) => void;
    // The message whose edit is currently being stepped through (disables its card).
    reviewingMessageId?: Id<"chatMessages"> | null;
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
    reviewingMessageId,
  }: Props = $props();

  type ChatMessage = {
    _id: Id<"chatMessages">;
    role: "writer" | "assistant";
    content: string;
    status: "pending" | "complete" | "error";
    highlight?: { text: string; from: number; to: number } | null;
    attachmentIds?: Id<"projectDocuments">[];
    proposedEdit?: {
      targetText?: string;
      newText?: string;
      replacements?: { find: string; replaceWith: string }[];
      state: "pending" | "applied" | "rejected";
    } | null;
    references?: string[] | null;
  };

  /** The source passages an edit references — for scroll-and-highlight (BNH-25). */
  function refsFromEdit(pe: {
    targetText?: string;
    replacements?: { find: string; replaceWith: string }[];
  }): string[] {
    if (pe.replacements && pe.replacements.length) {
      return pe.replacements.map((r) => r.find).filter(Boolean);
    }
    if (pe.targetText) return [pe.targetText];
    return [];
  }

  /** All passages a message points at — an edit's source text, or a locate-only
   * `references` list (BNH-25). */
  function messageRefs(m: {
    proposedEdit?: {
      targetText?: string;
      replacements?: { find: string; replaceWith: string }[];
    } | null;
    references?: string[] | null;
  }): string[] {
    if (m.proposedEdit) {
      const r = refsFromEdit(m.proposedEdit);
      if (r.length) return r;
    }
    return m.references ?? [];
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

  const mdPlugins = [gfmPlugin()];

  const threadsQ = useQuery(api.chat.listThreads, () => ({ reportId }));
  let selectedThreadId = $state<Id<"chatThreads"> | null>(null);

  // Single continuous thread per report — default to the newest.
  $effect(() => {
    const threads = threadsQ.data;
    if (selectedThreadId === null && threads && threads.length > 0) {
      selectedThreadId = threads[0]._id;
    }
  });

  const messagesQ = useQuery(api.chat.listMessages, () =>
    selectedThreadId ? { threadId: selectedThreadId } : "skip"
  );

  const documentsQ = useQuery(api.documents.listDocuments, () => ({ projectId }));
  const docNameById = $derived.by(() => {
    const map = new Map<string, string>();
    documentsQ.data?.forEach((d) => map.set(d._id, d.fileName));
    return map;
  });

  const sendMessage = useMutation(api.chat.sendMessage);
  const applyProposedEdit = useMutation(api.chat.applyProposedEdit);
  const rejectProposedEdit = useMutation(api.chat.rejectProposedEdit);
  const uploadDocument = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);

  let input = $state("");
  let sending = $state(false);
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);
  let attachments = $state<
    { documentId: Id<"projectDocuments">; fileName: string; category: ContextCategoryId }[]
  >([]);
  // Files picked via the paperclip, awaiting a category choice before upload.
  let pendingFiles = $state<File[] | null>(null);

  let fileInputEl: HTMLInputElement | null = $state(null);
  let viewportEl: HTMLDivElement | null = $state(null);
  let textareaEl: HTMLTextAreaElement | null = $state(null);
  let pillEl: HTMLSpanElement | null = $state(null);
  let pillWidth = $state(0);

  // Measure the pasted-text pill so the textarea's first line starts beside it.
  $effect(() => {
    void pendingHighlight?.text; // re-measure when the highlighted text changes
    if (pendingHighlight && pillEl) {
      pillWidth = pillEl.offsetWidth + 10;
    } else {
      pillWidth = 0;
    }
  });

  // Pin to the latest message (iMessage-style) on every update.
  $effect(() => {
    void messagesQ.data;
    void sending;
    if (viewportEl) {
      viewportEl.scrollTop = viewportEl.scrollHeight;
    }
  });

  // BNH-25: when a NEW assistant message references passages, auto scroll the
  // document to them and highlight. Seed on first load so we don't jump to a
  // historical edit when the thread first opens — only fire for fresh replies.
  let lastRefMsgId: string | null = null;
  let refSeeded = false;
  $effect(() => {
    const messages = messagesQ.data;
    if (!messages) return;
    let latest: (typeof messages)[number] | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (
        m.role === "assistant" &&
        m.status === "complete" &&
        messageRefs(m).length > 0
      ) {
        latest = m;
        break;
      }
    }
    if (!latest) return;
    if (!refSeeded) {
      refSeeded = true;
      lastRefMsgId = latest._id;
      return;
    }
    if (lastRefMsgId === latest._id) return;
    lastRefMsgId = latest._id;
    const refs = messageRefs(latest);
    if (refs.length) onReferenceText?.(refs);
  });

  // Focus the input when a highlight is piped in from the editor.
  $effect(() => {
    if (pendingHighlight) textareaEl?.focus();
  });

  // Auto-grow the textarea like Orbi.
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !pendingHighlight) || sending) return;
    sending = true;
    try {
      const res = await sendMessage({
        reportId,
        content: trimmed,
        ...(selectedThreadId ? { threadId: selectedThreadId } : {}),
        ...(pendingHighlight ? { highlight: pendingHighlight } : {}),
        ...(attachments.length
          ? { attachmentIds: attachments.map((a) => a.documentId) }
          : {}),
      });
      selectedThreadId = res.threadId;
      input = "";
      attachments = [];
      onClearHighlight?.();
      if (textareaEl) textareaEl.style.height = "auto";
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
        // 1. Store the original file bytes so it can be previewed/downloaded.
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

        // 2. Best-effort text extraction for the AI context.
        let parsed;
        try {
          parsed = await parseFileToText(file);
        } catch (e) {
          console.error("Parse failed", e);
          parsed = { fileName: file.name, fileType: guessFileType(file.name), content: "" };
        }

        // 3. Record the document (always — so it shows in Files).
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

        // 4. Tell the writer if the assistant won't have any text from it.
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

  const isEmpty = $derived(!messagesQ.data || messagesQ.data.length === 0);
</script>

{#snippet composer()}
  <!-- Upload error -->
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

  <!-- Category prompt — asks what the just-picked file(s) are -->
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

  <!-- Attachment chips above the box -->
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

  <div class="rounded-2xl border border-chrome bg-canvas px-2 py-1.5">
    <div class="flex items-end gap-2">
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
      <!-- Pasted-text pill sits inline; text starts beside it (terminal-style) -->
      <div class="relative flex-1 py-1">
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
        <textarea
          bind:this={textareaEl}
          bind:value={input}
          oninput={(e) => autoGrow(e.currentTarget)}
          onkeydown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendText(input);
            }
          }}
          rows={1}
          placeholder={pendingHighlight
            ? "Add instructions…"
            : isEmpty
              ? "Ask anything about this report…"
              : "Ask a follow-up…"}
          style={pendingHighlight ? `text-indent: ${pillWidth}px` : undefined}
          class="min-h-[28px] w-full resize-none bg-transparent px-1 py-0.5 text-[14px] leading-snug text-gray-800 placeholder:text-gray-400 outline-none"
        ></textarea>
      </div>
      <button
        onclick={() => sendText(input)}
        disabled={sending || (!input.trim() && !pendingHighlight)}
        class="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-white transition-colors hover:bg-navy-light disabled:opacity-30"
        title="Send"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      </button>
    </div>
  </div>
{/snippet}

{#snippet messageBubble(message: ChatMessage)}
  {#if message.role === "writer"}
    {@const attachmentNames = (message.attachmentIds ?? []).map(
      (id) => docNameById.get(id) ?? "Attachment"
    )}
    <div class="flex justify-end">
      <div class="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 font-sans text-[0.8125rem] leading-relaxed text-navy">
        {#if message.highlight}
          <p class="mb-2 italic text-navy/80">&ldquo;{message.highlight.text}&rdquo;</p>
        {/if}
        {#if attachmentNames.length > 0}
          <div class="mb-2 flex flex-col gap-1">
            {#each attachmentNames as name, i (`${name}-${i}`)}
              <span class="inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-[12px] text-navy/80">
                <svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                {name}
              </span>
            {/each}
          </div>
        {/if}
        {#if message.content}
          <p class="whitespace-pre-wrap">{message.content}</p>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Assistant -->
    {@const isPending = message.status === "pending" && !message.content}
    {@const refs = messageRefs(message)}
    {@const showInDoc =
      refs.length > 0
        ? (scrollTo?: string) => onReferenceText?.(refs, scrollTo)
        : undefined}
    <div class="flex max-w-[95%] flex-col gap-1">
      {#if isPending}
        <div class="flex items-center gap-1 py-1">
          <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]"></span>
          <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]"></span>
          <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"></span>
        </div>
      {:else}
        <div
          class={`chat-markdown text-[0.8125rem] leading-relaxed ${
            message.status === "error" ? "text-red-500" : "text-gray-800"
          }`}
        >
          <Markdown md={message.content} plugins={mdPlugins} />
        </div>
      {/if}

      {#if message.proposedEdit}
        <ProposedEditCard
          newText={message.proposedEdit.newText}
          targetText={message.proposedEdit.targetText}
          replacements={message.proposedEdit.replacements}
          state={message.proposedEdit.state}
          onReplace={async () => {
            await applyProposedEdit({ messageId: message._id });
          }}
          onReject={async () => {
            await rejectProposedEdit({ messageId: message._id });
          }}
          onShowInDoc={showInDoc}
          onReviewOneByOne={message.proposedEdit.replacements &&
          message.proposedEdit.replacements.length > 0 &&
          onReviewReplacements
            ? () =>
                onReviewReplacements(
                  message.proposedEdit!.replacements!,
                  message._id
                )
            : undefined}
          reviewing={reviewingMessageId === message._id}
        />
      {/if}

      <!-- Locate-only references (no edit) — one chip per passage; each jumps to
           and highlights its own occurrence in the document (BNH-25). -->
      {#if !message.proposedEdit && message.references && message.references.length > 0 && showInDoc}
        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span class="inline-flex items-center gap-1 text-xs text-gray-400">
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {message.references.length === 1 ? "Jump to:" : `Jump to (${message.references.length}):`}
          </span>
          {#each message.references as ref, i (i)}
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
    </div>
  {/if}
{/snippet}

<div class="flex h-full flex-col bg-white">
  <!-- Header -->
  <div class="flex shrink-0 items-center gap-2 border-b border-chrome px-5 py-3.5">
    <span class="flex h-6 w-6 items-center justify-center rounded-full bg-navy text-white">
      <ChatIcon class="h-3 w-3" />
    </span>
    <span class="text-sm font-semibold text-navy">Assistant</span>
    {#if onToggleFull}
      <button
        onclick={onToggleFull}
        title={isFull ? "Exit full screen" : "Expand to full screen"}
        class="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
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
    <!-- Intro state — greeting + composer centered (Orbi-style) -->
    <div class="flex flex-1 flex-col items-center justify-center px-6">
      <h2 class="mb-5 text-center text-[19px] font-semibold text-navy">
        How can I help with this report?
      </h2>
      <div class="w-full">{@render composer()}</div>
    </div>
  {:else}
    <!-- Messages — native scroll, pinned to bottom -->
    <div
      bind:this={viewportEl}
      class="flex-1 overflow-y-auto overscroll-y-contain px-5 py-4"
    >
      <div class="space-y-4">
        {#each messagesQ.data ?? [] as m (m._id)}
          {@render messageBubble(m)}
        {/each}
      </div>
    </div>

    <!-- Composer — pinned to the bottom once chatting -->
    <div class="shrink-0 border-t border-chrome px-4 py-3">{@render composer()}</div>
  {/if}
</div>

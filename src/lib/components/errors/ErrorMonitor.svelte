<script lang="ts">
  import { page } from "$app/state";
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { pushBreadcrumb, getBreadcrumbs } from "./breadcrumbs";
  import { APP_ERROR_EVENT, type AppErrorDetail } from "./PageErrorBoundary.svelte";

  type DetectedError = {
    message: string;
    stack?: string;
    source?: string;
  };

  type ModalMode = "auto" | "manual";

  /** Best-effort stringify for console.error arguments. */
  function stringifyArg(a: unknown): string {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.message;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }

  function urlOf(input: unknown): string {
    try {
      if (typeof input === "string") return input;
      if (input instanceof Request) return input.url;
      if (input instanceof URL) return input.toString();
    } catch {
      /* ignore */
    }
    return "request";
  }

  /**
   * App-wide error monitor. Two paths into the same report flow:
   *  1. AUTO — a thrown error / unhandled rejection / console.error pops a red
   *     banner above everything with a "Send error" button.
   *  2. MANUAL — a floating "Flag issue" button (bottom-right) for silent issues
   *     with no error message; captures the recent breadcrumb trail anyway.
   * Either way we ship the full context (message, stack, page, breadcrumbs, UA)
   * plus whatever note the user types, to the errorReports table.
   */
  const reportError = useMutation(api.errorReports.reportError);

  let detected = $state<DetectedError | null>(null);
  let bannerDismissed = $state(false);
  let modalMode = $state<ModalMode | null>(null);
  let flagType = $state<"bug" | "feature">("bug"); // BNH-38
  let note = $state("");
  let sending = $state(false);
  let toast = $state<string | null>(null);
  let noteEl: HTMLTextAreaElement | null = $state(null);

  // ── Breadcrumb: route changes ────────────────────────────────────────────
  $effect(() => {
    const pathname = page.url.pathname;
    if (pathname) pushBreadcrumb({ type: "nav", label: pathname });
  });

  // Focus the note field when the modal opens (replaces React autoFocus).
  $effect(() => {
    if (modalMode) noteEl?.focus();
  });

  // ── Capture errors + breadcrumbs (set up once) ───────────────────────────
  $effect(() => {
    const onError = (e: ErrorEvent) => {
      const message = e.message || "Unknown error";
      const source = e.filename
        ? `${e.filename}:${e.lineno}:${e.colno}`
        : undefined;
      pushBreadcrumb({ type: "error", label: message, detail: source });
      detected = { message, stack: e.error?.stack, source };
      bannerDismissed = false;
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message =
        (reason && (reason.message as string)) ||
        (typeof reason === "string" ? reason : "Unhandled promise rejection");
      pushBreadcrumb({ type: "error", label: message });
      detected = { message, stack: reason?.stack };
      bannerDismissed = false;
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // Patch console.error → breadcrumb + banner (skip framework dev warnings).
    const origConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      origConsoleError(...args);
      const first = typeof args[0] === "string" ? args[0] : "";
      const message = args.map(stringifyArg).join(" ").slice(0, 300);
      pushBreadcrumb({ type: "console", label: message });
      if (!first.startsWith("Warning:") && message.trim()) {
        detected = detected ?? { message };
        bannerDismissed = false;
      }
    };

    // Wrap fetch → record non-OK responses and network failures.
    // Bind to window so calling it bare doesn't trip "Illegal invocation".
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      try {
        const res = await origFetch(...args);
        if (!res.ok) {
          pushBreadcrumb({
            type: "network",
            label: `${res.status} ${res.statusText}`,
            detail: urlOf(args[0]),
          });
        }
        return res;
      } catch (err) {
        pushBreadcrumb({
          type: "network",
          label: `request failed`,
          detail: `${urlOf(args[0])} — ${stringifyArg(err)}`,
        });
        throw err;
      }
    };

    // Render-time crashes, relayed from PageErrorBoundary.
    const onAppError = (e: Event) => {
      const detail = (e as CustomEvent<AppErrorDetail>).detail;
      if (!detail) return;
      detected = {
        message: detail.message,
        stack: detail.stack,
        source: detail.source,
      };
      bannerDismissed = false;
    };
    window.addEventListener(APP_ERROR_EVENT, onAppError);

    // Capture meaningful clicks (buttons / links).
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest(
        "button, a, [role='button'], [role='menuitem']"
      );
      if (!el) return;
      const label =
        el.getAttribute("aria-label") ||
        el.textContent?.trim() ||
        el.tagName.toLowerCase();
      pushBreadcrumb({ type: "click", label: label.slice(0, 80) });
    };
    document.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener(APP_ERROR_EVENT, onAppError);
      document.removeEventListener("click", onClick, true);
      console.error = origConsoleError;
      window.fetch = origFetch;
    };
  });

  function closeModal() {
    modalMode = null;
    note = "";
    flagType = "bug";
  }

  async function submit() {
    if (sending) return;
    sending = true;
    const d = detected;
    const isManual = modalMode === "manual";
    try {
      await reportError({
        kind: isManual ? "manual" : "auto",
        reportType: isManual ? flagType : "bug",
        message: isManual
          ? `(manual ${flagType === "feature" ? "feature request" : "flag"} — no error message)`
          : (d?.message ?? "Unknown error"),
        stack: isManual ? undefined : d?.stack,
        source: isManual ? undefined : d?.source,
        url:
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : "",
        userNote: note.trim() || undefined,
        breadcrumbs: getBreadcrumbs().map((b) => ({
          type: b.type,
          label: b.label,
          detail: b.detail,
          at: b.at,
        })),
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      toast = "Sent. Thanks — we've got the details.";
      detected = null;
      bannerDismissed = false;
      closeModal();
      setTimeout(() => (toast = null), 4000);
    } catch {
      toast = "Couldn't send — please try again.";
      setTimeout(() => (toast = null), 4000);
    } finally {
      sending = false;
    }
  }

  const showBanner = $derived(detected && !bannerDismissed && !modalMode);
  // Snapshot when the modal opens (breadcrumbs aren't reactive state; only
  // rendered inside the modal, so recomputing on open is enough).
  const crumbCount = $derived(modalMode ? getBreadcrumbs().length : 0);
</script>

<!-- ── AUTO: red alert bar above everything ──────────────────────────── -->
{#if showBanner}
  <div class="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
    <span class="flex items-center gap-2 font-medium">
      <svg
        class="h-4 w-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
        />
      </svg>
      We noticed an error.
    </span>
    <button
      onclick={() => (modalMode = "auto")}
      class="rounded-md bg-white px-3 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
    >
      Send error
    </button>
    <button
      onclick={() => (bannerDismissed = true)}
      aria-label="Dismiss"
      class="rounded-md px-1.5 py-1 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
    >
      <svg
        class="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </button>
  </div>
{/if}

<!-- ── MANUAL: floating flag button, bottom-right ────────────────────── -->
<button
  onclick={() => (modalMode = "manual")}
  title="Something off? Flag it so we can take a look."
  class="fixed right-3 top-3 z-[90] flex items-center gap-1 rounded-full bg-navy px-2.5 py-1.5 text-xs font-medium text-white shadow-lg shadow-navy/30 transition-transform hover:scale-105 active:scale-95"
>
  <svg
    class="h-3 w-3"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    stroke-width="2"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5"
    />
  </svg>
  Flag issue
</button>

<!-- ── Shared report modal ───────────────────────────────────────────── -->
{#if modalMode}
  <div
    class="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeModal();
    }}
    onkeydown={(e) => {
      if (e.key === "Escape") closeModal();
    }}
  >
    <div
      class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      role="dialog"
      aria-modal="true"
    >
      <h2 class="text-lg font-semibold text-navy">
        {modalMode === "manual"
          ? flagType === "feature"
            ? "Request a feature"
            : "Flag an issue"
          : "Send this error"}
      </h2>
      <p class="mt-1 text-sm text-gray-500">
        {modalMode === "manual"
          ? flagType === "feature"
            ? "Describe what you'd like the tool to do. It goes to Michael's feature list."
            : "Tell us what went wrong. We'll attach what you were just doing automatically."
          : "We've captured the error and what led up to it. Add anything that helps."}
      </p>

      <!-- BNH-38: bug vs feature selector (manual flags only) -->
      {#if modalMode === "manual"}
        <div class="mt-3 inline-flex rounded-lg border border-gray-200 p-0.5">
          <button
            onclick={() => (flagType = "bug")}
            class={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              flagType === "bug"
                ? "bg-red-500 text-white"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            🐞 Bug
          </button>
          <button
            onclick={() => (flagType = "feature")}
            class={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              flagType === "feature"
                ? "bg-primary text-white"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            ✨ Feature request
          </button>
        </div>
      {/if}

      {#if modalMode === "auto" && detected}
        <div class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <span class="font-mono break-words">
            {detected.message}
          </span>
        </div>
      {/if}

      <textarea
        bind:this={noteEl}
        bind:value={note}
        rows="4"
        placeholder={modalMode === "manual" && flagType === "feature"
          ? "What would you like it to do? e.g. “add a button to…”"
          : "Anything else you want to add? e.g. what you were trying to do…"}
        class="mt-3 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-navy placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      ></textarea>

      <p class="mt-2 text-xs text-gray-400">
        Attaching: this page, your recent activity ({crumbCount} step{crumbCount === 1 ? "" : "s"}){modalMode === "auto" ? ", and the error details" : ""}.
      </p>

      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          onclick={closeModal}
          disabled={sending}
          class="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onclick={submit}
          disabled={sending}
          class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {#if sending}
            <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
          {/if}
          {modalMode === "manual"
            ? flagType === "feature"
              ? "Send feature request"
              : "Send flag"
            : "Send error"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Confirmation toast ────────────────────────────────────────────── -->
{#if toast}
  <div class="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded-full bg-navy px-4 py-2 text-sm text-white shadow-xl">
    {toast}
  </div>
{/if}

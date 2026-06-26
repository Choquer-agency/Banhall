"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { pushBreadcrumb, getBreadcrumbs } from "./breadcrumbs";
import { APP_ERROR_EVENT, type AppErrorDetail } from "./PageErrorBoundary";

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
export function ErrorMonitor() {
  const reportError = useMutation(api.errorReports.reportError);
  const pathname = usePathname();

  const [detected, setDetected] = useState<DetectedError | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Keep the latest detected error available to the submit handler without
  // making it a dependency that re-subscribes listeners.
  const detectedRef = useRef<DetectedError | null>(null);
  detectedRef.current = detected;

  // ── Breadcrumb: route changes ────────────────────────────────────────────
  useEffect(() => {
    if (pathname) pushBreadcrumb({ type: "nav", label: pathname });
  }, [pathname]);

  // ── Capture errors + breadcrumbs (set up once) ───────────────────────────
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const message = e.message || "Unknown error";
      const source = e.filename
        ? `${e.filename}:${e.lineno}:${e.colno}`
        : undefined;
      pushBreadcrumb({ type: "error", label: message, detail: source });
      setDetected({ message, stack: e.error?.stack, source });
      setBannerDismissed(false);
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message =
        (reason && (reason.message as string)) ||
        (typeof reason === "string" ? reason : "Unhandled promise rejection");
      pushBreadcrumb({ type: "error", label: message });
      setDetected({ message, stack: reason?.stack });
      setBannerDismissed(false);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // Patch console.error → breadcrumb + banner (skip React dev warnings).
    const origConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      origConsoleError(...args);
      const first = typeof args[0] === "string" ? args[0] : "";
      const message = args.map(stringifyArg).join(" ").slice(0, 300);
      pushBreadcrumb({ type: "console", label: message });
      if (!first.startsWith("Warning:") && message.trim()) {
        setDetected((prev) => prev ?? { message });
        setBannerDismissed(false);
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
      setDetected({
        message: detail.message,
        stack: detail.stack,
        source: detail.source,
      });
      setBannerDismissed(false);
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
  }, []);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setNote("");
  }, []);

  const submit = useCallback(async () => {
    if (sending) return;
    setSending(true);
    const d = detectedRef.current;
    const isManual = modalMode === "manual";
    try {
      await reportError({
        kind: isManual ? "manual" : "auto",
        message: isManual
          ? "(manual flag — no error message)"
          : d?.message ?? "Unknown error",
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
      setToast("Sent. Thanks — we've got the details.");
      setDetected(null);
      setBannerDismissed(false);
      closeModal();
      setTimeout(() => setToast(null), 4000);
    } catch {
      setToast("Couldn't send — please try again.");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSending(false);
    }
  }, [sending, modalMode, note, reportError, closeModal]);

  const showBanner = detected && !bannerDismissed && !modalMode;
  const crumbCount = getBreadcrumbs().length;

  return (
    <>
      {/* ── AUTO: red alert bar above everything ──────────────────────────── */}
      {showBanner && (
        <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          <span className="flex items-center gap-2 font-medium">
            <svg
              className="h-4 w-4 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            We noticed an error.
          </span>
          <button
            onClick={() => setModalMode("auto")}
            className="rounded-md bg-white px-3 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
          >
            Send error
          </button>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
            className="rounded-md px-1.5 py-1 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* ── MANUAL: floating flag button, bottom-right ────────────────────── */}
      <button
        onClick={() => setModalMode("manual")}
        title="Something off? Flag it so we can take a look."
        className="fixed right-3 top-3 z-[90] flex items-center gap-1 rounded-full bg-navy px-2.5 py-1.5 text-xs font-medium text-white shadow-lg shadow-navy/30 transition-transform hover:scale-105 active:scale-95"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5"
          />
        </svg>
        Flag issue
      </button>

      {/* ── Shared report modal ───────────────────────────────────────────── */}
      {modalMode && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-navy">
              {modalMode === "manual" ? "Flag an issue" : "Send this error"}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {modalMode === "manual"
                ? "Tell us what went wrong. We'll attach what you were just doing automatically."
                : "We've captured the error and what led up to it. Add anything that helps."}
            </p>

            {modalMode === "auto" && detected && (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                <span className="font-mono break-words">
                  {detected.message}
                </span>
              </div>
            )}

            <textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Anything else you want to add? e.g. what you were trying to do…"
              className="mt-3 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-navy placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />

            <p className="mt-2 text-xs text-gray-400">
              Attaching: this page, your recent activity ({crumbCount} step
              {crumbCount === 1 ? "" : "s"})
              {modalMode === "auto" ? ", and the error details" : ""}.
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={closeModal}
                disabled={sending}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={sending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
              >
                {sending && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {modalMode === "manual" ? "Send flag" : "Send error"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation toast ────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded-full bg-navy px-4 py-2 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}
    </>
  );
}

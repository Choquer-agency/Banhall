"use client";

import { Component, ReactNode } from "react";
import { pushBreadcrumb } from "./breadcrumbs";

/** Event ErrorMonitor listens for so it can surface render-time crashes. */
export const APP_ERROR_EVENT = "banhall:apperror";

export type AppErrorDetail = {
  message: string;
  stack?: string;
  source?: string;
};

/**
 * Catches render-time crashes in the page tree so they don't blank the app.
 * On catch it shows a small recovery card AND dispatches an event that the
 * (still-mounted, sibling) ErrorMonitor picks up to show the "Send error"
 * banner — so a page crash flows into the same reporting path as everything
 * else.
 */
export class PageErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    pushBreadcrumb({ type: "error", label: error.message });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<AppErrorDetail>(APP_ERROR_EVENT, {
          detail: { message: error.message, stack: error.stack },
        })
      );
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-20 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-6 w-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <p className="font-medium text-navy">Something broke on this page.</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Use the red “Send error” bar at the top to report it — we&apos;ll get
            everything we need to fix it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-light"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

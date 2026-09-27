/**
 * Audit wave 2: a paid AI action refused by its hourly or daily limit
 * (RATE_LIMITED, with retryAfter) shows the server's plain message where
 * the writer clicked, and the Convex client's log line of the refusal does
 * not raise the crash toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import ErrorMonitor from "./errors/ErrorMonitor.svelte";
import QAScorePanel from "./editor/QAScorePanel.svelte";
import PdReviewReport from "./review-pd/PdReviewReport.svelte";
import PdReviewStart from "./review-pd/PdReviewStart.svelte";
import ScienceCodeField from "./project/ScienceCodeField.svelte";

const sonner = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

const MESSAGE = "You have started a lot of runs in the last hour. Try again in 5 minutes.";
const limited = () => new ConvexError({ code: "RATE_LIMITED", message: MESSAGE, retryAfter: 300 });

/** The Convex client's log line for the refused call, as it writes it before the caller's catch. */
function convexLog(path: string, kind: "M" | "A") {
  return `[CONVEX ${kind}(${path})] [Request ID: 7c1e] Server Error\nUncaught ConvexError: ${JSON.stringify({
    code: "RATE_LIMITED",
    message: MESSAGE,
    retryAfter: 300,
  })}\n    at handler (../convex/lib/aiRateLimits.ts:120:3)`;
}

const crashToasts = () => sonner.error.mock.calls.filter(([text]) => text === "We noticed an error.");

let quiet: ReturnType<typeof vi.spyOn>;
let unmountMonitor: () => void;

beforeEach(async () => {
  __resetPage();
  __resetConvexStub();
  __setPageUrl("/project/p-1");
  for (const fn of Object.values(sonner)) fn.mockClear();
  quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  ({ unmount: unmountMonitor } = await render(ErrorMonitor));
});

afterEach(() => {
  // ErrorMonitor hands console.error back before the spy goes.
  unmountMonitor();
  quiet.mockRestore();
  vi.restoreAllMocks();
});

describe("RATE_LIMITED refusals", () => {
  it("never raise the crash toast from a mutation or an action log line", () => {
    console.error(convexLog("generations:requestGeneration", "M"));
    console.error(convexLog("seeds:regenerate", "M"));
    console.error(convexLog("scienceCodeSuggestions:suggest", "A"));
    console.error(convexLog("ai/styleAnalysis:analyzeMyInstructions", "A"));
    expect(crashToasts()).toHaveLength(0);
  });

  it("QA panel: Run QA scorecard shows the message in the panel", async () => {
    __setQueryData("users:getCurrentUser", { role: "consultant" });
    __setQueryData("reviews:getMyWriterReview", null);
    __setQueryData("reviews:getMyQaItemFeedback", []);
    const onRunQa = vi.fn(async () => {
      console.error(convexLog("generations:requestReportQa", "M"));
      throw limited();
    });
    const { container } = await render(QAScorePanel, { onRunQa });
    const run = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Run QA scorecard"));
    run!.click();
    await expect.poll(() => container.querySelector("[data-qa-run-error]")?.textContent).toBe(MESSAGE);
    expect(container.querySelector("[data-qa-run-error]")?.getAttribute("role")).toBe("alert");
    expect(onRunQa).toHaveBeenCalledTimes(1);
    expect(crashToasts()).toHaveLength(0);
  });

  it("PD review: Retry review shows the message under the button, not a toast", async () => {
    __setQueryData("pdReviews:listPdReviewEvents", []);
    __setMutationError("pdReviews:retryPdReview", limited());
    const { container } = await render(PdReviewReport, {
      review: {
        _id: "review-1" as Id<"pdReviews">,
        projectId: "project-1" as Id<"projects">,
        documentId: "document-1" as Id<"projectDocuments">,
        sourceFileName: "pd.txt",
        status: "failed",
        error: "The review could not finish.",
        createdAt: 1,
      },
      hasTranscript: false,
      onGenerate: () => {},
    });
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Retry review"));
    retry!.click();
    await expect.poll(() => container.querySelector("[data-pd-review-retry-error]")?.textContent).toBe(MESSAGE);
    expect(__mutationCalls("pdReviews:retryPdReview")).toEqual([{ reviewId: "review-1" }]);
    expect(sonner.error).not.toHaveBeenCalled();
  });

  it("PD review: Start review shows the message inline", async () => {
    __setQueryData("pdReviews:getReviewSourceDocument", {
      _id: "document-1",
      fileName: "pd.txt",
      hasText: true,
    });
    __setMutationError("pdReviews:startPdReview", limited());
    const { container } = await render(PdReviewStart, { projectId: "project-1" as Id<"projects"> });
    container.querySelector<HTMLButtonElement>("[data-start-pd-review]")!.click();
    await expect.poll(() => container.querySelector('[data-pd-review-start] [role="alert"]')?.textContent?.trim()).toBe(MESSAGE);
    expect(sonner.error).not.toHaveBeenCalled();
  });

  it("science code: AI Suggests says why it did not suggest", async () => {
    __setMutationError("scienceCodeSuggestions:suggest", limited());
    const { container } = await render(ScienceCodeField, {
      projectId: "project-1" as Id<"projects">,
      scienceCode: null,
    });
    const suggest = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("AI Suggests"));
    suggest!.click();
    await expect.poll(() => container.textContent).toContain(MESSAGE);
    expect(__mutationCalls("projects:updateProjectScienceCode")).toEqual([]);
  });
});

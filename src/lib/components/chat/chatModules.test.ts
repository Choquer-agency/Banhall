import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Id } from "../../../../convex/_generated/dataModel";
import { PREWARM_HOLD_MS, prewarmAssistant, releaseAssistantPrewarm } from "./chatModules";

type Sub = { name: string; args: unknown; callback: (data: unknown) => void; onError?: (e: Error) => void; live: boolean };

function fakeClient() {
  const subs: Sub[] = [];
  const client = {
    onUpdate(query: FunctionReference<"query">, args: unknown, callback: (data: unknown) => void, onError?: (e: Error) => void) {
      const sub = { name: getFunctionName(query), args, callback, onError, live: true };
      subs.push(sub);
      return () => {
        sub.live = false;
      };
    },
  };
  const live = () => subs.filter((sub) => sub.live).map((sub) => sub.name);
  return { client: client as never, subs, live };
}

const reportId = "report-1" as Id<"reports">;

describe("prewarmAssistant", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    releaseAssistantPrewarm();
    vi.useRealTimers();
  });

  it("subscribes to what the panel reads first, then the newest conversation's proposals", () => {
    const { client, subs, live } = fakeClient();
    prewarmAssistant(client, reportId);
    expect(live()).toEqual(["chatV2:listThreads", "research:listSessions"]);
    subs[0].callback([{ agentThreadId: "thread-9" }, { agentThreadId: "thread-1" }]);
    expect(live()).toContain("chatV2:listProposals");
    expect(subs.find((sub) => sub.name === "chatV2:listProposals")?.args).toEqual({ threadId: "thread-9" });
    // The same newest conversation again adds nothing.
    subs[0].callback([{ agentThreadId: "thread-9" }]);
    expect(subs.filter((sub) => sub.name === "chatV2:listProposals")).toHaveLength(1);
  });

  it("starts once per report while held, and releases everything after the hold", () => {
    const { client, live } = fakeClient();
    prewarmAssistant(client, reportId);
    prewarmAssistant(client, reportId);
    expect(live()).toHaveLength(2);
    vi.advanceTimersByTime(PREWARM_HOLD_MS);
    expect(live()).toHaveLength(0);
    prewarmAssistant(client, reportId);
    expect(live()).toHaveLength(2);
  });

  it("handles every early subscription's errors itself, so none becomes an unhandled rejection", () => {
    const { client, subs } = fakeClient();
    prewarmAssistant(client, reportId);
    subs[0].callback([{ agentThreadId: "thread-9" }]);
    expect(subs).toHaveLength(3);
    for (const sub of subs) expect(typeof sub.onError).toBe("function");
  });

  it("subscribes to nothing for a report with no conversations beyond the two lists", () => {
    const { client, subs, live } = fakeClient();
    prewarmAssistant(client, reportId);
    subs[0].callback([]);
    expect(live()).toEqual(["chatV2:listThreads", "research:listSessions"]);
  });
});

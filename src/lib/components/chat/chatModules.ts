/**
 * The Assistant's code and first data, started on intent (2026-10-06).
 * A project opens with the Assistant closed, so its first open was a cold
 * load: about 98 KB of code, then the conversation list, then the newest
 * conversation, one round trip after another. A pointer resting on, a finger
 * touching or the keyboard focusing the Assistant toggle starts both, so the
 * click opens a panel whose code and conversation list are already here.
 * Pages where nobody reaches for the Assistant load none of it.
 *
 * The loader lives in a module, not inline in markup, so Vite's dependency
 * scan sees the import (a cold dev cache otherwise stalls the first open).
 */
import type { ConvexClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { loadOnce } from "$lib/components/project/projectPageModules";

export const loadAgentChatPanel = loadOnce(() => import("./AgentChatPanel.svelte"));

/** How long an early subscription is held for a panel that may open. */
export const PREWARM_HOLD_MS = 30_000;

type WarmClient = Pick<ConvexClient, "onUpdate">;
type Release = () => void;

const warming = new Map<string, Release>();

/**
 * Subscribes to the queries the Assistant reads first, so the panel's own
 * identical subscriptions start with data (the Convex client shares them).
 * These are the same public, access-checked queries the panel runs on open:
 * an early start fetches nothing the viewer could not already read. Held
 * for PREWARM_HOLD_MS, then released; repeated intent for the same report
 * while held is free.
 */
export function prewarmAssistant(
  client: WarmClient,
  reportId: Id<"reports">,
  holdMs = PREWARM_HOLD_MS
): void {
  if (warming.has(reportId)) return;
  const noop = () => undefined;
  // Errors are the panel's to show: its own subscription to the same query
  // reports them inline. Without a handler the client raises an unhandled
  // rejection, which the error monitor turns into a banner.
  const quiet = () => undefined;
  const subscriptions: Array<() => void> = [];
  const hold = (unsubscribe: unknown) => {
    if (typeof unsubscribe === "function") subscriptions.push(unsubscribe as () => void);
  };
  let proposalsFor: string | null = null;
  hold(
    client.onUpdate(api.chatV2.listThreads, { reportId }, (threads) => {
      // The panel opens the newest conversation; its proposals load with it.
      const newest = threads[0]?.agentThreadId ?? null;
      if (!newest || newest === proposalsFor) return;
      proposalsFor = newest;
      hold(client.onUpdate(api.chatV2.listProposals, { threadId: newest }, noop, quiet));
    }, quiet)
  );
  hold(client.onUpdate(api.research.listSessions, { reportId }, noop, quiet));
  const timer = setTimeout(release, holdMs);
  function release() {
    clearTimeout(timer);
    warming.delete(reportId);
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  }
  warming.set(reportId, release);
}

/** Drops every early subscription (tests, and a page that goes away). */
export function releaseAssistantPrewarm(): void {
  for (const release of [...warming.values()]) release();
}

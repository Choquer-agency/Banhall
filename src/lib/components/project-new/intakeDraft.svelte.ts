/**
 * New project's private intake draft, browser side (decision 65, stage 2).
 * The page hands over what it has read (`reconcile`); this saves each
 * transcript and document to the draft a moment after it changes, uploads
 * its original file once the text is saved, and keeps a truthful receipt of
 * both, so a file that failed to save is never dropped from view. The
 * client name, interviewer and interviewees follow, and the start dialog's
 * leave-out list while it is open, and how many files are still being read
 * or saved, so the head start waits for them. Confirming flushes what is
 * still on its way and promotes the draft into the project.
 *
 * A draft the server no longer has (it expired, another tab discarded it)
 * ends here too: nothing more is sent, its receipts go, and confirming
 * takes the old path. Only the draft's opaque id is kept in session
 * storage, never its text.
 *
 * A reload brings the draft back (2026-09-27, fourth): the tab that holds
 * a draft holds a Web Lock named after it for as long as the page lives, so
 * a reloaded page (whose old page let go of the lock) claims it and picks
 * the draft up, while a second tab that copied the id (Duplicate tab) finds
 * the lock taken, forgets the id and starts its own draft. Another tab's
 * live draft is never discarded or written to.
 */
import { SvelteMap } from "svelte/reactivity";
import { untrack } from "svelte";
import type { FunctionReference } from "convex/server";
import type { Id } from "../../../../convex/_generated/dataModel";
import { intakeDraftRefs } from "../../../../convex/lib/intakeDraftRefs";
import { userErrorCode, userErrorMessage } from "$lib/errors";
import type { IntakeSourceDesc } from "./intakePlan";

/** Session storage key of the open draft's id. */
export const INTAKE_DRAFT_STORAGE_KEY = "banhall:intake-draft";
/** A source is saved this long after its last change. */
export const SOURCE_SAVE_DELAY_MS = 300;
/** The names are saved this long after the writer stops typing. */
export const CONTEXT_SAVE_DELAY_MS = 600;
/**
 * How often a count of files still being read is sent again while it is
 * above zero (2026-09-27, second): the server stops counting one not
 * refreshed for 90 seconds, so a closed tab never holds the head start.
 */
export const PENDING_READS_REFRESH_MS = 30_000;
/** How often a confirm asks whether the project is set up. */
export const PROMOTION_POLL_MS = 1_000;
/**
 * Promotion steps a confirm waits for before it opens the project anyway:
 * about 3.5 minutes, longer than the server's 3-minute wait for turn builds.
 */
export const MAX_PROMOTION_STEPS = 210;
/** After that, the start is finished in the background for this long. */
export const BACKGROUND_PROMOTION_MS = 30 * 60 * 1000;

/** How long a reloaded page waits for the lock its old page held to be let go. */
export const LEFTOVER_LOCK_WAIT_MS = 1_500;

/** The Web Lock a page holds for the draft it owns. */
export function intakeDraftLockName(draftId: string): string {
  return `banhall:intake-draft:${draftId}`;
}

/**
 * Holds a Web Lock until the returned release is called, waiting at most
 * `waitMs` for it. Null when another page holds it that long, or when the
 * browser has no Web Locks (then a reload cannot tell itself from a second
 * tab, so nothing is picked up).
 */
export type HoldLock = (name: string, waitMs: number) => Promise<(() => void) | null>;

export const holdWebLock: HoldLock = async (name, waitMs) => {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return null;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  return await new Promise<(() => void) | null>((resolve) => {
    locks
      .request(name, { signal: AbortSignal.timeout(waitMs) }, async () => {
        resolve(release);
        await held;
      })
      .catch(() => resolve(null));
  });
};

/** A draft a reload brings back: its saved sources, names and leave-out list. */
export type RestoredDraft = {
  draftId: Id<"intakeDrafts">;
  sources: IntakeSourceDesc[];
  context: IntakeContext;
  selection: string[];
};

/** The polling a new sync uses unless told otherwise; component tests shorten it. */
export const intakePolling = { pollMs: PROMOTION_POLL_MS, maxSteps: MAX_PROMOTION_STEPS };

export type SaveState = "saving" | "saved" | "failed";
export type OriginalState = "uploading" | "saved" | "failed";

export type IntakeContext = {
  clientName: string;
  interviewerUserId?: Id<"users">;
  interviewees: string[];
};

export type PromotionReceipt = {
  projectId: Id<"projects">;
  complete: boolean;
  sources: Array<{
    sourceKey: string;
    kind: "transcript" | "document";
    transcriptId?: Id<"transcripts">;
    projectDocumentId?: Id<"projectDocuments">;
  }>;
};

/**
 * What a confirm came to: the project, complete; the project, still being
 * set up after every poll (open it and say so); or a draft that ended
 * before any project was made (take the old path).
 */
export type PromotionOutcome =
  | { kind: "complete"; receipt: PromotionReceipt }
  | { kind: "pending"; receipt: PromotionReceipt }
  | { kind: "ended" };

type Call<Ref> = Ref extends FunctionReference<"mutation", "public", infer Args, infer Result>
  ? (args: Args) => Promise<Result>
  : never;

/** The draft's mutations, as `useMutation` gives them, and the release of an unused upload. */
export type IntakeCalls = {
  [Name in
    | "createIntakeDraft"
    | "saveIntakeSource"
    | "removeIntakeSource"
    | "attachIntakeOriginal"
    | "updateIntakeContext"
    | "setIntakeSelection"
    | "reportIntakePendingReads"
    | "discardIntakeDraft"
    | "promoteIntakeDraft"]: Call<(typeof intakeDraftRefs)[Name]>;
};

/** The mutation references the page binds with `useMutation`. */
export const INTAKE_MUTATIONS = [
  "createIntakeDraft",
  "saveIntakeSource",
  "removeIntakeSource",
  "attachIntakeOriginal",
  "updateIntakeContext",
  "setIntakeSelection",
  "reportIntakePendingReads",
  "discardIntakeDraft",
  "promoteIntakeDraft",
] as const;

function sameSource(a: IntakeSourceDesc, b: IntakeSourceDesc): boolean {
  return (
    a.kind === b.kind &&
    a.position === b.position &&
    a.label === b.label &&
    a.content === b.content &&
    a.sourceFormat === b.sourceFormat &&
    a.fileType === b.fileType &&
    a.category === b.category &&
    a.intake === b.intake &&
    a.extractionOutcome === b.extractionOutcome &&
    (a.file ?? null) === (b.file ?? null)
  );
}

/** Hex SHA-256 of a text, as the server hashes a source's text. */
export async function textHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether a failed call says the draft is gone (expired, discarded, another tab). */
function draftGone(error: unknown): boolean {
  return userErrorCode(error) === "INTAKE_DRAFT_GONE";
}

export class IntakeDraftSync {
  /** The draft, once the first readable file made one. */
  draftId = $state<Id<"intakeDrafts"> | null>(null);
  /** Per source key: its text is saving, saved, or failed to save. */
  receipts = new SvelteMap<string, SaveState>();
  /** Per source key: its original file is uploading, saved, or failed. */
  originals = new SvelteMap<string, OriginalState>();
  /** Per source key: why its text could not be saved, in plain words (a cap). */
  messages = new SvelteMap<string, string>();
  /** Why no draft is kept this time (the day's draft cap), in plain words. */
  notice = $state<string | null>(null);
  /** Promoted, discarded or gone: no more text is sent. */
  closed = $state(false);
  /** Discarded or gone (not promoted): no original is attached any more either. */
  #ended = false;

  #calls: IntakeCalls;
  #storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  #uploadOriginal: (file: File) => Promise<Id<"_storage"> | undefined>;
  #claimUpload: (storageId: Id<"_storage">) => Promise<unknown>;
  #releaseUpload: (storageId: Id<"_storage">) => Promise<unknown>;
  #delayMs: number;
  #pollMs: number;
  #maxSteps: number;
  #creating: Promise<Id<"intakeDrafts"> | null> | null = null;
  #wanted = new Map<string, IntakeSourceDesc>();
  #sent = new Map<string, IntakeSourceDesc>();
  #attempted = new Map<string, IntakeSourceDesc>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #inflight = new Map<string, Promise<void>>();
  #originalsTried = new Map<string, File>();
  #originalUploads = new Set<Promise<void>>();
  #context: IntakeContext | null = null;
  #contextSent = "";
  #contextTimer: ReturnType<typeof setTimeout> | null = null;
  #selection: string[] = [];
  #selectionSent = "";
  #selectionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set once a confirm starts promoting: the leave-out list is no longer sent. */
  #promoting = false;
  /** Files the page is still reading: by source key, and those without one yet. */
  #readingKeys: string[] = [];
  #readingUnkeyed = 0;
  /** The count of files still being read or saved, as last sent. */
  #pendingSent = 0;
  #pendingTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingRefresh: ReturnType<typeof setInterval> | null = null;
  /** The page is gone: no timer is set and nothing is sent any more. */
  #disposed = false;
  #refreshMs: number;
  #holdLock: HoldLock;
  /** Lets go of the draft's lock (the page is gone, or the draft ended). */
  #releaseLock: (() => void) | null = null;
  /** A reload's pick-up still on its way: a new draft is not made meanwhile. */
  #restoring: Promise<unknown> | null = null;

  constructor(options: {
    calls: IntakeCalls;
    uploadOriginal: (file: File) => Promise<Id<"_storage"> | undefined>;
    /** Claims a fresh upload as the caller's, so only they may release it. */
    claimUpload?: (storageId: Id<"_storage">) => Promise<unknown>;
    /** Deletes the caller's own claimed upload that no row will hold. */
    releaseUpload?: (storageId: Id<"_storage">) => Promise<unknown>;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    delayMs?: number;
    /** Test seams: how often, and how many times, a confirm polls the promotion. */
    pollMs?: number;
    maxPromotionSteps?: number;
    /** Test seam: how often a count above zero is sent again. */
    refreshMs?: number;
    /** Test seam: the lock that tells a reload from a second tab. */
    holdLock?: HoldLock;
  }) {
    this.#calls = options.calls;
    this.#uploadOriginal = options.uploadOriginal;
    this.#claimUpload = options.claimUpload ?? (async () => undefined);
    this.#releaseUpload = options.releaseUpload ?? (async () => undefined);
    this.#storage = options.storage ?? null;
    this.#delayMs = options.delayMs ?? SOURCE_SAVE_DELAY_MS;
    this.#pollMs = options.pollMs ?? intakePolling.pollMs;
    this.#maxSteps = options.maxPromotionSteps ?? intakePolling.maxSteps;
    this.#refreshMs = options.refreshMs ?? PENDING_READS_REFRESH_MS;
    this.#holdLock = options.holdLock ?? holdWebLock;
  }

  /**
   * The draft an earlier page of this tab left open (a reload), claimed for
   * this page: its id once this page holds its lock, or null. A second tab
   * that copied the id finds the lock held by the page that owns the draft:
   * it forgets the id and starts its own draft later, touching nothing.
   */
  async claimLeftover(): Promise<Id<"intakeDrafts"> | null> {
    const leftover = this.#readStorage();
    if (!leftover || this.draftId) return null;
    const release = await this.#holdLock(intakeDraftLockName(leftover), LEFTOVER_LOCK_WAIT_MS);
    if (!release || this.#disposed || this.closed || this.draftId) {
      release?.();
      // Another page owns it (or this one ended first): never ours to touch.
      if (!release) this.#removeStorage();
      return null;
    }
    this.#releaseLock = release;
    return leftover;
  }

  /** A claimed leftover that is not picked up: let go of it, and discard it when asked. */
  dropClaimed(draftId: Id<"intakeDrafts">, options: { discard: boolean }): void {
    this.#releaseLock?.();
    this.#releaseLock = null;
    this.#removeStorage();
    if (options.discard) void this.#calls.discardIntakeDraft({ draftId }).catch(() => undefined);
  }

  /** New drafts wait for a reload's pick-up still on its way. */
  holdUntil(pending: Promise<unknown>): void {
    this.#restoring = pending.finally(() => {
      if (this.#restoring === pending) this.#restoring = null;
    });
  }

  /**
   * Picks the claimed draft up again: its saved sources count as saved (the
   * page lists the same ones, so nothing is sent again), and its names and
   * leave-out list as sent. Call it in the same step the page brings its
   * state back, so the draft never sees the page without them.
   */
  adopt(restored: RestoredDraft): void {
    if (this.closed || this.draftId) return;
    this.draftId = restored.draftId;
    this.#writeStorage(restored.draftId);
    untrack(() => {
      for (const desc of restored.sources) {
        this.#wanted.set(desc.sourceKey, desc);
        this.#sent.set(desc.sourceKey, desc);
        this.#attempted.set(desc.sourceKey, desc);
        this.receipts.set(desc.sourceKey, "saved");
      }
    });
    this.#context = restored.context;
    this.#contextSent = JSON.stringify(restored.context);
    this.#selection = [...restored.selection].sort();
    this.#selectionSent = JSON.stringify(this.#selection);
  }

  /** Brings the draft in line with what the page has read. */
  reconcile(desired: readonly IntakeSourceDesc[]): void {
    if (this.closed) return;
    // The receipts are this class's own bookkeeping: reading them here
    // must not make the page's effect depend on them.
    untrack(() => {
      this.#reconcile(desired);
      this.#pendingChanged();
    });
  }

  #reconcile(desired: readonly IntakeSourceDesc[]): void {
    const keys = new Set(desired.map((desc) => desc.sourceKey));
    for (const desc of desired) {
      this.#wanted.set(desc.sourceKey, desc);
      const sent = this.#sent.get(desc.sourceKey);
      if (sent && sameSource(sent, desc)) {
        if (this.receipts.get(desc.sourceKey) !== "saved" && !this.#timers.has(desc.sourceKey)) {
          this.receipts.set(desc.sourceKey, "saved");
        }
        continue;
      }
      // A save that failed is tried again only by the writer or on confirm.
      const attempted = this.#attempted.get(desc.sourceKey);
      if (attempted && sameSource(attempted, desc) && this.receipts.get(desc.sourceKey) === "failed") continue;
      if (this.#timers.has(desc.sourceKey) || (attempted && sameSource(attempted, desc) && this.#inflight.has(desc.sourceKey))) continue;
      this.receipts.set(desc.sourceKey, "saving");
      this.#timers.set(
        desc.sourceKey,
        setTimeout(() => void this.#save(desc.sourceKey), this.#delayMs)
      );
    }
    for (const key of [...this.#wanted.keys()]) {
      if (keys.has(key)) continue;
      this.#wanted.delete(key);
      const timer = this.#timers.get(key);
      if (timer) clearTimeout(timer);
      this.#timers.delete(key);
      this.receipts.delete(key);
      this.originals.delete(key);
      if (this.#sent.has(key) || this.#attempted.has(key)) void this.#remove(key);
    }
  }

  /** The writer's Try again on a file that failed to save. */
  retry(sourceKey: string): void {
    if (this.closed || !this.#wanted.has(sourceKey)) return;
    if (this.receipts.get(sourceKey) === "failed") {
      this.receipts.set(sourceKey, "saving");
      void this.#save(sourceKey);
      return;
    }
    if (this.originals.get(sourceKey) === "failed") {
      this.#originalsTried.delete(sourceKey);
      const desc = this.#sent.get(sourceKey);
      if (desc) this.#maybeUploadOriginal(sourceKey, desc);
    }
  }

  /** The names the placeholders and speaker rules read. */
  setContext(context: IntakeContext): void {
    this.#context = context;
    if (this.closed || !this.draftId) return;
    if (JSON.stringify(context) === this.#contextSent) return;
    if (this.#contextTimer) clearTimeout(this.#contextTimer);
    this.#contextTimer = setTimeout(() => void this.#sendContext(), CONTEXT_SAVE_DELAY_MS);
  }

  /**
   * Files the page is still reading (2026-09-27, second): the keys of those
   * that have a source key, and how many have none yet (a transcript file
   * being parsed). With the files read but not saved yet, less the ones the
   * writer unticked in the start dialog, this is the count the draft's
   * head start waits on.
   */
  setReading(reading: { keys: readonly string[]; unkeyed: number }): void {
    this.#readingKeys = [...reading.keys];
    this.#readingUnkeyed = Math.max(0, reading.unkeyed);
    untrack(() => this.#pendingChanged());
  }

  /** Files still being read, or read and not saved, that the writer has not unticked. */
  get pendingReads(): number {
    return untrack(() => {
      const leftOut = new Set(this.#selection);
      const keys = new Set(this.#readingKeys);
      for (const [key, state] of this.receipts) if (state === "saving") keys.add(key);
      let count = this.#readingUnkeyed;
      for (const key of keys) if (!leftOut.has(key)) count += 1;
      return count;
    });
  }

  /** The start dialog's leave-out list, by source key. */
  setSelection(excludedSourceKeys: string[]): void {
    this.#selection = [...excludedSourceKeys].sort();
    untrack(() => this.#pendingChanged());
    if (this.closed || this.#promoting || !this.draftId) return;
    if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
    this.#selectionTimer = setTimeout(() => void this.#sendSelection(), this.#delayMs);
  }

  /**
   * Sends what is still waiting, tries a failed text save once more and
   * returns the source keys whose text is not saved.
   */
  async flush(): Promise<Set<string>> {
    for (const [key, timer] of this.#timers) {
      clearTimeout(timer);
      this.#timers.delete(key);
      void this.#save(key);
    }
    if (this.#contextTimer) {
      clearTimeout(this.#contextTimer);
      this.#contextTimer = null;
      await this.#sendContext();
    }
    // The promotion carries the leave-out list itself (its source keys), so
    // a choice still waiting is dropped, not sent: sent after the promotion
    // it finds the draft gone (live test 2026-09-26).
    if (this.#selectionTimer) {
      clearTimeout(this.#selectionTimer);
      this.#selectionTimer = null;
    }
    await Promise.all([...this.#inflight.values()]);
    const failed = [...this.#wanted.keys()].filter((key) => this.receipts.get(key) !== "saved");
    await Promise.all(failed.map((key) => this.#save(key)));
    return new Set([...this.#wanted.keys()].filter((key) => this.receipts.get(key) !== "saved"));
  }

  /**
   * Confirm: the draft becomes the project. A first call that fails made no
   * project, and throws so the page takes the old path. From the first
   * receipt on the project exists: later steps are polled, a failing step is
   * polled again, and after every poll the page opens that project either
   * way; the page never falls back to making another project.
   */
  async promote(
    args: {
      commandId: string;
      sourceKeys: string[];
      project: Parameters<IntakeCalls["promoteIntakeDraft"]>[0]["project"];
    },
    options: { confirmSelection?: string[] } = {}
  ): Promise<PromotionOutcome> {
    const draftId = this.draftId;
    if (!draftId) throw new Error("No intake draft to promote");
    this.#promoting = true;
    if (this.#selectionTimer) {
      clearTimeout(this.#selectionTimer);
      this.#selectionTimer = null;
    }
    // The promotion clears the count on the server; nothing more is sent.
    this.#stopPending();
    // A Step-by-step start (2026-09-27, fourth): the final leave-out list
    // goes just before the promotion, while the draft is still open (the
    // client keeps the order), so a head start still queued goes at once and
    // the promotion carries it to the project.
    if (options.confirmSelection) {
      const excludedSourceKeys = [...options.confirmSelection].sort();
      void this.#calls
        .setIntakeSelection({ draftId, excludedSourceKeys, confirm: true })
        .catch((error: unknown) => console.error("Could not send the file choice at Start", error));
    }
    const call = () => this.#calls.promoteIntakeDraft({ draftId, ...args });
    let first: Awaited<ReturnType<typeof call>>;
    try {
      first = await call();
    } catch (error) {
      if (draftGone(error)) this.#die();
      throw error;
    }
    if ("ended" in first) {
      this.#die();
      return { kind: "ended" };
    }
    // No more text goes to a draft that is becoming the project.
    this.closed = true;
    let receipt: PromotionReceipt = first;
    for (let step = 0; !receipt.complete && step < this.#maxSteps; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, this.#pollMs));
      try {
        const next = await call();
        if ("ended" in next) return { kind: "pending", receipt };
        receipt = next;
      } catch {
        // A failing step is asked again; the project stays the same one.
      }
    }
    this.#removeStorage();
    this.#releaseLock?.();
    this.#releaseLock = null;
    return receipt.complete ? { kind: "complete", receipt } : { kind: "pending", receipt };
  }

  /**
   * Keeps asking a promotion that outlasted the confirm's polling until
   * it is complete (or BACKGROUND_PROMOTION_MS), so the page can still
   * start the run with the writer's choices. Null when it never completed
   * or ended.
   */
  async finishPromotion(args: {
    commandId: string;
    sourceKeys: string[];
    project: Parameters<IntakeCalls["promoteIntakeDraft"]>[0]["project"];
  }): Promise<PromotionReceipt | null> {
    const draftId = this.draftId;
    if (!draftId) return null;
    const deadline = Date.now() + BACKGROUND_PROMOTION_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.#pollMs * 3));
      try {
        const next = await this.#calls.promoteIntakeDraft({ draftId, ...args });
        if ("ended" in next) return null;
        if (next.complete) return next;
      } catch (error) {
        if (draftGone(error)) return null;
      }
    }
    return null;
  }

  /** Discard: the writer left New project. Its pending work stops and its content goes. */
  discard(): void {
    if (this.closed) return;
    const draftId = this.draftId;
    this.#end();
    if (draftId) void this.#calls.discardIntakeDraft({ draftId }).catch(() => undefined);
  }

  /** The page is gone: no timer fires any more, and the draft's lock is let go. */
  dispose(): void {
    this.#disposed = true;
    this.#releaseLock?.();
    this.#releaseLock = null;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    if (this.#contextTimer) clearTimeout(this.#contextTimer);
    if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
    this.#contextTimer = null;
    this.#selectionTimer = null;
    this.#stopPending();
  }

  /** Whether a draft was made, or is being made (or picked up again). */
  get started(): boolean {
    return this.draftId !== null || this.#creating !== null || this.#restoring !== null;
  }

  /** Original uploads still on their way (they finish after a confirm too). */
  get uploadsPending(): number {
    return this.#originalUploads.size;
  }

  /** Stops everything: no more saves, no receipts, no stored id. */
  #end(): void {
    this.closed = true;
    this.#ended = true;
    this.dispose();
    this.receipts.clear();
    this.originals.clear();
    this.messages.clear();
    this.#removeStorage();
  }

  /** The server no longer has the draft: it ends here as if discarded. */
  #die(): void {
    if (this.#ended) return;
    this.#end();
    this.draftId = null;
  }

  async #ensureDraft(): Promise<Id<"intakeDrafts"> | null> {
    // A reload's draft being picked up is the draft, once it is back.
    if (this.#restoring) await this.#restoring.catch(() => undefined);
    if (this.draftId) return this.draftId;
    if (this.closed) return null;
    this.#creating ??= (async () => {
      try {
        const draftId = await this.#calls.createIntakeDraft({});
        if (!draftId) {
          this.#creating = null;
          return null;
        }
        // Confirmed, switched to Review or left while it was being made:
        // it is not kept (and its id is never stored).
        if (this.closed) {
          void this.#calls.discardIntakeDraft({ draftId }).catch(() => undefined);
          return null;
        }
        this.draftId = draftId;
        this.#writeStorage(draftId);
        // This page owns the draft: a reload may pick it up, a second tab not.
        void this.#holdLock(intakeDraftLockName(draftId), LEFTOVER_LOCK_WAIT_MS).then((release) => {
          if (!release) return;
          if (this.#disposed || this.#releaseLock) release();
          else this.#releaseLock = release;
        });
        if (this.#context) this.setContext(this.#context);
        if (this.#selection.length) this.setSelection(this.#selection);
        untrack(() => this.#pendingChanged());
        return draftId;
      } catch (error) {
        if (userErrorCode(error) === "INTAKE_DRAFT_LIMIT") {
          // The day's draft cap: this page keeps no draft and saves files
          // when the writer starts, and says so once.
          this.notice = userErrorMessage(error, "Files are saved when you start instead.");
          this.#end();
          return null;
        }
        console.error("Could not start the intake draft", error);
        this.#creating = null;
        return null;
      }
    })();
    return await this.#creating;
  }

  async #save(key: string): Promise<void> {
    this.#timers.delete(key);
    const previous = this.#inflight.get(key);
    const run = (async () => {
      if (previous) await previous.catch(() => undefined);
      const desc = this.#wanted.get(key);
      if (!desc || this.closed) return;
      const draftId = await this.#ensureDraft();
      if (!draftId || this.closed) {
        // No draft at all: nothing is prepared ahead, and confirming saves
        // every file the way it always has, so there is no receipt to show.
        this.receipts.delete(key);
        return;
      }
      this.#attempted.set(key, desc);
      try {
        await this.#calls.saveIntakeSource({
          draftId,
          sourceKey: desc.sourceKey,
          kind: desc.kind,
          position: desc.position,
          label: desc.label,
          content: desc.content,
          ...(desc.sourceFormat ? { sourceFormat: desc.sourceFormat } : {}),
          ...(desc.fileType ? { fileType: desc.fileType } : {}),
          ...(desc.category ? { category: desc.category } : {}),
          ...(desc.intake ? { intake: desc.intake } : {}),
          ...(desc.extractionOutcome ? { extractionOutcome: desc.extractionOutcome } : {}),
        });
        this.#sent.set(key, desc);
        this.messages.delete(key);
        if (this.#wanted.get(key) === desc) this.receipts.set(key, "saved");
        this.#maybeUploadOriginal(key, desc);
      } catch (error) {
        if (draftGone(error)) {
          this.#die();
          return;
        }
        if (userErrorCode(error) === "INTAKE_TEXT_LIMIT") {
          // A cap, said in plain words on the file (a handled refusal).
          this.messages.set(key, userErrorMessage(error, "This file holds too much text to save."));
        } else {
          console.error("Could not save a file to the intake draft", error);
        }
        if (this.#wanted.get(key) === desc) this.receipts.set(key, "failed");
      }
    })();
    this.#inflight.set(key, run);
    await run;
    if (this.#inflight.get(key) === run) this.#inflight.delete(key);
    untrack(() => this.#pendingChanged());
  }

  async #remove(key: string): Promise<void> {
    this.#sent.delete(key);
    this.#attempted.delete(key);
    // A file added again under this key (Replace) uploads its own original.
    this.#originalsTried.delete(key);
    const draftId = this.draftId;
    if (!draftId || this.closed) return;
    await this.#inflight.get(key)?.catch(() => undefined);
    // Added back while the save was on its way: keep it.
    if (this.#wanted.has(key)) return;
    await this.#calls.removeIntakeSource({ draftId, sourceKey: key }).catch((error: unknown) => {
      if (draftGone(error)) this.#die();
    });
  }

  #maybeUploadOriginal(key: string, desc: IntakeSourceDesc): void {
    const file = desc.file;
    const draftId = this.draftId;
    if (!file || !draftId || this.#ended || this.#originalsTried.get(key) === file) return;
    this.#originalsTried.set(key, file);
    this.originals.set(key, "uploading");
    const upload = (async () => {
      try {
        const storageId = await this.#uploadOriginal(file);
        if (!storageId) throw new Error("Original upload failed");
        await this.#claimUpload(storageId);
        // The draft ended, or the file was replaced, while it uploaded: the
        // upload is released, never attached.
        const current = this.#sent.get(key);
        if (this.#ended || current?.file !== file) {
          await this.#releaseUpload(storageId);
          if (!this.#ended && this.originals.get(key) === "uploading") this.originals.delete(key);
          return;
        }
        // Hashed now, from the text saved last: an edit made during the
        // upload (a previous-year note, say) is the text the file belongs to.
        const contentHash = await textHash(current.content);
        const attached = await this.#calls.attachIntakeOriginal({
          draftId,
          sourceKey: key,
          storageId,
          contentHash,
          ...(file.type ? { mimeType: file.type } : {}),
        });
        if (!this.#ended) this.originals.set(key, attached ? "saved" : "failed");
      } catch (error) {
        if (draftGone(error)) {
          this.#die();
          return;
        }
        console.error("Could not save an original file to the intake draft", error);
        if (!this.#ended) this.originals.set(key, "failed");
      }
    })();
    this.#originalUploads.add(upload);
    void upload.finally(() => this.#originalUploads.delete(upload));
  }

  async #sendContext(): Promise<void> {
    this.#contextTimer = null;
    const context = this.#context;
    const draftId = this.draftId;
    if (!context || !draftId || this.closed) return;
    const serialized = JSON.stringify(context);
    if (serialized === this.#contextSent) return;
    try {
      await this.#calls.updateIntakeContext({
        draftId,
        clientName: context.clientName,
        ...(context.interviewerUserId ? { interviewerUserId: context.interviewerUserId } : {}),
        interviewees: context.interviewees,
      });
      this.#contextSent = serialized;
    } catch (error) {
      if (draftGone(error)) {
        this.#die();
        return;
      }
      console.error("Could not save the project names to the intake draft", error);
    }
  }

  /**
   * The count changed: sent a moment later (debounced), and kept fresh while
   * it is above zero. Nothing is sent before the draft exists, while
   * promoting, or once it ended.
   */
  #pendingChanged(): void {
    if (this.#disposed || this.closed || this.#promoting || !this.draftId) return;
    // A timer already set is never pushed back: a PDF read reports progress
    // once a page, and resetting on each would hold the count until the
    // read ended (review 2026-09-27, P2-1). The send reads the count when it
    // fires, so a timer is set only when the count differs from the last
    // one sent.
    if (this.#pendingTimer || this.pendingReads === this.#pendingSent) return;
    this.#pendingTimer = setTimeout(() => void this.#sendPending(false), this.#delayMs);
  }

  async #sendPending(refresh: boolean): Promise<void> {
    if (!refresh) this.#pendingTimer = null;
    const draftId = this.draftId;
    if (this.#disposed || !draftId || this.closed || this.#promoting) return;
    const count = this.pendingReads;
    // A refresh sends while there is anything to say: a count above zero, or
    // one the server has not taken yet (a failed report of zero is retried).
    if (count === this.#pendingSent && (!refresh || count === 0)) return;
    try {
      await this.#calls.reportIntakePendingReads({ draftId, count });
      this.#pendingSent = count;
    } catch (error) {
      if (draftGone(error)) {
        this.#die();
        return;
      }
      console.error("Could not tell the intake draft about files still being read", error);
    }
    if (this.#disposed || this.closed || this.#promoting) return;
    const settled = this.#pendingSent === 0 && this.pendingReads === 0;
    if (!settled && !this.#pendingRefresh) {
      this.#pendingRefresh = setInterval(() => void this.#sendPending(true), this.#refreshMs);
    } else if (settled && this.#pendingRefresh) {
      clearInterval(this.#pendingRefresh);
      this.#pendingRefresh = null;
    }
    // The count moved while this send was on its way.
    this.#pendingChanged();
  }

  #stopPending(): void {
    if (this.#pendingTimer) clearTimeout(this.#pendingTimer);
    if (this.#pendingRefresh) clearInterval(this.#pendingRefresh);
    this.#pendingTimer = null;
    this.#pendingRefresh = null;
  }

  async #sendSelection(): Promise<void> {
    this.#selectionTimer = null;
    const draftId = this.draftId;
    if (!draftId || this.closed || this.#promoting) return;
    const serialized = JSON.stringify(this.#selection);
    if (serialized === this.#selectionSent) return;
    try {
      await this.#calls.setIntakeSelection({ draftId, excludedSourceKeys: this.#selection });
      this.#selectionSent = serialized;
    } catch (error) {
      if (draftGone(error)) {
        this.#die();
        return;
      }
      console.error("Could not save the file choice to the intake draft", error);
    }
  }

  #readStorage(): Id<"intakeDrafts"> | null {
    try {
      return (this.#storage?.getItem(INTAKE_DRAFT_STORAGE_KEY) as Id<"intakeDrafts"> | null) ?? null;
    } catch {
      return null;
    }
  }

  #writeStorage(draftId: Id<"intakeDrafts">): void {
    if (this.closed) return;
    try {
      this.#storage?.setItem(INTAKE_DRAFT_STORAGE_KEY, draftId);
    } catch {
      // Storage may be unavailable (private mode); the draft still expires.
    }
  }

  #removeStorage(): void {
    try {
      this.#storage?.removeItem(INTAKE_DRAFT_STORAGE_KEY);
    } catch {
      // As above.
    }
  }
}

/**
 * New project's private intake draft, browser side (decision 65, stage 2).
 * The page hands over what it has read (`reconcile`); this saves each
 * transcript and document to the draft a moment after it changes, uploads
 * its original file once the text is saved, and keeps a truthful receipt of
 * both, so a file that failed to save is never dropped from view. The
 * client name, interviewer and interviewees follow, and the start dialog's
 * leave-out list while it is open. Confirming flushes what is still on its
 * way and promotes the draft into the project.
 *
 * Only the draft's opaque id is kept in session storage, never its text.
 */
import { SvelteMap } from "svelte/reactivity";
import type { FunctionReference } from "convex/server";
import type { Id } from "../../../../convex/_generated/dataModel";
import { intakeDraftRefs } from "../../../../convex/lib/intakeDraftRefs";
import type { IntakeSourceDesc } from "./intakePlan";

/** Session storage key of the open draft's id. */
export const INTAKE_DRAFT_STORAGE_KEY = "banhall:intake-draft";
/** A source is saved this long after its last change. */
export const SOURCE_SAVE_DELAY_MS = 300;
/** The names are saved this long after the writer stops typing. */
export const CONTEXT_SAVE_DELAY_MS = 600;
/** Promotion steps a confirm waits for before it gives up. */
const MAX_PROMOTION_STEPS = 40;

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

type Call<Ref> = Ref extends FunctionReference<"mutation", "public", infer Args, infer Result>
  ? (args: Args) => Promise<Result>
  : never;

/** The draft's mutations, as `useMutation` gives them. */
export type IntakeCalls = {
  [Name in
    | "createIntakeDraft"
    | "saveIntakeSource"
    | "removeIntakeSource"
    | "attachIntakeOriginal"
    | "updateIntakeContext"
    | "setIntakeSelection"
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
    a.extractionOutcome === b.extractionOutcome
  );
}

export class IntakeDraftSync {
  /** The draft, once the first readable file made one. */
  draftId = $state<Id<"intakeDrafts"> | null>(null);
  /** Per source key: its text is saving, saved, or failed to save. */
  receipts = new SvelteMap<string, SaveState>();
  /** Per source key: its original file is uploading, saved, or failed. */
  originals = new SvelteMap<string, OriginalState>();
  /** Promoted or discarded: no more text is sent. */
  closed = $state(false);

  #calls: IntakeCalls;
  #storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  #uploadOriginal: (file: File) => Promise<Id<"_storage"> | undefined>;
  #delayMs: number;
  #creating: Promise<Id<"intakeDrafts"> | null> | null = null;
  #wanted = new Map<string, IntakeSourceDesc>();
  #sent = new Map<string, IntakeSourceDesc>();
  #attempted = new Map<string, IntakeSourceDesc>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #inflight = new Map<string, Promise<void>>();
  #originalsTried = new Set<string>();
  #originalUploads = new Set<Promise<void>>();
  #context: IntakeContext | null = null;
  #contextSent = "";
  #contextTimer: ReturnType<typeof setTimeout> | null = null;
  #selection: string[] = [];
  #selectionSent = "";
  #selectionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: {
    calls: IntakeCalls;
    uploadOriginal: (file: File) => Promise<Id<"_storage"> | undefined>;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    delayMs?: number;
  }) {
    this.#calls = options.calls;
    this.#uploadOriginal = options.uploadOriginal;
    this.#storage = options.storage ?? null;
    this.#delayMs = options.delayMs ?? SOURCE_SAVE_DELAY_MS;
  }

  /**
   * A draft left open by an earlier visit (a reload) cannot be picked up
   * again, so it is discarded now rather than left for the 24-hour expiry.
   */
  discardLeftover(): void {
    const leftover = this.#readStorage();
    if (!leftover || leftover === this.draftId) return;
    this.#removeStorage();
    void this.#calls.discardIntakeDraft({ draftId: leftover }).catch(() => undefined);
  }

  /** Brings the draft in line with what the page has read. */
  reconcile(desired: readonly IntakeSourceDesc[]): void {
    if (this.closed) return;
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

  /** The start dialog's leave-out list, by source key. */
  setSelection(excludedSourceKeys: string[]): void {
    this.#selection = [...excludedSourceKeys].sort();
    if (this.closed || !this.draftId) return;
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
    await Promise.all([...this.#inflight.values()]);
    const failed = [...this.#wanted.keys()].filter((key) => this.receipts.get(key) !== "saved");
    await Promise.all(failed.map((key) => this.#save(key)));
    return new Set([...this.#wanted.keys()].filter((key) => this.receipts.get(key) !== "saved"));
  }

  /**
   * Confirm: the draft becomes the project, stepping until the server has
   * installed every source. The receipt maps each source key to its row.
   */
  async promote(args: {
    commandId: string;
    sourceKeys: string[];
    project: Parameters<IntakeCalls["promoteIntakeDraft"]>[0]["project"];
  }): Promise<PromotionReceipt> {
    if (!this.draftId) throw new Error("No intake draft to promote");
    const call = (): Promise<PromotionReceipt> =>
      this.#calls.promoteIntakeDraft({
        draftId: this.draftId!,
        commandId: args.commandId,
        sourceKeys: args.sourceKeys,
        project: args.project,
      });
    let receipt = await call();
    // No more text goes to a draft that is becoming the project.
    this.closed = true;
    for (let step = 0; !receipt.complete && step < MAX_PROMOTION_STEPS; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      receipt = await call();
    }
    if (!receipt.complete) throw new Error("The project is still being set up");
    this.#removeStorage();
    return receipt;
  }

  /** Discard: the writer left New project. Its pending work stops and its content goes. */
  discard(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    const draftId = this.draftId;
    this.#removeStorage();
    if (draftId) void this.#calls.discardIntakeDraft({ draftId }).catch(() => undefined);
  }

  /** Original uploads still on their way (they finish after a confirm too). */
  get uploadsPending(): number {
    return this.#originalUploads.size;
  }

  async #ensureDraft(): Promise<Id<"intakeDrafts"> | null> {
    if (this.draftId) return this.draftId;
    if (this.closed) return null;
    this.#creating ??= (async () => {
      try {
        const draftId = await this.#calls.createIntakeDraft({});
        if (!draftId) {
          this.#creating = null;
          return null;
        }
        this.draftId = draftId;
        this.#writeStorage(draftId);
        if (this.#context) this.setContext(this.#context);
        if (this.#selection.length) this.setSelection(this.#selection);
        return draftId;
      } catch (error) {
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
      if (!draftId) {
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
        if (this.#wanted.get(key) === desc) this.receipts.set(key, "saved");
        this.#maybeUploadOriginal(key, desc);
      } catch (error) {
        console.error("Could not save a file to the intake draft", error);
        if (this.#wanted.get(key) === desc) this.receipts.set(key, "failed");
      }
    })();
    this.#inflight.set(key, run);
    await run;
    if (this.#inflight.get(key) === run) this.#inflight.delete(key);
  }

  async #remove(key: string): Promise<void> {
    this.#sent.delete(key);
    this.#attempted.delete(key);
    const draftId = this.draftId;
    if (!draftId || this.closed) return;
    await this.#inflight.get(key)?.catch(() => undefined);
    // Added back while the save was on its way: keep it.
    if (this.#wanted.has(key)) return;
    await this.#calls.removeIntakeSource({ draftId, sourceKey: key }).catch(() => undefined);
  }

  #maybeUploadOriginal(key: string, desc: IntakeSourceDesc): void {
    const file = desc.file;
    const draftId = this.draftId;
    if (!file || !draftId || this.#originalsTried.has(key)) return;
    this.#originalsTried.add(key);
    this.originals.set(key, "uploading");
    const upload = (async () => {
      try {
        const storageId = await this.#uploadOriginal(file);
        if (!storageId) throw new Error("Original upload failed");
        const attached = await this.#calls.attachIntakeOriginal({
          draftId,
          sourceKey: key,
          storageId,
          ...(file.type ? { mimeType: file.type } : {}),
        });
        this.originals.set(key, attached ? "saved" : "failed");
      } catch (error) {
        console.error("Could not save an original file to the intake draft", error);
        this.originals.set(key, "failed");
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
      console.error("Could not save the project names to the intake draft", error);
    }
  }

  async #sendSelection(): Promise<void> {
    this.#selectionTimer = null;
    const draftId = this.draftId;
    if (!draftId || this.closed) return;
    const serialized = JSON.stringify(this.#selection);
    if (serialized === this.#selectionSent) return;
    try {
      await this.#calls.setIntakeSelection({ draftId, excludedSourceKeys: this.#selection });
      this.#selectionSent = serialized;
    } catch (error) {
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

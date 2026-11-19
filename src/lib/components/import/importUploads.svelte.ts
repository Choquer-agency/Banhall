/**
 * Sending dropped or picked files from this browser tab into Import
 * (2026-11-12, Paper Files 1 and 2). One per tab (`importUploads`), so a
 * send carries on while the person moves around the app.
 *
 * For a drop or Add files: the files are sorted (junk, type and size left
 * out, importIntake.ts), each is hashed (SHA-256) and the server is asked
 * which are already here (ingestion.importFilesHere, 200 at a time), so
 * those are skipped without sending their bytes. A batch is started with
 * what is left (ingestion.startImportBatch). Then three files at a time go
 * up through upload URLs (ingestion.generateUploadUrl, the shared
 * uploadOriginal transport) while one queue stages what went up, up to ten
 * files a call (ingestion.stageImportFiles), one call after another, so the
 * company counts are written once a group. A file that fails never stops
 * the rest; the tab keeps it, with its batch, for "Try again". At the end the batch hears how
 * many could not be sent (ingestion.finishImportBatch). A second drop
 * waits for the first to finish.
 *
 * Greptile fixes (2026-11-17): files that could not be sent are kept with
 * their own batch, so a later drop never takes "Try again" away from them;
 * "Try again" sends each batch's files back into that batch. And the sender
 * itself warns before the tab is closed while it checks or sends, so the
 * warning stays when the person leaves the Import page mid-send (the send
 * carries on) and goes once nothing is being sent.
 */
import type { Id } from "../../../../convex/_generated/dataModel";
import { uploadOriginal } from "$lib/uploads/originalUpload";
import { leftOutText, sortIntake, type IntakeFile, type LocalSending } from "./importIntake";

/** Files sent at once. */
export const UPLOAD_CONCURRENCY = 3;
/** Files one staging call takes (the server's limit). */
export const STAGE_GROUP = 10;
/** Hashes one "already here" question takes (the server's limit). */
export const HASH_GROUP = 200;

type StageOutcome = { path: string; outcome: "added" | "already_here" | "refused"; reason?: string };

export type UploadDeps = {
  filesHere: (hashes: string[]) => Promise<string[] | null | undefined>;
  startBatch: (args: { toSend: number; alreadyHere: number }) => Promise<Id<"importBatches">>;
  generateUploadUrl: () => Promise<string>;
  stage: (args: {
    batchId: Id<"importBatches">;
    files: Array<{ path: string; storageId: Id<"_storage">; contentHash: string; lastModifiedAt: number }>;
  }) => Promise<StageOutcome[]>;
  finish: (args: { batchId: Id<"importBatches">; failed: number }) => Promise<unknown>;
  reopen: (args: { batchId: Id<"importBatches"> }) => Promise<unknown>;
  fetch: typeof fetch;
  /** SHA-256 hex of a file's bytes; the browser's own by default. */
  hash?: (file: File) => Promise<string>;
};

export type AddCallbacks = {
  /** Some files were left out (junk aside): the words to show. */
  onLeftOut?: (text: string) => void;
  /** The first file of this drop is in Import (the page turns New on). */
  onFirstAdded?: () => void;
  /** Something went wrong that stopped the whole drop. */
  onError?: (error: unknown) => void;
};

type Prepared = IntakeFile & { hash: string };

/** The SHA-256 hex of a file's bytes. */
export async function sha256OfFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class ImportUploads {
  #phase = $state<"idle" | "checking" | "sending" | "done">("idle");
  /** The batch of the latest drop (the status line's own). */
  batchId = $state<Id<"importBatches"> | null>(null);
  checking = $state(0);
  checked = $state(0);
  toSend = $state(0);
  sent = $state(0);
  /** Files this tab could not send, each batch's kept apart for "Try again". */
  failedBatches = $state.raw<Array<{ batchId: Id<"importBatches">; files: Prepared[] }>>([]);

  #deps: UploadDeps | null = null;
  #queue: Promise<void> = Promise.resolve();
  #warning = false;
  #warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };

  /** The page hands in its Convex calls (they keep working after it unmounts). */
  connect(deps: UploadDeps) {
    this.#deps = deps;
  }

  get phase(): "idle" | "checking" | "sending" | "done" {
    return this.#phase;
  }

  /** Checking or sending: the tab should not be closed. */
  get busy(): boolean {
    return this.#phase === "checking" || this.#phase === "sending";
  }

  /** Every file this tab could not send, whichever batch it belongs to. */
  get failed(): readonly Prepared[] {
    return this.failedBatches.flatMap((entry) => entry.files);
  }

  /** What the status line needs from this tab. */
  get local(): LocalSending | null {
    if (this.#phase === "idle") return null;
    return {
      batchId: this.batchId,
      phase: this.#phase,
      checking: this.checking,
      checked: this.checked,
      toSend: this.toSend,
      sent: this.sent,
      // All this tab holds: "Try again" sends every one of them.
      failed: this.failed.length,
    };
  }

  /**
   * Closing the tab while files are checked or sent would lose them, so the
   * tab warns then, wherever the person is in the app. The warning goes as
   * soon as nothing is being sent.
   */
  #setPhase(next: "idle" | "checking" | "sending" | "done") {
    this.#phase = next;
    const busy = this.busy;
    if (busy === this.#warning || typeof window === "undefined") return;
    this.#warning = busy;
    if (busy) window.addEventListener("beforeunload", this.#warn);
    else window.removeEventListener("beforeunload", this.#warn);
  }

  /** The files of one batch that could not be sent, in its place (oldest first); none drops the batch. */
  #keepFailed(batchId: Id<"importBatches">, files: Prepared[]) {
    const known = this.failedBatches.some((entry) => entry.batchId === batchId);
    const next = known
      ? this.failedBatches.map((entry) => (entry.batchId === batchId ? { batchId, files } : entry))
      : [...this.failedBatches, { batchId, files }];
    this.failedBatches = next.filter((entry) => entry.files.length > 0);
  }

  /** Back to nothing (tests, and nothing else). */
  reset() {
    this.#setPhase("idle");
    this.batchId = null;
    this.checking = 0;
    this.checked = 0;
    this.toSend = 0;
    this.sent = 0;
    this.failedBatches = [];
    this.#deps = null;
    this.#queue = Promise.resolve();
  }

  /** Adds dropped or picked files; a drop while another runs waits its turn. */
  add(files: readonly IntakeFile[], callbacks: AddCallbacks = {}): Promise<void> {
    const run = this.#queue.then(() => this.#add(files, callbacks));
    this.#queue = run.catch(() => {});
    return run;
  }

  /**
   * "Try again": sends the files that could not be sent, each into its own
   * batch, the older batches first. A drop made since never takes them away.
   */
  retry(callbacks: AddCallbacks = {}): Promise<void> {
    const run = this.#queue.then(async () => {
      const deps = this.#deps;
      if (!deps) return;
      for (const entry of this.failedBatches) {
        // A file the browser could not read stays failed: sending cannot help it.
        const files = entry.files.filter((file) => file.hash);
        if (files.length === 0) continue;
        try {
          await deps.reopen({ batchId: entry.batchId });
          await this.#send(deps, entry.batchId, files, callbacks);
        } catch (error) {
          this.#setPhase("done");
          callbacks.onError?.(error);
          return;
        }
      }
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  async #add(files: readonly IntakeFile[], callbacks: AddCallbacks) {
    const deps = this.#deps;
    if (!deps) return;
    const { add, leftOut } = sortIntake(files);
    const left = leftOutText(leftOut);
    if (left) callbacks.onLeftOut?.(left);
    if (add.length === 0) return;
    // Files an earlier drop could not send stay with that batch ("Try again").
    const earlier = this.batchId;
    try {
      this.batchId = null;
      this.#setPhase("checking");
      this.checking = add.length;
      this.checked = 0;
      const hash = deps.hash ?? sha256OfFile;
      const prepared: Prepared[] = [];
      const here = new Set<string>();
      let asked = 0;
      const ask = async (upTo: number) => {
        const hashes = prepared.slice(asked, upTo).map((entry) => entry.hash);
        asked = upTo;
        if (hashes.length === 0) return;
        for (const found of (await deps.filesHere(hashes)) ?? []) here.add(found);
      };
      for (const entry of add) {
        let digest: string;
        try {
          digest = await hash(entry.file);
        } catch {
          // A file the browser cannot read cannot be sent either.
          digest = "";
        }
        prepared.push({ ...entry, hash: digest });
        this.checked += 1;
        if (prepared.length - asked >= HASH_GROUP) await ask(prepared.length);
      }
      await ask(prepared.length);

      // Already here, or the same bytes earlier in this drop: skipped unsent.
      const toSend: Prepared[] = [];
      const unreadable: Prepared[] = [];
      const seen = new Set<string>();
      let alreadyHere = 0;
      for (const entry of prepared) {
        if (!entry.hash) unreadable.push(entry);
        else if (here.has(entry.hash) || seen.has(entry.hash)) alreadyHere += 1;
        else {
          seen.add(entry.hash);
          toSend.push(entry);
        }
      }
      const batchId = await deps.startBatch({ toSend: toSend.length + unreadable.length, alreadyHere });
      this.batchId = batchId;
      this.#keepFailed(batchId, unreadable);
      await this.#send(deps, batchId, toSend, callbacks);
    } catch (error) {
      // Stopped before its batch began: the line goes back to the earlier one.
      if (!this.batchId) this.batchId = earlier;
      this.#setPhase(this.batchId ? "done" : "idle");
      callbacks.onError?.(error);
    }
  }

  /** Sends `files` three at a time and stages them ten at a time, then tells the batch how many failed. */
  async #send(deps: UploadDeps, batchId: Id<"importBatches">, files: readonly Prepared[], callbacks: AddCallbacks) {
    const kept = this.failedBatches.find((entry) => entry.batchId === batchId)?.files ?? [];
    const failed: Prepared[] = kept.filter((entry) => !entry.hash);
    this.#setPhase("sending");
    this.toSend = files.length + failed.length;
    this.sent = 0;
    let firstAdded = false;

    // What went up, waiting to be staged; one staging call at a time.
    const waiting: Array<{ entry: Prepared; storageId: Id<"_storage"> }> = [];
    let staging: Promise<void> | null = null;
    const stageWaiting = async () => {
      while (waiting.length > 0) {
        const group = waiting.splice(0, STAGE_GROUP);
        try {
          const outcomes = await deps.stage({
            batchId,
            files: group.map(({ entry, storageId }) => ({
              path: entry.path,
              storageId,
              contentHash: entry.hash,
              lastModifiedAt: entry.file.lastModified,
            })),
          });
          group.forEach(({ entry }, index) => {
            const outcome = outcomes[index]?.outcome;
            if (outcome === "added" || outcome === "already_here") {
              this.sent += 1;
              if (outcome === "added" && !firstAdded) {
                firstAdded = true;
                callbacks.onFirstAdded?.();
              }
            } else failed.push(entry);
          });
        } catch {
          failed.push(...group.map(({ entry }) => entry));
        }
      }
    };
    const stageSoon = () => {
      staging ??= stageWaiting().finally(() => {
        staging = null;
        if (waiting.length > 0) stageSoon();
      });
    };

    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const entry = files[next++]!;
        let storageId: Id<"_storage"> | undefined;
        try {
          storageId = await uploadOriginal({
            file: entry.file,
            generateUploadUrl: deps.generateUploadUrl,
            fetch: deps.fetch,
          });
        } catch {
          storageId = undefined;
        }
        if (!storageId) {
          failed.push(entry);
          continue;
        }
        waiting.push({ entry, storageId });
        stageSoon();
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));
    while (staging) await staging;

    this.#keepFailed(batchId, failed);
    this.#setPhase("done");
    await deps.finish({ batchId, failed: failed.length });
  }
}

/** This tab's sender. */
export const importUploads = new ImportUploads();

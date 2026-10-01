/**
 * The project page's start dialog leave-out list, sent to the server
 * (2026-09-27, fourth) the way New project sends a draft's: a moment after
 * each change of ticks while the dialog is open, so a preparation of
 * exactly the ticked files starts; on Cancel the queued start for them ends
 * (nothing is spent); only a Step-by-step dialog asks at all, since only
 * that run waits on a head start (review P3-5); and, at Start on a
 * Step-by-step run, sent once more with `confirm` just before the run is
 * requested, so a queued preparation goes at once and the run waits on it.
 * The Convex client runs one client's mutations in the order they were
 * sent, so the confirm reaches the server before the run's request.
 * Sending is best effort: a failure never holds up or blocks a start.
 */
import type { StartRunExcluded } from "./StartRunDialog.svelte";

/** A change of ticks is sent this long after the last one. */
export const SELECTION_SEND_DELAY_MS = 300;

const NOTHING = JSON.stringify({ transcriptIds: [], documentIds: [] });

function serialize(excluded: StartRunExcluded): string {
  return JSON.stringify({
    transcriptIds: [...excluded.transcriptIds].sort(),
    documentIds: [...excluded.documentIds].sort(),
  });
}

export class ProjectStartSelection {
  #send: (excluded: StartRunExcluded, flags: { confirm?: boolean; cancel?: boolean }) => Promise<unknown>;
  #delayMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #latest: StartRunExcluded = { transcriptIds: [], documentIds: [] };
  /** What the server holds, as far as this page knows: nothing left out at first. */
  #sent = NOTHING;
  #disposed = false;

  constructor(options: {
    send: (excluded: StartRunExcluded, flags: { confirm?: boolean; cancel?: boolean }) => Promise<unknown>;
    delayMs?: number;
  }) {
    this.#send = options.send;
    this.#delayMs = options.delayMs ?? SELECTION_SEND_DELAY_MS;
  }

  /** The ticks changed while the dialog is open. */
  change(excluded: StartRunExcluded): void {
    this.#latest = { transcriptIds: [...excluded.transcriptIds], documentIds: [...excluded.documentIds] };
    if (this.#disposed) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#post(this.#latest, false);
    }, this.#delayMs);
  }

  /** Cancel: a queued start for the unticked files ends, and nothing is left out any more. */
  cancel(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#latest = { transcriptIds: [], documentIds: [] };
    if (this.#disposed || this.#sent === NOTHING) return;
    this.#sent = NOTHING;
    void this.#send(this.#latest, { cancel: true }).catch((error: unknown) =>
      console.error("Could not clear the file choice for the head start", error)
    );
  }

  /** Start on a Step-by-step run: the final list, sent now with `confirm`. */
  confirm(excluded: StartRunExcluded): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    return this.#post(excluded, true);
  }

  /** Start on another kind of run: a change still waiting is sent now, never later. */
  flush(): void {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = null;
    void this.#post(this.#latest, false);
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #post(excluded: StartRunExcluded, confirm: boolean): Promise<void> {
    const serialized = serialize(excluded);
    if (this.#disposed || (!confirm && serialized === this.#sent)) return;
    const previous = this.#sent;
    this.#sent = serialized;
    try {
      await this.#send(excluded, confirm ? { confirm: true } : {});
    } catch (error) {
      // The head start is best effort; the run carries its own list.
      if (this.#sent === serialized) this.#sent = previous;
      console.error("Could not save the file choice for the head start", error);
    }
  }
}

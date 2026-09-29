/**
 * The run's pick queue on its own (review P2-1 re-check). It runs in the
 * browser project because the module keeps its count in Svelte state.
 */
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { enqueuePick, queuedPicks } from "./pickQueue.svelte";

const answerWith = (sent: number[]) => async (version: number) => {
  sent.push(version);
  return { seedStageVersion: version + 1 };
};

describe("pick queue", () => {
  it("counts a pick as done when reading the caller's version throws, and still sends the next one", async () => {
    const run = "run-version-throws";
    const sent: number[] = [];
    const first = enqueuePick(
      run,
      () => {
        // What a closed pane's live read did while the next step was loading.
        throw new TypeError("Cannot read properties of null (reading 'seedStageVersion')");
      },
      answerWith(sent)
    );
    const second = enqueuePick(run, () => 7, answerWith(sent));
    expect(queuedPicks(run)).toBe(2);

    await expect(first).resolves.toMatchObject({ ok: false });
    await expect(second).resolves.toEqual({ ok: true });
    expect(sent).toEqual([7]);
    expect(queuedPicks(run)).toBe(0);
  });

  it("sends each pick on the version the previous answer returned", async () => {
    const run = "run-chain";
    const sent: number[] = [];
    let answerFirst: (() => void) | undefined;
    const first = enqueuePick(run, () => 3, (version) => {
      sent.push(version);
      return new Promise((resolve) => {
        answerFirst = () => resolve({ seedStageVersion: 5 });
      });
    });
    const second = enqueuePick(run, () => 3, answerWith(sent));
    await expect.poll(() => sent).toEqual([3]);

    answerFirst?.();
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(sent).toEqual([3, 5]);
    expect(queuedPicks(run)).toBe(0);
  });

  it("moves on after a version conflict, using the caller's newest version", async () => {
    const run = "run-stale";
    const sent: number[] = [];
    const refused = enqueuePick(run, () => 4, async (version) => {
      sent.push(version);
      throw new ConvexError({ code: "STALE_REVISION", message: "Seed decisions changed; refresh and retry" });
    });
    const next = enqueuePick(run, () => 6, answerWith(sent));

    await expect(refused).resolves.toMatchObject({ ok: false });
    await expect(next).resolves.toEqual({ ok: true });
    expect(sent).toEqual([4, 6]);
    expect(queuedPicks(run)).toBe(0);
  });

  it("keeps the version it knows after a refusal that wrote nothing, over a closed pane's older one", async () => {
    const run = "run-coded-refusal";
    const sent: number[] = [];
    const saved = enqueuePick(run, () => 7, answerWith(sent));
    const refused = enqueuePick(run, () => 7, async (version) => {
      sent.push(version);
      throw new ConvexError({ code: "INVALID_STATE", message: "Unskip this subsection before changing its decisions" });
    });
    // The pane closed after the first click, so it can only offer version 7.
    const next = enqueuePick(run, () => 7, answerWith(sent));

    await expect(saved).resolves.toEqual({ ok: true });
    await expect(refused).resolves.toMatchObject({ ok: false });
    await expect(next).resolves.toEqual({ ok: true });
    expect(sent).toEqual([7, 8, 8]);
    expect(queuedPicks(run)).toBe(0);
  });
});

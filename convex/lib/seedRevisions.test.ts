import { describe, expect, it } from "vitest";
import {
  EMPTY_CONTEXT_REVISION,
  EMPTY_SELECTION_REVISION,
  MAX_SEED_CONTEXT_ROW_UTF8_BYTES,
  MAX_SEED_CONTEXT_SNAPSHOT_UTF8_BYTES,
  MAX_SEED_PROMPT_UTF8_BYTES,
  MAX_SEED_SNAPSHOT_ROWS,
  SeedContextLimitError,
  assertSeedPromptWithinLimit,
  assertSeedSnapshotWithinLimits,
  buildCompleteDecisionSnapshot,
  buildDispatchSnapshot,
  canonicalizeSeedSnapshot,
  completeContextRevision,
  contextRevision,
  contributionHashes,
  decodeBatchContext,
  emptyContextRevision,
  emptySelectionRevision,
  encodeBatchContext,
  explainChange,
  isSeedSubsectionStale,
  materializeFinalWording,
  orderShownSet,
  selectionRevision,
  stableSerialize,
  type SeedContextItem,
  type SeedContextSnapshot,
} from "./seedRevisions";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

function feedbackItem(index: number, text = ""): SeedContextItem {
  return {
    roleId: "goal_problem",
    kind: "feedback",
    feedbackRequestId: `feedback-${String(index).padStart(3, "0")}`,
    seedId: `seed-${index}`,
    text,
  };
}

describe("seed revisions", () => {
  it("canonicalizes insertion-order permutations to the same bytes and hash", async () => {
    const items: SeedContextItem[] = [
      { roleId: "goal_problem", kind: "skip" },
      {
        roleId: "company_context",
        kind: "selection",
        seedId: "seed-2",
        bullets: ["Second stored wording."],
      },
      {
        roleId: "company_context",
        kind: "selection",
        seedId: "seed-1",
        bullets: ["First stored wording."],
      },
    ];
    const forward = canonicalizeSeedSnapshot({ v: 1, items });
    const reverse = canonicalizeSeedSnapshot({ v: 1, items: [...items].reverse() });
    expect(stableSerialize(forward)).toBe(stableSerialize(reverse));
    expect(await contextRevision(forward)).toBe(await contextRevision(reverse));
  });

  it("uses stable empty context and selection revisions", async () => {
    expect(await emptyContextRevision()).toBe(EMPTY_CONTEXT_REVISION);
    expect(await emptySelectionRevision()).toBe(EMPTY_SELECTION_REVISION);
    expect(await selectionRevision([])).toBe(await selectionRevision([]));
  });

  it("keeps the canonical bytes and hash exact", async () => {
    const snapshot = buildCompleteDecisionSnapshot({
      targetRoleId: "goal_problem",
      selections: [
        {
          roleId: "company_context",
          seedId: "seed-1",
          bullets: ["Stored wording."],
          active: true,
        },
      ],
      skippedRoleIds: [],
      feedbackRequests: [],
    });
    expect(stableSerialize(snapshot)).toBe(
      '{"items":[{"bullets":["Stored wording."],"kind":"selection","roleId":"company_context","seedId":"seed-1"}],"v":1}'
    );
    expect(await completeContextRevision(snapshot)).toBe(
      "dcd0a9db749a3825480159e60f44bcbaac05d1194016958fa31bb37ae3e187ad"
    );
  });

  it("hashes complete decisions beyond the 128-row prompt ceiling", async () => {
    const selections = Array.from({ length: MAX_SEED_SNAPSHOT_ROWS + 1 }, (_, index) => ({
      roleId: "company_context" as const,
      seedId: `seed-${String(index).padStart(3, "0")}`,
      bullets: [`Stored wording ${index}.`],
      active: true,
    }));
    const complete = buildCompleteDecisionSnapshot({
      targetRoleId: "goal_problem",
      selections,
      skippedRoleIds: [],
      feedbackRequests: [],
    });
    expect(complete.items).toHaveLength(MAX_SEED_SNAPSHOT_ROWS + 1);
    await expect(completeContextRevision(complete)).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      buildDispatchSnapshot({
        targetRoleId: "goal_problem",
        selections,
        skippedRoleIds: [],
        feedbackRequests: [],
      })
    ).toThrow(SeedContextLimitError);
  });

  it("materializes edited wording without changing the stored Seed", () => {
    const seed = { _id: "seed-1", bullets: ["Original wording."] };
    const bullets = materializeFinalWording(seed, {
      seedId: seed._id,
      editedBullets: ["Edited wording."],
    });
    bullets[0] = "Caller mutation.";
    expect(seed.bullets).toEqual(["Original wording."]);
    expect(materializeFinalWording(seed)).toEqual(["Original wording."]);
  });

  it("restores the exact original selection revision after an edit", async () => {
    const original = [
      { seedId: "seed-1", bullets: ["Original wording."] },
    ];
    const edited = [
      { seedId: "seed-1", bullets: ["Edited wording."] },
    ];
    expect(await selectionRevision(edited)).not.toBe(
      await selectionRevision(original)
    );
    expect(await selectionRevision([...original])).toBe(
      await selectionRevision(original)
    );
  });

  it("orders revisions directly after their original across Batch creation order", () => {
    const batches = [
      { _id: "batch-older", _creationTime: 10 },
      { _id: "batch-current", _creationTime: 20 },
      { _id: "batch-feedback", _creationTime: 30 },
    ];
    const seeds = [
      {
        _id: "seed-current",
        _creationTime: 20,
        roleId: "company_context" as const,
        batchId: "batch-current",
        order: 0,
      },
      {
        _id: "seed-revision",
        _creationTime: 30,
        roleId: "company_context" as const,
        batchId: "batch-feedback",
        order: 0,
        revisionOfSeedId: "seed-older",
      },
      {
        _id: "seed-older",
        _creationTime: 10,
        roleId: "company_context" as const,
        batchId: "batch-older",
        order: 1,
      },
    ];
    expect(orderShownSet({ seeds, batches }).map((seed) => seed._id)).toEqual([
      "seed-older",
      "seed-revision",
      "seed-current",
    ]);
  });

  it("explains canonical changes and recognizes a restored contribution", () => {
    const original = new Map([
      ["company_context" as const, "r0"],
      ["goal_problem" as const, "g0"],
    ]);
    const changed = new Map([
      ["company_context" as const, "r1"],
      ["goal_problem" as const, "g0"],
    ]);
    expect(explainChange(original, changed)).toEqual({
      changedRoleIds: ["company_context"],
      restored: false,
    });
    expect(explainChange(original, original, changed)).toEqual({
      changedRoleIds: [],
      restored: true,
    });
    expect(
      explainChange(
        new Map(),
        new Map([["company_context" as const, EMPTY_CONTEXT_REVISION]])
      )
    ).toEqual({ changedRoleIds: [], restored: false });
  });

  it("derives stale from both approved revisions", () => {
    expect(
      isSeedSubsectionStale({
        state: "approved",
        currentContextRevision: "context-r1",
        selectionRevision: "selection-r0",
        approvedContextRevision: "context-r0",
        approvedSelectionRevision: "selection-r0",
      })
    ).toBe(true);
    expect(
      isSeedSubsectionStale({
        state: "in_progress",
        currentContextRevision: "context-r1",
        selectionRevision: "selection-r1",
        approvedContextRevision: "context-r0",
        approvedSelectionRevision: "selection-r0",
      })
    ).toBe(false);
  });

  it("loads only active predecessors, predecessor skips, own feedback, and target", () => {
    const snapshot = buildDispatchSnapshot({
      targetRoleId: "technological_objective",
      selections: [
        {
          roleId: "company_context",
          seedId: "seed-active",
          bullets: ["Frozen final wording."],
          active: true,
        },
        {
          roleId: "goal_problem",
          seedId: "seed-inactive",
          bullets: ["Inactive wording."],
          active: false,
        },
        {
          roleId: "active_uncertainties",
          seedId: "seed-successor",
          bullets: ["Successor wording."],
          active: true,
        },
      ],
      skippedRoleIds: ["passive_limitations"],
      feedbackRequests: [
        {
          roleId: "company_context",
          feedbackRequestId: "feedback-predecessor",
          targetSeedId: "seed-active",
          instruction: "Emphasize the operating context.",
          status: "active",
        },
        {
          roleId: "technological_objective",
          feedbackRequestId: "feedback-own",
          targetSeedId: "seed-own",
          instruction: "Make the objective measurable.",
          status: "active",
        },
        {
          roleId: "goal_problem",
          feedbackRequestId: "feedback-withdrawn",
          targetSeedId: "seed-old",
          instruction: "Do not include this.",
          status: "withdrawn",
        },
      ],
      target: {
        roleId: "technological_objective",
        feedbackRequestId: "feedback-own",
        targetSeedId: "seed-own",
        targetWording: ["Original frozen target wording."],
        instruction: "Make the objective measurable.",
      },
    });
    expect(snapshot.items.map(({ kind }) => kind)).toEqual([
      "selection",
      "feedback",
      "skip",
      "ownFeedback",
      "target",
    ]);
    expect(stableSerialize(snapshot)).not.toContain("Successor wording");
    expect(stableSerialize(snapshot)).not.toContain("Inactive wording");
    expect(stableSerialize(snapshot)).not.toContain("Do not include this");
  });

  it("round-trips immutable rows and preserves per-role contribution hashes", async () => {
    const snapshot = buildDispatchSnapshot({
      targetRoleId: "goal_problem",
      selections: [
        {
          roleId: "company_context",
          seedId: "seed-1",
          bullets: ["Frozen wording."],
          active: true,
        },
      ],
      skippedRoleIds: [],
      feedbackRequests: [],
    });
    const rows = await encodeBatchContext(snapshot, { targetRoleId: "goal_problem" });
    expect(decodeBatchContext([...rows].reverse())).toEqual(snapshot);
    const hashes = await contributionHashes(snapshot);
    expect(rows[0].contributionHash).toBe(hashes.get("company_context"));
    expect(rows[0]).toMatchObject({
      roleId: "goal_problem",
      sourceRoleId: "company_context",
      order: 0,
    });
  });

  it("copies mutable input arrays at the dispatch boundary", () => {
    const bullets = ["Frozen wording."];
    const snapshot = buildDispatchSnapshot({
      targetRoleId: "goal_problem",
      selections: [
        {
          roleId: "company_context",
          seedId: "seed-1",
          bullets,
          active: true,
        },
      ],
      skippedRoleIds: [],
      feedbackRequests: [],
    });
    bullets[0] = "Edited after dispatch.";
    expect(stableSerialize(snapshot)).toContain("Frozen wording");
    expect(stableSerialize(snapshot)).not.toContain("Edited after dispatch");
  });

  it("excludes feedback target metadata from the consumed context revision", async () => {
    const base: SeedContextSnapshot = { v: 1, items: [feedbackItem(1, "Keep this.")] };
    const withTarget: SeedContextSnapshot = {
      v: 1,
      items: [
        ...base.items,
        {
          roleId: "goal_problem",
          kind: "target",
          feedbackRequestId: "feedback-1",
          seedId: "seed-1",
          bullets: ["Frozen target."],
          text: "Revise it.",
        },
      ],
    };
    expect(await contextRevision(withTarget)).toBe(await contextRevision(base));
    expect(await contributionHashes(withTarget)).toEqual(
      await contributionHashes(base)
    );
  });

  it("accepts the exact row byte boundary and rejects one byte over", () => {
    const empty = feedbackItem(1);
    const overhead = bytes(stableSerialize(empty));
    const exact = feedbackItem(1, "x".repeat(MAX_SEED_CONTEXT_ROW_UTF8_BYTES - overhead));
    expect(bytes(stableSerialize(exact))).toBe(MAX_SEED_CONTEXT_ROW_UTF8_BYTES);
    expect(() => assertSeedSnapshotWithinLimits({ v: 1, items: [exact] })).not.toThrow();
    const over = feedbackItem(
      1,
      "x".repeat(MAX_SEED_CONTEXT_ROW_UTF8_BYTES - overhead + 1)
    );
    expect(() => assertSeedSnapshotWithinLimits({ v: 1, items: [over] })).toThrow(
      SeedContextLimitError
    );
  });

  it("accepts the exact snapshot byte boundary and rejects one byte over", () => {
    const items = Array.from({ length: 9 }, (_, index) => feedbackItem(index));
    let remaining =
      MAX_SEED_CONTEXT_SNAPSHOT_UTF8_BYTES -
      bytes(stableSerialize({ v: 1, items }));
    for (let index = 0; index < items.length && remaining > 0; index += 1) {
      const capacity =
        MAX_SEED_CONTEXT_ROW_UTF8_BYTES - bytes(stableSerialize(items[index]));
      const added = Math.min(capacity, remaining);
      items[index] = feedbackItem(index, "x".repeat(added));
      remaining -= added;
    }
    const exact: SeedContextSnapshot = { v: 1, items };
    expect(remaining).toBe(0);
    expect(bytes(stableSerialize(canonicalizeSeedSnapshot(exact)))).toBe(
      MAX_SEED_CONTEXT_SNAPSHOT_UTF8_BYTES
    );
    expect(() => assertSeedSnapshotWithinLimits(exact)).not.toThrow();
    const last = items[items.length - 1];
    if (last.kind !== "feedback") throw new Error("Expected feedback fixture");
    const over: SeedContextSnapshot = {
      v: 1,
      items: [...items.slice(0, -1), { ...last, text: `${last.text}x` }],
    };
    expect(() => assertSeedSnapshotWithinLimits(over)).toThrow(SeedContextLimitError);
  });

  it("accepts the exact collected-row boundary and rejects one extra row", () => {
    const exact: SeedContextSnapshot = {
      v: 1,
      items: Array.from({ length: MAX_SEED_SNAPSHOT_ROWS }, () => ({
        roleId: "company_context" as const,
        kind: "skip" as const,
      })),
    };
    expect(() => assertSeedSnapshotWithinLimits(exact)).not.toThrow();
    expect(() =>
      assertSeedSnapshotWithinLimits({
        v: 1,
        items: [...exact.items, { roleId: "company_context", kind: "skip" }],
      })
    ).toThrow(SeedContextLimitError);
  });

  it("accepts the exact assembled prompt byte boundary and rejects one byte over", () => {
    const exact = "é".repeat(MAX_SEED_PROMPT_UTF8_BYTES / 2);
    expect(bytes(exact)).toBe(MAX_SEED_PROMPT_UTF8_BYTES);
    expect(() => assertSeedPromptWithinLimit(exact)).not.toThrow();
    expect(() =>
      assertSeedPromptWithinLimit(`${exact}x`)
    ).toThrow(SeedContextLimitError);
  });
});

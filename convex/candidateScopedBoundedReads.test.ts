/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const AUTH_ID = "candidate-scoped-bounded-reads-writer";
type Section = "s242" | "s244" | "s246";
type OrderedSection = readonly [Section, number];
const DEFAULT_SECTION_ORDER = [
  ["s242", 0],
  ["s244", 1],
  ["s246", 2],
] satisfies ReadonlyArray<OrderedSection>;

async function seedGeneration(t: ReturnType<typeof convexTest>) {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: AUTH_ID,
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Candidate-scoped bounded reads",
      clientName: "Client",
      status: "review",
      createdBy: userId,
      shareToken: `candidate-scoped-${now}`,
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview content",
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "completed",
      candidateMode: "compare",
      startedAt: now,
    });
    return { generationId, projectId, transcriptId };
  });
  return { ...ids, asWriter: t.withIdentity({ subject: AUTH_ID }) };
}

async function insertCandidateRun(
  t: ReturnType<typeof convexTest>,
  args: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    ordinal: number;
    withCandidate?: boolean;
    consistencyChecked?: boolean;
  }
) {
  return await t.run(async (ctx) => {
    const candidateId = args.withCandidate
      ? await ctx.db.insert("reportCandidates", {
          projectId: args.projectId,
          generationId: args.generationId,
          model: `model-${args.ordinal}`,
          label: `Candidate ${args.ordinal}`,
          content: `Candidate ${args.ordinal} content`,
          agentOutputs: "{}",
          createdAt: args.ordinal,
        })
      : undefined;
    const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
      generationId: args.generationId,
      projectId: args.projectId,
      model: `model-${args.ordinal}`,
      label: `Candidate ${args.ordinal}`,
      status: "succeeded",
      ...(candidateId === undefined ? {} : { candidateId }),
      queuedAt: args.ordinal,
      ...(args.consistencyChecked === false ? {} : { consistencyCheckedAt: args.ordinal }),
    });
    return { candidateId, candidateRunId };
  });
}

async function insertDraftedSections(
  t: ReturnType<typeof convexTest>,
  args: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    candidateRunId: Id<"generationCandidateRuns">;
    ordinal: number;
    order?: ReadonlyArray<OrderedSection>;
  }
) {
  await t.run(async (ctx) => {
    for (const [section, orderIndex] of args.order ?? DEFAULT_SECTION_ORDER) {
      await ctx.db.insert("generationSectionRuns", {
        generationId: args.generationId,
        projectId: args.projectId,
        section,
        status: "drafted",
        draftText: `Candidate ${args.ordinal} ${section}`,
        model: `model-${args.ordinal}`,
        label: `Candidate ${args.ordinal}`,
        attempt: 1,
        candidateRunId: args.candidateRunId,
        orderIndex,
        queuedAt: args.ordinal,
      });
    }
  });
}

async function insertNote(
  t: ReturnType<typeof convexTest>,
  args: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    candidateRunId: Id<"generationCandidateRuns">;
    instruction: string;
  }
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("complianceNotes", {
      generationId: args.generationId,
      projectId: args.projectId,
      candidateRunId: args.candidateRunId,
      section: "242",
      source: "deterministic",
      instruction: args.instruction,
      outcome: "not_applied",
      tier: "conflict",
      reason: "candidate-scoping fixture",
      repaired: false,
    });
  });
}

describe("candidate-scoped bounded reads", () => {
  test("finds a requested section candidate after more than 30 older rows and rejects a cross-generation run", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, transcriptId, asWriter } = await seedGeneration(t);

    for (let ordinal = 0; ordinal < 11; ordinal += 1) {
      const { candidateRunId } = await insertCandidateRun(t, {
        generationId,
        projectId,
        ordinal,
      });
      await insertDraftedSections(t, {
        generationId,
        projectId,
        candidateRunId,
        ordinal,
      });
    }
    const target = await insertCandidateRun(t, {
      generationId,
      projectId,
      ordinal: 11,
      consistencyChecked: false,
    });
    const targetOrder = [
      ["s246", 0],
      ["s242", 1],
      ["s244", 2],
    ] satisfies ReadonlyArray<OrderedSection>;
    await insertDraftedSections(t, {
      generationId,
      projectId,
      candidateRunId: target.candidateRunId,
      ordinal: 11,
      order: targetOrder,
    });

    const beforeConsistency = await asWriter.query(api.generations.getOrderedSectionDrafts, {
      generationId,
      candidateRunId: target.candidateRunId,
    });
    expect(beforeConsistency?.map((row) => [row.section, row.orderIndex])).toEqual([
      ["246", 0],
      ["242", 1],
    ]);
    expect(beforeConsistency?.every((row) => row.candidateRunId === target.candidateRunId)).toBe(true);

    await t.run((ctx) => ctx.db.patch(target.candidateRunId, { consistencyCheckedAt: Date.now() }));
    const afterConsistency = await asWriter.query(api.generations.getOrderedSectionDrafts, {
      generationId,
      candidateRunId: target.candidateRunId,
    });
    expect(afterConsistency?.map((row) => [row.section, row.orderIndex])).toEqual([
      ["246", 0],
      ["242", 1],
      ["244", 2],
    ]);
    expect(afterConsistency?.every((row) => row.candidateRunId === target.candidateRunId)).toBe(true);

    const unscopedDrafts = await asWriter.query(api.generations.getOrderedSectionDrafts, {
      generationId,
    });
    expect(unscopedDrafts).toHaveLength(30);
    expect(unscopedDrafts?.every((row) => row.candidateRunId !== target.candidateRunId)).toBe(true);

    const otherGenerationId = await t.run((ctx) =>
      ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "completed",
        candidateMode: "compare",
        startedAt: Date.now(),
      })
    );
    const other = await insertCandidateRun(t, {
      generationId: otherGenerationId,
      projectId,
      ordinal: 12,
    });
    await insertDraftedSections(t, {
      generationId: otherGenerationId,
      projectId,
      candidateRunId: other.candidateRunId,
      ordinal: 12,
    });
    expect(
      await asWriter.query(api.generations.getOrderedSectionDrafts, {
        generationId,
        candidateRunId: other.candidateRunId,
      })
    ).toEqual([]);

    const missing = await insertCandidateRun(t, {
      generationId,
      projectId,
      ordinal: 13,
    });
    await insertDraftedSections(t, {
      generationId,
      projectId,
      candidateRunId: missing.candidateRunId,
      ordinal: 13,
    });
    await t.run((ctx) => ctx.db.delete(missing.candidateRunId));
    expect(
      await asWriter.query(api.generations.getOrderedSectionDrafts, {
        generationId,
        candidateRunId: missing.candidateRunId,
      })
    ).toEqual([]);

    const failed = await insertCandidateRun(t, {
      generationId,
      projectId,
      ordinal: 14,
    });
    await insertDraftedSections(t, {
      generationId,
      projectId,
      candidateRunId: failed.candidateRunId,
      ordinal: 14,
      order: targetOrder,
    });
    await t.run((ctx) => ctx.db.patch(failed.candidateRunId, { status: "failed" }));
    expect(
      await asWriter.query(api.generations.getOrderedSectionDrafts, {
        generationId,
        candidateRunId: failed.candidateRunId,
      })
    ).toEqual([]);
  });

  test("finds a selected candidate after more than 10 older runs", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, asWriter } = await seedGeneration(t);

    for (let ordinal = 0; ordinal < 11; ordinal += 1) {
      await insertCandidateRun(t, {
        generationId,
        projectId,
        ordinal,
        withCandidate: true,
      });
    }
    const selected = await insertCandidateRun(t, {
      generationId,
      projectId,
      ordinal: 11,
      withCandidate: true,
    });
    const unselected = await insertCandidateRun(t, {
      generationId,
      projectId,
      ordinal: 12,
      withCandidate: true,
    });
    if (selected.candidateId === undefined) throw new Error("selected candidate fixture missing");
    await t.run((ctx) =>
      ctx.db.insert("modelSelections", {
        projectId,
        generationId,
        userId: "writer-1",
        candidateId: selected.candidateId,
        model: "model-11",
        label: "Candidate 11",
        createdAt: Date.now(),
      })
    );
    await insertNote(t, {
      generationId,
      projectId,
      candidateRunId: selected.candidateRunId,
      instruction: "Selected candidate note",
    });
    await insertNote(t, {
      generationId,
      projectId,
      candidateRunId: unselected.candidateRunId,
      instruction: "Unselected candidate note",
    });

    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.candidateRunId).toBe(selected.candidateRunId);
    expect(notes[0]?.instruction).toBe("Selected candidate note");
  });

  test("keeps the unscoped Compliance Notes fallback for an unresolved legacy selection", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, asWriter } = await seedGeneration(t);
    const first = await insertCandidateRun(t, { generationId, projectId, ordinal: 0 });
    const second = await insertCandidateRun(t, { generationId, projectId, ordinal: 1 });
    const unresolvedCandidateId = await t.run((ctx) =>
      ctx.db.insert("reportCandidates", {
        projectId,
        generationId,
        model: "legacy-model",
        label: "Legacy candidate",
        content: "Legacy candidate content",
        agentOutputs: "{}",
        createdAt: Date.now(),
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("modelSelections", {
        projectId,
        generationId,
        userId: "writer-1",
        candidateId: unresolvedCandidateId,
        model: "legacy-model",
        label: "Legacy candidate",
        createdAt: Date.now(),
      })
    );
    await insertNote(t, {
      generationId,
      projectId,
      candidateRunId: first.candidateRunId,
      instruction: "First fallback note",
    });
    await insertNote(t, {
      generationId,
      projectId,
      candidateRunId: second.candidateRunId,
      instruction: "Second fallback note",
    });

    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    expect(notes.map((note) => note.instruction)).toEqual([
      "First fallback note",
      "Second fallback note",
    ]);
  });

  test("keeps the unscoped Compliance Notes fallback for a legacy selection without candidateId", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, asWriter } = await seedGeneration(t);
    const first = await insertCandidateRun(t, { generationId, projectId, ordinal: 0 });
    const second = await insertCandidateRun(t, { generationId, projectId, ordinal: 1 });
    await t.run((ctx) =>
      ctx.db.insert("modelSelections", {
        projectId,
        generationId,
        userId: "writer-1",
        model: "legacy-model",
        label: "Legacy candidate",
        createdAt: Date.now(),
      })
    );
    await insertNote(t, {
      generationId,
      projectId,
      candidateRunId: first.candidateRunId,
      instruction: "First absent-ID fallback note",
    });
    await insertNote(t, {
      generationId,
      projectId,
      candidateRunId: second.candidateRunId,
      instruction: "Second absent-ID fallback note",
    });

    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    expect(notes.map((note) => note.instruction)).toEqual([
      "First absent-ID fallback note",
      "Second absent-ID fallback note",
    ]);
  });
});

// Validation hardening (DW-121/DW-122 gap): every fixture below keeps its
// section rows within reach of the candidate-scoped index read
// (`by_candidateRunId_and_section`, 3 rows under the 30-row bound), so each
// expectation depends on the guard it names rather than on the row limit.
describe("candidate-scoped bounded reads: guards within scoped reach", () => {
  async function scopedRowCount(
    t: ReturnType<typeof convexTest>,
    candidateRunId: Id<"generationCandidateRuns">
  ) {
    return await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("generationSectionRuns")
            .collect()
        ).filter((row) => row.candidateRunId === candidateRunId).length
    );
  }

  async function otherGeneration(
    t: ReturnType<typeof convexTest>,
    projectId: Id<"projects">,
    transcriptId: Id<"transcripts">
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "completed",
        candidateMode: "compare",
        startedAt: Date.now(),
      })
    );
  }

  test("returns no rows for a checked candidate run and its drafts that both belong to another generation", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, transcriptId, asWriter } = await seedGeneration(t);
    const own = await insertCandidateRun(t, { generationId, projectId, ordinal: 0 });
    await insertDraftedSections(t, {
      generationId,
      projectId,
      candidateRunId: own.candidateRunId,
      ordinal: 0,
    });
    const otherGenerationId = await otherGeneration(t, projectId, transcriptId);
    const foreign = await insertCandidateRun(t, {
      generationId: otherGenerationId,
      projectId,
      ordinal: 1,
    });
    await insertDraftedSections(t, {
      generationId: otherGenerationId,
      projectId,
      candidateRunId: foreign.candidateRunId,
      ordinal: 1,
    });
    expect(await scopedRowCount(t, foreign.candidateRunId)).toBe(3);

    // Control: the requested generation's own candidate is fully readable.
    const ownDrafts = await asWriter.query(api.generations.getOrderedSectionDrafts, {
      generationId,
      candidateRunId: own.candidateRunId,
    });
    expect(ownDrafts?.map((row) => row.section)).toEqual(["242", "244", "246"]);

    expect(
      await asWriter.query(api.generations.getOrderedSectionDrafts, {
        generationId,
        candidateRunId: foreign.candidateRunId,
      })
    ).toEqual([]);
  });

  test("rejects a candidate run owned by another generation even when its section rows name the requested generation", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, transcriptId, asWriter } = await seedGeneration(t);
    const otherGenerationId = await otherGeneration(t, projectId, transcriptId);
    const foreign = await insertCandidateRun(t, {
      generationId: otherGenerationId,
      projectId,
      ordinal: 0,
    });
    // Inconsistent rows: generationId is the requested generation, but the
    // parent run belongs elsewhere. Only the parent-run ownership check can
    // reject them.
    await insertDraftedSections(t, {
      generationId,
      projectId,
      candidateRunId: foreign.candidateRunId,
      ordinal: 0,
    });
    expect(await scopedRowCount(t, foreign.candidateRunId)).toBe(3);

    expect(
      await asWriter.query(api.generations.getOrderedSectionDrafts, {
        generationId,
        candidateRunId: foreign.candidateRunId,
      })
    ).toEqual([]);
  });

  test("drops section rows owned by another generation even when the requested candidate run belongs to this generation", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, transcriptId, asWriter } = await seedGeneration(t);
    const otherGenerationId = await otherGeneration(t, projectId, transcriptId);
    const own = await insertCandidateRun(t, { generationId, projectId, ordinal: 0 });
    // Inconsistent rows: the parent run is this generation's, but the rows
    // are owned by another generation. Only the row ownership filter can
    // reject them.
    await insertDraftedSections(t, {
      generationId: otherGenerationId,
      projectId,
      candidateRunId: own.candidateRunId,
      ordinal: 0,
    });
    expect(await scopedRowCount(t, own.candidateRunId)).toBe(3);

    expect(
      await asWriter.query(api.generations.getOrderedSectionDrafts, {
        generationId,
        candidateRunId: own.candidateRunId,
      })
    ).toEqual([]);
  });

  test("returns no rows for an explicit candidate whose parent run is missing, although its drafts are within reach", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, asWriter } = await seedGeneration(t);
    const orphan = await insertCandidateRun(t, { generationId, projectId, ordinal: 0 });
    await insertDraftedSections(t, {
      generationId,
      projectId,
      candidateRunId: orphan.candidateRunId,
      ordinal: 0,
    });
    await t.run((ctx) => ctx.db.delete(orphan.candidateRunId));
    expect(await scopedRowCount(t, orphan.candidateRunId)).toBe(3);

    expect(
      await asWriter.query(api.generations.getOrderedSectionDrafts, {
        generationId,
        candidateRunId: orphan.candidateRunId,
      })
    ).toEqual([]);
  });

  test("returns no rows for an explicit failed candidate run whose checked drafts are within reach", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, asWriter } = await seedGeneration(t);
    const failed = await insertCandidateRun(t, { generationId, projectId, ordinal: 0 });
    await insertDraftedSections(t, {
      generationId,
      projectId,
      candidateRunId: failed.candidateRunId,
      ordinal: 0,
    });

    // Control: while the run is not failed, every checked draft is returned.
    const beforeFailure = await asWriter.query(api.generations.getOrderedSectionDrafts, {
      generationId,
      candidateRunId: failed.candidateRunId,
    });
    expect(beforeFailure?.map((row) => row.section)).toEqual(["242", "244", "246"]);

    await t.run((ctx) => ctx.db.patch(failed.candidateRunId, { status: "failed" }));
    expect(
      await asWriter.query(api.generations.getOrderedSectionDrafts, {
        generationId,
        candidateRunId: failed.candidateRunId,
      })
    ).toEqual([]);
  });

  test("scopes Compliance Notes to the first candidate run when two runs share the selected candidateId", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, asWriter } = await seedGeneration(t);
    const first = await insertCandidateRun(t, {
      generationId,
      projectId,
      ordinal: 0,
      withCandidate: true,
    });
    if (first.candidateId === undefined) throw new Error("candidate fixture missing");
    const sharedCandidateId = first.candidateId;
    const duplicateRunId = await t.run((ctx) =>
      ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "model-duplicate",
        label: "Duplicate candidate run",
        status: "succeeded",
        candidateId: sharedCandidateId,
        queuedAt: 1,
        consistencyCheckedAt: 1,
      })
    );
    const unrelated = await insertCandidateRun(t, { generationId, projectId, ordinal: 2 });
    await t.run((ctx) =>
      ctx.db.insert("modelSelections", {
        projectId,
        generationId,
        userId: "writer-1",
        candidateId: sharedCandidateId,
        model: "model-0",
        label: "Candidate 0",
        createdAt: Date.now(),
      })
    );
    await insertNote(t, {
      generationId,
      projectId,
      candidateRunId: first.candidateRunId,
      instruction: "First duplicate-run note",
    });
    await insertNote(t, {
      generationId,
      projectId,
      candidateRunId: duplicateRunId,
      instruction: "Second duplicate-run note",
    });
    await insertNote(t, {
      generationId,
      projectId,
      candidateRunId: unrelated.candidateRunId,
      instruction: "Unrelated run note",
    });

    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    expect(notes.map((note) => [note.candidateRunId, note.instruction])).toEqual([
      [first.candidateRunId, "First duplicate-run note"],
    ]);
  });
});

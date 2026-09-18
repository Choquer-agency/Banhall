/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredMutation,
} from "convex/server";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../shared/pdSubsections";
import {
  emptyContextRevision,
  emptySelectionRevision,
} from "./lib/seedRevisions";
const modules = import.meta.glob("./**/*.ts");
type RefFrom<Export> =
  Export extends RegisteredMutation<infer V, infer A, infer R>
    ? FunctionReference<"mutation", V, A, Awaited<R>>
    : never;
export function decisionMutation<Export>(name: string) {
  type Ref = RefFrom<Export>;
  return makeFunctionReference<
    "mutation",
    FunctionArgs<Ref>,
    FunctionReturnType<Ref>
  >(name);
}
export async function decisionFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: "seed-run-writer",
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Seed run",
      clientName: "Client",
      ownerId: userId,
      createdBy: userId,
      shareToken: crypto.randomUUID(),
      status: "generating",
      createdAt: 1,
      updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      startedAt: 1,
      previousProjectStatus: "draft",
      seedStageVersion: 0,
      seedRequestsReserved: 0,
      promptVersion: `sha256:${"a".repeat(64)}`,
      writerSettings: {
        profileState: "missing",
        source: "none",
        matchesProfile: false,
        savedProfileSuperseded: false,
        waiverAnalysis: "none",
        truncated: false,
      },
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "analysis",
      content: "{}",
    });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "brain_blocks",
      content: JSON.stringify({
        blocks: {},
        styleGuidance: "Use direct language.",
        styleOverrides: {},
      }),
    });
    const sourceContent = "Evidence alpha supports the work.";
    const sourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      label: "Interview",
      content: sourceContent,
      contentHash: "source-hash",
      truncated: false,
      originalLength: sourceContent.length,
      capturedAt: 1,
    });
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId,
      generationId,
      inputsHash: "brief-inputs",
      version: 1,
      origin: "derived",
      storylineText: "The team investigated a technical uncertainty.",
      createdAt: 1,
    });
    await ctx.db.patch(generationId, { briefId, briefVersionId: briefId });
    const currentContextRevision = await emptyContextRevision();
    const selectionRevision = await emptySelectionRevision();
    const subsectionIds: Partial<
      Record<PdSubsectionRoleId, Id<"seedSubsections">>
    > = {};
    for (const role of PD_SUBSECTIONS) {
      subsectionIds[role.roleId] = await ctx.db.insert("seedSubsections", {
        projectId,
        generationId,
        roleId: role.roleId,
        kind: role.kind,
        state: "untouched",
        currentContextRevision,
        selectionRevision,
        consecutiveFailures: 0,
      });
    }
    return {
      userId,
      projectId,
      generationId,
      briefId,
      sourceId,
      subsectionIds,
    };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "seed-run-writer" }),
  };
}

export async function addDecisionSeed(
  s: Awaited<ReturnType<typeof decisionFixture>>,
  roleId: PdSubsectionRoleId = "company_context",
) {
  return await s.t.run(async (ctx) => {
    const batchId = await ctx.db.insert("seedBatches", {
      projectId: s.projectId,
      generationId: s.generationId,
      roleId,
      operation: "open",
      dedupeKey: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      consumedContextRevision: await emptyContextRevision(),
      briefVersionId: s.briefId,
      settingsHash: "settings",
      status: "shown",
      queuedAt: 1,
      leaseExpiresAt: 2,
      completedAt: 2,
      model: "model",
      slot: `generation:seeds:${roleId}`,
      promptVersion: "prompt",
      requestsReserved: 2,
      requestsMade: 1,
      settledAt: 2,
    });
    const seedId = await ctx.db.insert("seeds", {
      projectId: s.projectId,
      generationId: s.generationId,
      batchId,
      roleId,
      order: 0,
      bullets: ["Original frozen wording."],
      tags: ["technical"],
      support: "source_supported",
      originalSupport: "source_supported",
    });
    const row = await ctx.db
      .query("seedSubsections")
      .withIndex("by_generationId_and_roleId", (q) =>
        q.eq("generationId", s.generationId).eq("roleId", roleId),
      )
      .unique();
    if (!row) throw new Error("Missing fixture role");
    await ctx.db.patch(row._id, {
      state: "in_progress",
      shownBatchId: batchId,
    });
    return { batchId, seedId, rowId: row._id };
  });
}

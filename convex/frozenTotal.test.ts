/// <reference types="vite/client" />
/**
 * F5 stress run, 2026-10-27: a project's own files stop at the frozen total
 * (FROZEN_TOTAL_BYTES), as company files did, so a draft never freezes more
 * than the Seed read budget holds. The live run froze 50 files of 200,000
 * characters (about 10 MB) and no step's first Batch could start.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  FROZEN_DOCUMENT_CHARS,
  FROZEN_TOTAL_BYTES,
  frozenTotal,
  SEED_DECISION_STATE_ALLOWANCE_BYTES,
  selectFrozenEvidence,
} from "./lib/briefEvidence";
import { DOCUMENT_HEADROOM } from "./lib/readBudget";
import { SEED_DECISION_READ_BYTES, SEED_DECISION_RESERVED_BYTES } from "./lib/seedDecisionState";
import { storedSourceTextVersion } from "./lib/sourceText";
import { companyFileTextFacts, insertCompanyFileTextPieces } from "./lib/companyFileText";
import { emptyContextRevision } from "./lib/seedRevisions";
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../shared/pdSubsections";
import type { Id } from "./_generated/dataModel";
import { selectDraftEvidence } from "./lib/intakeDrafts";

const modules = import.meta.glob("./**/*.ts");
const authId = "frozen-total-writer";
const TRANSCRIPT = "Dana: The seal held at 4.2 bar for 400 cycles.";
const BIG = FROZEN_DOCUMENT_CHARS;
/** How many files of BIG one-byte characters fit after the transcript. */
const FITTING = Math.floor((FROZEN_TOTAL_BYTES - TRANSCRIPT.length) / BIG);

// Scheduled work (a draft's start, a first Batch) never runs here, and
// nothing reaches the network.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A transcript, then `big` files of 200,000 characters and one short file last. */
async function setup(big: number) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    // Before the draft starts: the Inputs band lists files added before it.
    const now = Date.now() - 1_000;
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Cold seal", clientName: "Acme Seals", status: "draft", createdBy: userId, ownerId: userId,
      shareToken: `ft-${Math.random()}`, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("transcripts", { projectId, content: TRANSCRIPT, createdAt: now });
    for (let index = 0; index < big; index++) {
      await ctx.db.insert("projectDocuments", {
        projectId, fileName: `notes-${index}.txt`, fileType: "txt", content: String.fromCharCode(97 + (index % 26)).repeat(BIG),
        source: "upload", uploadedBy: userId, uploaderRole: "writer", createdAt: now + index,
      });
    }
    await ctx.db.insert("projectDocuments", {
      projectId, fileName: "short.txt", fileType: "txt", content: "A short file.", source: "upload", uploadedBy: userId,
      uploaderRole: "writer", createdAt: now + big,
    });
    return { userId, projectId };
  });
  return { t, authed: t.withIdentity({ subject: authId }), ...ids };
}

describe("the frozen total holds a project's own files (F5 stress run, 2026-10-27)", () => {
  it("adds text while every frozen row together stays within the total, and nothing past it", () => {
    const total = frozenTotal(["x".repeat(FROZEN_TOTAL_BYTES - 10)]);
    expect(total.fits("y".repeat(11))).toBe(false);
    expect(total.fits("y".repeat(10))).toBe(true);
    expect(total.fits("z")).toBe(false);
    // Bytes, not characters: "é" is two.
    expect(frozenTotal(["x".repeat(FROZEN_TOTAL_BYTES - 1)]).fits("é")).toBe(false);
  });

  it("freezes files in order up to the first that would pass the total, and no later file, however short", async () => {
    const s = await setup(30);
    const evidence = await s.t.run(async (ctx) => selectFrozenEvidence(ctx, s.projectId));
    expect(FITTING).toBe(15);
    expect(evidence.frozenDocuments.map((item) => item.document.fileName)).toEqual(
      Array.from({ length: FITTING }, (_, index) => `notes-${index}.txt`)
    );
    const bytes = [TRANSCRIPT, ...evidence.frozenDocuments.map((item) => item.content)].reduce((sum, text) => sum + text.length, 0);
    expect(bytes).toBeLessThanOrEqual(FROZEN_TOTAL_BYTES);
    expect(evidence.frozenTranscripts).toHaveLength(1);
  });

  it("then lets company files fill what is left, newest first, up to the first that does not fit (review round 1)", async () => {
    const s = await setup(30);
    // After the transcript and 15 files, 129,298 bytes are left.
    await s.t.run(async (ctx) => {
      const now = Date.now() - 500;
      const clientId = await ctx.db.insert("clients", {
        name: "Acme Seals", nameKey: "acme seals", status: "active", nameHistoryComplete: true, createdBy: s.userId, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(s.projectId, { clientId });
      for (const [fileName, chars, createdAt] of [["older.txt", 60_000, now], ["middle.txt", 100_000, now + 1], ["newest.txt", 50_000, now + 2]] as const) {
        const text = "c".repeat(chars);
        const id = await ctx.db.insert("companyFiles", {
          clientId, fileName, fileType: "txt", ...(await companyFileTextFacts(text)), processingStatus: "ready", uploadedBy: s.userId, createdAt,
        });
        await insertCompanyFileTextPieces(ctx, id, text);
      }
    });
    const evidence = await s.t.run(async (ctx) => selectFrozenEvidence(ctx, s.projectId));
    expect(evidence.frozenDocuments).toHaveLength(FITTING);
    // The newest fits; the next would pass the total, so the older one never comes in.
    expect(evidence.frozenCompanyFiles.map((item) => item.file.fileName)).toEqual(["newest.txt"]);
    // 2026-10-28 (third): both are named as left out, newest first.
    const names = await s.t.run(async (ctx) =>
      Promise.all((evidence.companyFilesLeftOut ?? []).map(async (id) => (await ctx.db.get(id))?.fileName))
    );
    expect(names).toEqual(["middle.txt", "older.txt"]);
  });

  it("a draft whose own files fill the total records its company files as left out, and the band lists them (2026-10-28, third)", async () => {
    const s = await setup(30);
    await s.t.run(async (ctx) => {
      const now = Date.now() - 500;
      const clientId = await ctx.db.insert("clients", {
        name: "Acme Seals", nameKey: "acme seals", status: "active", nameHistoryComplete: true, createdBy: s.userId, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(s.projectId, { clientId });
      for (const [fileName, chars, createdAt] of [["last-year.txt", 150_000, now], ["history.txt", 150_000, now + 1]] as const) {
        const text = "c".repeat(chars);
        const id = await ctx.db.insert("companyFiles", {
          clientId, fileName, fileType: "txt", ...(await companyFileTextFacts(text)), processingStatus: "ready", uploadedBy: s.userId, createdAt,
        });
        await insertCompanyFileTextPieces(ctx, id, text);
      }
    });
    const generationId = await s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId, candidateMode: "single" });
    const generation = await s.t.run(async (ctx) => ctx.db.get(generationId));
    expect(generation?.companyFilesLeftOut).toHaveLength(2);
    const band = await s.authed.query(api.generations.getContextInclusion, { generationId });
    const company = band!.rows.filter((row: { kind: string }) => row.kind === "company");
    expect(company.map((row: { label: string; reason?: string }) => [row.label, row.reason])).toEqual([
      ["history.txt", "not_captured"],
      ["last-year.txt", "not_captured"],
    ]);
    // Archived since the draft: it says so, as a project file does (review round 1).
    await s.t.run(async (ctx) => {
      const [first] = generation!.companyFilesLeftOut!;
      await ctx.db.patch(first, { archived: true });
    });
    const after = await s.authed.query(api.generations.getContextInclusion, { generationId });
    expect(
      after!.rows.filter((row: { kind: string }) => row.kind === "company").map((row: { label: string; reason?: string }) => [row.label, row.reason])
    ).toEqual([
      ["history.txt", "archived"],
      ["last-year.txt", "not_captured"],
    ]);
  });

  it("leaves a project within the total exactly as before", async () => {
    const s = await setup(3);
    const evidence = await s.t.run(async (ctx) => selectFrozenEvidence(ctx, s.projectId));
    expect(evidence.frozenDocuments.map((item) => item.document.fileName)).toEqual(["notes-0.txt", "notes-1.txt", "notes-2.txt", "short.txt"]);
  });

  it("a draft freezes the same files, and the Inputs band lists the rest as not captured", async () => {
    const s = await setup(30);
    const generationId = await s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId, candidateMode: "single" });
    const frozen = await s.t.run(async (ctx) =>
      (await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()).filter(
        (row) => row.kind === "project_document"
      )
    );
    expect(frozen).toHaveLength(FITTING);
    const band = await s.authed.query(api.generations.getContextInclusion, { generationId });
    const notCaptured = band!.rows.filter((row: { reason?: string }) => row.reason === "not_captured").map((row: { label: string }) => row.label);
    expect(notCaptured).toEqual([...Array.from({ length: 30 - FITTING }, (_, index) => `notes-${FITTING + index}.txt`), "short.txt"]);
  });

  it("a New project head start freezes the same files as the project's first run", async () => {
    const s = await setup(0);
    const fields = await s.t.run(async (ctx) => {
      const now = Date.now();
      const draftId = await ctx.db.insert("intakeDrafts", {
        ownerId: s.userId, status: "open", createdAt: now, lastEditedAt: now, expiresAt: now + 60 * 60 * 1000, transcriptCount: 1,
      });
      const add = async (kind: "transcript" | "document", position: number, label: string, text: string) => {
        const sourceId = await ctx.db.insert("intakeSources", {
          draftId, sourceKey: `${kind}-${position}`, kind, position, label, contentHash: `hash-${position}`,
          contentLength: text.length, hasText: true, ...(kind === "document" ? { fileType: "txt" as const } : {}),
          createdAt: now, updatedAt: now,
        });
        await ctx.db.insert("intakeSourceTexts", { sourceId, draftId, index: 0, text });
      };
      await add("transcript", 0, "Interview", TRANSCRIPT);
      for (let index = 0; index < 30; index++) await add("document", index + 1, `notes-${index}.txt`, "q".repeat(BIG));
      await add("document", 31, "short.txt", "A short file.");
      return (await selectDraftEvidence(ctx, (await ctx.db.get(draftId))!)).fields;
    });
    const documents = fields.filter((field) => field.kind === "project_document");
    expect(documents).toHaveLength(FITTING);
    expect(documents.at(-1)!.label).toBe(`other:notes-${FITTING - 1}.txt`);
  });
});


/**
 * A Step by step draft frozen with `bytes` of file text (files of 200,000
 * one-byte characters and one shorter last file), stored by reference as a
 * draft stores them, its seed stage open. Shaped as seedFirstBatch's.
 */
async function seedDraft(bytes: number) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Cold seal", clientName: "Acme Seals", status: "generating", ownerId: userId, createdBy: userId,
      shareToken: `fs-${Math.random()}`, createdAt: 1, updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId, status: "running", candidateMode: "iterative", gatedWorkflow: "seeds", startedAt: 1, requestedBy: userId,
      previousProjectStatus: "draft", singleModelId: "claude-sonnet-5", promptVersion: `sha256:${"a".repeat(64)}`,
      writerSettings: { profileState: "missing", source: "none", matchesProfile: false, savedProfileSuperseded: false, waiverAnalysis: "none", truncated: false },
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    await ctx.db.insert("generationArtifacts", { generationId, kind: "analysis", content: JSON.stringify({ company_context: "Acme Seals", project_status: "completed" }) });
    await ctx.db.insert("generationArtifacts", {
      generationId, kind: "brain_blocks",
      content: JSON.stringify({
        blocks: { analyzer: "", s242: "", s244: "", s246: "" }, styleGuidance: "Use direct language.", styleOverrides: {},
        orderedContext: { profileState: "missing", categoryOutcomes: [], buildOrder: ["242", "244", "246"], selfCheckRules: [] },
      }),
    });
    const transcriptSourceId = await ctx.db.insert("generationSources", {
      generationId, projectId, kind: "transcript", label: "Interview", content: TRANSCRIPT, contentHash: "transcript-hash",
      truncated: false, originalLength: TRANSCRIPT.length, capturedAt: 1,
    });
    let left = bytes - TRANSCRIPT.length;
    for (let index = 0; left > 0; index++) {
      const text = String.fromCharCode(97 + (index % 26)).repeat(Math.min(BIG, left));
      left -= text.length;
      const contentHash = `file-hash-${index}`;
      const stored = await storedSourceTextVersion(ctx, { projectId }, text, contentHash);
      await ctx.db.insert("generationSources", {
        generationId, projectId, kind: "project_document", label: `other:notes-${index}.txt`, contentHash,
        textVersionId: stored.versionId, textLength: text.length, truncated: false, originalLength: text.length, capturedAt: 1,
      });
    }
    const briefId = await ctx.db.insert("generationBriefs", {
      generationId, projectId, inputsHash: "frozen", version: 1, origin: "derived", storylineText: "The team tested a seal.", createdAt: 1,
    });
    return { generationId, projectId, briefId, transcriptSourceId };
  });
  await t.mutation(internal.generations.pinSeedBrief, { generationId: ids.generationId, inputsHash: "frozen" });
  await t.mutation(internal.generations.initializeSeedStage, { generationId: ids.generationId });
  return { t, ...ids, writer: t.withIdentity({ subject: authId }) };
}

/**
 * A late step's decision state, heavier than the live run's (46 picks over
 * 13 steps, 224 KB read before the frozen text): every step holds 24 Seeds
 * of two 300-character bullets, the Brief 200 entries, and the writer
 * picked 46 Seeds through `select`.
 */
async function heavyDecisionState(s: Awaited<ReturnType<typeof seedDraft>>) {
  const bullet = (role: string, index: number, line: number) => `${role} idea ${index} line ${line}: ${"The seal held under load. ".repeat(11)}`.slice(0, 300);
  const seedsByRole = await s.t.run(async (ctx) => {
    for (let index = 0; index < 200; index++) {
      await ctx.db.insert("generationBriefEntries", {
        briefId: s.briefId, projectId: s.projectId, group: "storyline", text: `Brief entry ${index}: ${"The seal held under load. ".repeat(8)}`,
        sourceId: s.transcriptSourceId, sourceContentHash: "transcript-hash", startOffset: 0, endOffset: TRANSCRIPT.length,
        exactExcerpt: TRANSCRIPT, createdAt: 1,
      });
    }
    const out: Record<string, Id<"seeds">[]> = {};
    for (const role of PD_SUBSECTIONS) {
      if (role.roleId === "prior_year_status") continue;
      const batchId = await ctx.db.insert("seedBatches", {
        projectId: s.projectId, generationId: s.generationId, roleId: role.roleId, operation: "open", dedupeKey: crypto.randomUUID(),
        commandId: crypto.randomUUID(), attemptId: crypto.randomUUID(), consumedContextRevision: await emptyContextRevision(),
        briefVersionId: s.briefId, settingsHash: "settings", status: "shown", queuedAt: 1, leaseExpiresAt: 2, completedAt: 2,
        model: "model", slot: `generation:seeds:${role.roleId}`, promptVersion: "prompt", requestsReserved: 2, requestsMade: 1, settledAt: 2,
      });
      out[role.roleId] = [];
      for (let order = 0; order < 24; order++) {
        out[role.roleId].push(
          await ctx.db.insert("seeds", {
            projectId: s.projectId, generationId: s.generationId, batchId, roleId: role.roleId, order,
            bullets: [bullet(role.roleId, order, 1), bullet(role.roleId, order, 2)], tags: ["technical", "detailed"],
            support: "source_supported", originalSupport: "source_supported",
          })
        );
      }
      const row = await ctx.db
        .query("seedSubsections")
        .withIndex("by_generationId_and_roleId", (q) => q.eq("generationId", s.generationId).eq("roleId", role.roleId))
        .unique();
      await ctx.db.patch(row!._id, { state: "in_progress", shownBatchId: batchId });
    }
    return out;
  });
  const version = async () => (await s.writer.query(api.seeds.getOutline, { generationId: s.generationId })).seedStageVersion;
  // 46 picks: 20 in one step and 26 across the rest, as the live run.
  const picks: Array<[string, number]> = [["active_uncertainties", 20], ["company_context", 3], ["goal_problem", 2], ["passive_limitations", 3],
    ["technological_objective", 2], ["workplan", 2], ["hypothesis", 2], ["experimentation", 5], ["overall_advancement", 2],
    ["specific_advancements", 3], ["project_status", 1], ["goal_improvements", 1]];
  for (const [roleId, count] of picks) {
    for (const seedId of seedsByRole[roleId]!.slice(0, count)) {
      await s.writer.mutation(api.seeds.select, {
        generationId: s.generationId, roleId: roleId as PdSubsectionRoleId, expectedSeedStageVersion: await version(), seedId, selected: true,
      });
    }
  }
  return { seedsByRole, version };
}

describe("a draft at the frozen total starts its first Batch (F5 stress run, 2026-10-27)", () => {
  it("sets the total from the Seed read budget, with room for the draft's decisions", () => {
    expect(FROZEN_TOTAL_BYTES).toBe(SEED_DECISION_READ_BYTES - SEED_DECISION_RESERVED_BYTES - DOCUMENT_HEADROOM - SEED_DECISION_STATE_ALLOWANCE_BYTES);
    expect(FROZEN_TOTAL_BYTES).toBe(3_129_344);
  });

  it("dispatches the first Batch of a draft frozen at the total", async () => {
    const s = await seedDraft(FROZEN_TOTAL_BYTES);
    expect(await s.t.mutation(internal.seedRuns.startFirstBatch, { generationId: s.generationId })).toMatchObject({ kind: "dispatched" });
  });

  it("dispatches a late step's Regenerate and Feedback at the total with a heavy decision state (review round 1)", async () => {
    const s = await seedDraft(FROZEN_TOTAL_BYTES);
    const { seedsByRole, version } = await heavyDecisionState(s);
    const roleId = "goal_improvements" as const;
    await expect(
      s.writer.mutation(api.seeds.regenerate, { generationId: s.generationId, roleId, expectedSeedStageVersion: await version(), commandId: "heavy-regenerate" })
    ).resolves.toMatchObject({ kind: "dispatched" });
    // Feedback on another late step, which has no work pending.
    await expect(
      s.writer.mutation(api.seeds.giveFeedback, {
        generationId: s.generationId, roleId: "project_status", expectedSeedStageVersion: await version(), seedId: seedsByRole.project_status![1]!,
        instruction: "Name the test rig and the load. ".repeat(156).slice(0, 5_000), commandId: "heavy-feedback",
      })
    ).resolves.toMatchObject({ batchId: expect.any(String), feedbackRequestId: expect.any(String) });
  });

  it("refuses by name the first Batch of a draft frozen at the 5 MiB the total was before", async () => {
    const s = await seedDraft(5 * 1024 * 1024);
    await expect(s.t.mutation(internal.seedRuns.startFirstBatch, { generationId: s.generationId })).rejects.toThrow(
      "Seed context for company_context exceeds the prompt limit"
    );
  });
});

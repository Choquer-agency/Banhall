/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { DomainErrorCode } from "./lib/contracts";
import {
  transitionGeneration,
  transitionPostQa,
  transitionRedraft,
} from "./lib/generationTransitions";
import schema from "./schema";
import {
  GENERATION_STATUS_TRANSITIONS,
  isGenerationStatusTransitionAllowed,
  isPostQaTransitionAllowed,
  isRedraftTransitionAllowed,
  POST_QA_TRANSITIONS,
  REDRAFT_TRANSITIONS,
  type GenerationFlow,
  type GenerationStatus,
  type PostQaState,
  type RedraftState,
} from "../shared/generationTransitions";

const modules = import.meta.glob("./**/*.ts");

async function expectDomainError(run: () => Promise<unknown>, code: DomainErrorCode) {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected a ${code} rejection`).toBeDefined();
  expect((thrown as { data?: { code?: unknown } }).data?.code).toBe(code);
}

type GenerationFixture = Partial<Omit<Doc<"generations">, "_id" | "_creationTime">>;

async function setup(generation: GenerationFixture = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: "transition-writer",
      role: "writer",
      name: "Transition Writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Transitions",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      ownerId: userId,
      shareToken: "transition-token",
      createdAt: now,
      updatedAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "running",
      requestedBy: userId,
      previousProjectStatus: "draft",
      startedAt: now,
      ...generation,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    return { userId, projectId, generationId };
  });
  const read = () => t.run(async (ctx) => ctx.db.get(ids.generationId));
  return { t, ...ids, read };
}

describe("transitionGeneration", () => {
  it("writes an allowed move and its patch in one write", async () => {
    const f = await setup({ candidateMode: "compare" });
    await f.t.run(async (ctx) => {
      const generation = (await ctx.db.get(f.generationId))!;
      await transitionGeneration(ctx, generation, "awaiting_selection", {
        currentStep: "Choose your preferred draft",
      });
    });
    const row = await f.read();
    expect(row?.status).toBe("awaiting_selection");
    expect(row?.currentStep).toBe("Choose your preferred draft");
  });

  it("refuses an undeclared move with INVALID_TRANSITION and writes nothing", async () => {
    const f = await setup({ candidateMode: "compare", currentStep: "Before" });
    await expectDomainError(
      () =>
        f.t.run(async (ctx) => {
          const generation = (await ctx.db.get(f.generationId))!;
          await transitionGeneration(ctx, generation, "awaiting_input", {
            currentStep: "After",
          });
        }),
      "INVALID_TRANSITION"
    );
    const row = await f.read();
    expect(row?.status).toBe("running");
    expect(row?.currentStep).toBe("Before");
  });

  it("refuses to leave a terminal status", async () => {
    const f = await setup({ candidateMode: "single", status: "completed" });
    await expectDomainError(
      () =>
        f.t.run(async (ctx) => {
          const generation = (await ctx.db.get(f.generationId))!;
          await transitionGeneration(ctx, generation, "running");
        }),
      "INVALID_TRANSITION"
    );
    expect((await f.read())?.status).toBe("completed");
  });

  it("refuses to start a post-QA pass on a generation that is not completing", async () => {
    const f = await setup({ candidateMode: "compare" });
    await expectDomainError(
      () =>
        f.t.run(async (ctx) => {
          const generation = (await ctx.db.get(f.generationId))!;
          await transitionGeneration(ctx, generation, "awaiting_selection", {
            postQaStatus: "running",
          });
        }),
      "INVALID_TRANSITION"
    );
    expect((await f.read())?.postQaStatus).toBeUndefined();
  });

  it("starts a post-QA pass in the write that completes the generation", async () => {
    const f = await setup({ candidateMode: "single" });
    await f.t.run(async (ctx) => {
      const generation = (await ctx.db.get(f.generationId))!;
      await transitionGeneration(ctx, generation, "completed", {
        postQaStatus: "running",
        postQaStartedAt: 1,
      });
    });
    const row = await f.read();
    expect(row?.status).toBe("completed");
    expect(row?.postQaStatus).toBe("running");
  });
});

describe("transitionPostQa", () => {
  it("refuses running -> running and a pass on an unfinished generation", async () => {
    const running = await setup({ candidateMode: "single", status: "completed", postQaStatus: "running" });
    await expectDomainError(
      () =>
        running.t.run(async (ctx) => {
          const generation = (await ctx.db.get(running.generationId))!;
          await transitionPostQa(ctx, generation, "running");
        }),
      "INVALID_TRANSITION"
    );
    const live = await setup({ candidateMode: "single", status: "running" });
    await expectDomainError(
      () =>
        live.t.run(async (ctx) => {
          const generation = (await ctx.db.get(live.generationId))!;
          await transitionPostQa(ctx, generation, "running");
        }),
      "INVALID_TRANSITION"
    );
  });

  it("settles a running pass", async () => {
    const f = await setup({ candidateMode: "single", status: "completed", postQaStatus: "running" });
    await f.t.run(async (ctx) => {
      const generation = (await ctx.db.get(f.generationId))!;
      await transitionPostQa(ctx, generation, "done", { postQaCompletedAt: 5 });
    });
    const row = await f.read();
    expect(row?.postQaStatus).toBe("done");
    expect(row?.postQaCompletedAt).toBe(5);
  });
});

describe("transitionRedraft", () => {
  const redraft = (status: "running" | "completed" | "failed", userId: Id<"users">) => ({
    status,
    attemptStartedAt: 1,
    requestedBy: userId,
    sections: ["244" as const],
    lastProgressAt: 1,
  });

  it("refuses a redraft on anything but a completed signed-off seed generation", async () => {
    const f = await setup({ candidateMode: "single", status: "completed" });
    await expectDomainError(
      () =>
        f.t.run(async (ctx) => {
          const generation = (await ctx.db.get(f.generationId))!;
          await transitionRedraft(ctx, generation, redraft("running", f.userId));
        }),
      "INVALID_TRANSITION"
    );
    expect((await f.read())?.redraft).toBeUndefined();
  });

  it("starts, advances and settles an attempt, and refuses completed -> failed", async () => {
    const f = await setup({ candidateMode: "iterative", gatedWorkflow: "seeds", status: "completed" });
    await f.t.run(async (ctx) => {
      const summaryVersionId = await ctx.db.insert("summaryVersions", {
        projectId: f.projectId,
        generationId: f.generationId,
        version: 1,
        originGenerationId: f.generationId,
        briefVersionId: await ctx.db.insert("generationBriefs", {
          projectId: f.projectId,
          generationId: f.generationId,
          inputsHash: "hash",
          version: 1,
          origin: "derived",
          storylineText: "",
          droppedEntryCount: 0,
          createdAt: 1,
        }),
        reportTitle: "Transitions",
        settingsHash: "settings",
        skippedRoleIds: [],
        readiness: true,
        signedOffBy: f.userId,
        signedOffAt: 1,
      });
      await ctx.db.patch(f.generationId, { summaryVersionId });
    });
    for (const status of ["running", "running", "completed"] as const) {
      await f.t.run(async (ctx) => {
        const generation = (await ctx.db.get(f.generationId))!;
        await transitionRedraft(ctx, generation, redraft(status, f.userId));
      });
    }
    expect((await f.read())?.redraft?.status).toBe("completed");
    await expectDomainError(
      () =>
        f.t.run(async (ctx) => {
          const generation = (await ctx.db.get(f.generationId))!;
          await transitionRedraft(ctx, generation, redraft("failed", f.userId));
        }),
      "INVALID_TRANSITION"
    );
  });
});

describe("call sites", () => {
  /**
   * Every move each call site makes, as the code makes it. Each must be a
   * declared edge whose `sites` names that call site.
   */
  const STATUS_CALL_SITES: Array<{
    site: string;
    flow: GenerationFlow;
    from: GenerationStatus;
    to: GenerationStatus;
  }> = [
    ...(["compare", "single", "sections", "seed_stage"] as const).map((flow) => ({
      site: "generations.beginGeneration",
      flow,
      from: "reserved" as const,
      to: "running" as const,
    })),
    { site: "generations.beginSummaryRecovery", flow: "seed_drafting", from: "reserved", to: "running" },
    { site: "generations.updateGenerationStatus", flow: "compare", from: "running", to: "running" },
    { site: "generations.updateGenerationStatus", flow: "sections", from: "running", to: "running" },
    { site: "generations.completeCandidateRun", flow: "compare", from: "running", to: "awaiting_selection" },
    { site: "generations.completeCandidateRun", flow: "single", from: "running", to: "completed" },
    { site: "generations.completeCandidateRun", flow: "seed_drafting", from: "running", to: "completed" },
    { site: "generations.completeCandidateRun", flow: "compare", from: "running", to: "failed" },
    { site: "generations.completeCandidateRun", flow: "single", from: "running", to: "failed" },
    { site: "generations.completeCandidateRun", flow: "seed_drafting", from: "running", to: "failed" },
    { site: "generations.failOrderedSectionRun", flow: "compare", from: "running", to: "awaiting_selection" },
    { site: "generations.failOrderedSectionRun", flow: "single", from: "running", to: "failed" },
    { site: "generations.failGeneration", flow: "compare", from: "reserved", to: "failed" },
    { site: "generations.failGeneration", flow: "seed_drafting", from: "running", to: "failed" },
    { site: "generations.initializeSeedStage", flow: "seed_stage", from: "running", to: "awaiting_input" },
    { site: "generations.initializeSeedStage", flow: "seed_stage", from: "awaiting_input", to: "awaiting_input" },
    { site: "generations.signOffSeedStage", flow: "seed_stage", from: "awaiting_input", to: "running" },
    { site: "generations.completeSectionRun", flow: "sections", from: "running", to: "awaiting_input" },
    { site: "generations.failSectionRun", flow: "sections", from: "running", to: "awaiting_input" },
    { site: "generations.approveSectionDraft", flow: "sections", from: "awaiting_input", to: "running" },
    { site: "generations.approveSectionDraft", flow: "sections", from: "awaiting_input", to: "completed" },
    { site: "generations.regenerateSectionDraft", flow: "sections", from: "awaiting_input", to: "running" },
    ...(["sections", "seed_stage", "seed_drafting"] as const).flatMap((flow) =>
      (["reserved", "running"] as const).map((from) => ({
        site: "generations.cancelIterativeGeneration",
        flow,
        from,
        to: "failed" as const,
      }))
    ),
    { site: "generations.cancelIterativeGeneration", flow: "sections", from: "awaiting_input", to: "failed" },
    { site: "generations.cancelIterativeGeneration", flow: "seed_stage", from: "awaiting_input", to: "failed" },
    { site: "generations.failStaleGenerations", flow: "sections", from: "running", to: "awaiting_input" },
    { site: "generations.failStaleGenerations", flow: "compare", from: "reserved", to: "failed" },
    { site: "generations.failStaleGenerations", flow: "single", from: "running", to: "failed" },
    { site: "generations.failStaleGenerations", flow: "seed_drafting", from: "running", to: "failed" },
    { site: "generations.selectReportCandidate", flow: "compare", from: "awaiting_selection", to: "completed" },
    { site: "generations.retryFailedCandidates", flow: "compare", from: "awaiting_selection", to: "superseded" },
    ...(["compare", "single", "sections", "seed_stage", "seed_drafting"] as const).flatMap((flow) =>
      (["reserved", "running"] as const).map((from) => ({
        site: "projects.deleteProject",
        flow,
        from,
        to: "failed" as const,
      }))
    ),
    { site: "projects.deleteProject", flow: "compare", from: "awaiting_selection", to: "failed" },
    { site: "projects.deleteProject", flow: "sections", from: "awaiting_input", to: "failed" },
    { site: "projects.deleteProject", flow: "seed_stage", from: "awaiting_input", to: "failed" },
  ];

  const POST_QA_CALL_SITES: Array<{ site: string; from: PostQaState; to: PostQaState }> = [
    { site: "generations.completeCandidateRun", from: "none", to: "running" },
    { site: "generations.approveSectionDraft", from: "none", to: "running" },
    { site: "generations.requestReportQa", from: "none", to: "running" },
    { site: "generations.requestReportQa", from: "done", to: "running" },
    { site: "generations.requestReportQa", from: "failed", to: "running" },
    { site: "generations.applySeedRedraft", from: "done", to: "running" },
    { site: "generations.saveReportQa", from: "running", to: "done" },
    { site: "generations.saveReportQa", from: "running", to: "failed" },
    { site: "generations.saveReportQa", from: "none", to: "done" },
    { site: "generations.failStalePostQa", from: "running", to: "failed" },
    { site: "projects.deleteProject", from: "running", to: "failed" },
  ];

  const REDRAFT_CALL_SITES: Array<{ site: string; from: RedraftState; to: RedraftState }> = [
    { site: "generations.redraftMissingSections", from: "none", to: "running" },
    { site: "generations.redraftMissingSections", from: "failed", to: "running" },
    { site: "generations.redraftMissingSections", from: "running", to: "running" },
    { site: "generations.claimRedraftSection", from: "running", to: "running" },
    { site: "generations.completeRedraftSection", from: "running", to: "running" },
    { site: "generations.applySeedRedraft", from: "running", to: "running" },
    { site: "generations.applySeedRedraft", from: "running", to: "completed" },
    { site: "generations.failRedraftSection", from: "running", to: "failed" },
    { site: "generations.expireStaleRedraft", from: "running", to: "failed" },
  ];

  it("every status call site's move is declared for that site", () => {
    for (const move of STATUS_CALL_SITES) {
      expect(
        isGenerationStatusTransitionAllowed(move.flow, move.from, move.to),
        `${move.site} ${move.flow}: ${move.from} -> ${move.to}`
      ).toBe(true);
      const edge = GENERATION_STATUS_TRANSITIONS.find(
        (candidate) => candidate.from === move.from && candidate.to === move.to
      );
      expect(edge?.sites, `${move.site} ${move.from} -> ${move.to}`).toContain(move.site);
    }
  });

  it("every post-QA and redraft call site's move is declared for that site", () => {
    for (const move of POST_QA_CALL_SITES) {
      expect(isPostQaTransitionAllowed(move.from, move.to), `${move.site}`).toBe(true);
      expect(
        POST_QA_TRANSITIONS.some(
          (edge) => edge.from === move.from && edge.to === move.to && edge.sites.includes(move.site)
        ),
        `${move.site} ${move.from} -> ${move.to}`
      ).toBe(true);
    }
    for (const move of REDRAFT_CALL_SITES) {
      expect(isRedraftTransitionAllowed(move.from, move.to), `${move.site}`).toBe(true);
      expect(
        REDRAFT_TRANSITIONS.some(
          (edge) => edge.from === move.from && edge.to === move.to && edge.sites.includes(move.site)
        ),
        `${move.site} ${move.from} -> ${move.to}`
      ).toBe(true);
    }
  });

  it("every site the table names is an exported Convex function", () => {
    const sites = new Set([
      ...GENERATION_STATUS_TRANSITIONS.flatMap((edge) => edge.sites),
      ...POST_QA_TRANSITIONS.flatMap((edge) => edge.sites),
      ...REDRAFT_TRANSITIONS.flatMap((edge) => edge.sites),
    ]);
    for (const site of sites) {
      const [module, fn] = site.split(".");
      const source = fs.readFileSync(path.join(__dirname, `${module}.ts`), "utf8");
      expect(source, site).toMatch(new RegExp(`export const ${fn} = `));
    }
  });

  it("no Convex module writes a generation's status, post-QA, redraft or moved fields directly", () => {
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "_generated" ? [] : walk(full);
        return full.endsWith(".ts") && !full.endsWith(".test.ts") && !full.includes("fixture")
          ? [full]
          : [];
      });
    for (const file of walk(__dirname)) {
      if (file.endsWith(path.join("lib", "generationTransitions.ts"))) continue;
      const source = fs.readFileSync(file, "utf8");
      const call = /ctx\.db\.patch\(\s*([^,]+?),/g;
      let match: RegExpExecArray | null;
      while ((match = call.exec(source))) {
        const target = match[1].trim();
        if (!/generation|genId|retryId/i.test(target) || /Run|run\b|Source|Brief|Artifact/.test(target)) {
          continue;
        }
        let depth = 1;
        let end = call.lastIndex;
        while (end < source.length && depth > 0) {
          const char = source[end];
          if (char === "(" || char === "{" || char === "[") depth += 1;
          else if (char === ")" || char === "}" || char === "]") depth -= 1;
          end += 1;
        }
        const body = source.slice(call.lastIndex, end);
        // Status and sub-states go through the transition helpers; the fields
        // that moved to child rows on 2026-09-25 are never written to the row.
        if (
          /\bstatus\s*:|postQaStatus|\bredraft\s*:|\bprogressLog\s*:|\bagentOutputs\s*:|\bbrainProvenance\s*:|\bbrainRetrievalBrief\s*:/.test(
            body
          )
        ) {
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${path.relative(__dirname, file)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("call sites, end to end", () => {
  it("beginGeneration moves reserved -> running", async () => {
    const f = await setup({ candidateMode: "compare", status: "reserved" });
    expect(
      await f.t.mutation(internal.generations.beginGeneration, {
        generationId: f.generationId,
        promptVersion: "legacy",
      })
    ).toBe(true);
    expect((await f.read())?.status).toBe("running");
  });

  it("updateGenerationStatus restates running, ignores a terminal row and refuses an undeclared move", async () => {
    const f = await setup({ candidateMode: "compare" });
    await f.t.mutation(internal.generations.updateGenerationStatus, {
      generationId: f.generationId,
      status: "running",
      currentStep: "Generating candidate drafts...",
    });
    expect((await f.read())?.currentStep).toBe("Generating candidate drafts...");
    await expectDomainError(
      () =>
        f.t.mutation(internal.generations.updateGenerationStatus, {
          generationId: f.generationId,
          status: "awaiting_input",
        }),
      "INVALID_TRANSITION"
    );
    expect((await f.read())?.status).toBe("running");
    await f.t.run(async (ctx) => ctx.db.patch(f.generationId, { status: "failed" }));
    await f.t.mutation(internal.generations.updateGenerationStatus, {
      generationId: f.generationId,
      status: "running",
    });
    expect((await f.read())?.status).toBe("failed");
  });

  it("failGeneration moves running -> failed and frees the project", async () => {
    const f = await setup({ candidateMode: "single" });
    await f.t.mutation(internal.generations.failGeneration, {
      generationId: f.generationId,
      error: "boom",
    });
    expect((await f.read())?.status).toBe("failed");
    const project = await f.t.run(async (ctx) => ctx.db.get(f.projectId));
    expect(project?.activeGenerationId).toBeUndefined();
  });

  it("section runs move a section-approval generation running -> awaiting_input", async () => {
    for (const mutation of ["complete", "fail"] as const) {
      const f = await setup({ candidateMode: "iterative" });
      await f.t.run(async (ctx) =>
        ctx.db.insert("generationSectionRuns", {
          generationId: f.generationId,
          projectId: f.projectId,
          section: "s242",
          status: "running",
          model: "model",
          label: "Model",
          attempt: 1,
          queuedAt: 1,
        })
      );
      if (mutation === "complete") {
        await f.t.mutation(internal.generations.completeSectionRun, {
          generationId: f.generationId,
          section: "s242",
          draftText: "Draft",
          metrics: "{}",
          qa: "{}",
        });
      } else {
        await f.t.mutation(internal.generations.failSectionRun, {
          generationId: f.generationId,
          section: "s242",
          error: "boom",
        });
      }
      expect((await f.read())?.status, mutation).toBe("awaiting_input");
    }
  });

  it("failStaleGenerations moves an old reservation reserved -> failed", async () => {
    const f = await setup({ candidateMode: "compare", status: "reserved", startedAt: 1 });
    await f.t.mutation(internal.generations.failStaleGenerations, {});
    expect((await f.read())?.status).toBe("failed");
  });

  it("failStalePostQa and saveReportQa settle post-QA running -> failed and running -> done", async () => {
    const stale = await setup({
      candidateMode: "single",
      status: "completed",
      postQaStatus: "running",
      postQaStartedAt: 1,
    });
    await stale.t.mutation(internal.generations.failStalePostQa, {});
    expect((await stale.read())?.postQaStatus).toBe("failed");

    const live = await setup({
      candidateMode: "single",
      status: "completed",
      postQaStatus: "running",
      postQaStartedAt: 7,
    });
    await live.t.mutation(internal.generations.saveReportQa, {
      generationId: live.generationId,
      attemptStartedAt: 7,
      qa: JSON.stringify({ overall_score: 80 }),
      qaScore: 80,
    });
    const row = await live.read();
    expect(row?.postQaStatus).toBe("done");
    expect(row?.qaScore).toBe(80);
  });
});

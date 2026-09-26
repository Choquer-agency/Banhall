/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Security wave 1 (audit 2026-09-25, a2 P1-1, P2-2, P2-3 and a4 #5): the
// operations below change what the next draft reads or what the report says,
// so they need report.editProse on the project ("Own" for a Consultant: the
// project's Owner or a Consultant with an open work item on it; Managers and
// Admins: all). Finalize changes the project status and uses
// project.setStage, like publish. A Consultant who merely created the project
// (ownership moved on) is refused before anything runs; the Owner, the
// assigned Consultant and a Manager get past the gate. A caller who passes
// the gate may still be refused for another reason (state, inputs), so the
// allowed side asserts "not NOT_AUTHORIZED", never success.

const AUTH = {
  owner: "reg-owner",
  creator: "reg-creator",
  assigned: "reg-assigned",
  manager: "reg-manager",
} as const;

type Actor = keyof typeof AUTH;

const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Original prose." }] }],
});

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
});

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { authId: AUTH.owner, role: "writer", firstName: "Owen" });
    const creatorId = await ctx.db.insert("users", { authId: AUTH.creator, role: "writer", firstName: "Cora" });
    const assignedId = await ctx.db.insert("users", { authId: AUTH.assigned, role: "writer", firstName: "Asa" });
    await ctx.db.insert("users", { authId: AUTH.manager, role: "manager", firstName: "Mara" });
    // Created by `creator`, now owned by `owner`: createdBy grants nothing.
    const projectId = await ctx.db.insert("projects", {
      title: "Gate project",
      clientName: "Acme",
      status: "review",
      createdBy: creatorId,
      ownerId,
      shareToken: "reg-token",
      scienceCode: "2.02.01",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workItems", {
      projectId,
      kind: "revision",
      assigneeId: assignedId,
      assignerId: ownerId,
      instructions: "Tighten line 244.",
      blocking: false,
      status: "open",
      version: 1,
      createRequestId: "reg-req-1",
      createRequestFingerprint: "reg-fp-1",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interviewer: What did you test?\n\nClient: The alloy at low temperature.",
      createdAt: now,
    });
    const failedId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "failed",
      requestedBy: ownerId,
      candidateMode: "single",
      singleModelId: "claude-sonnet-5",
      previousProjectStatus: "review",
      startedAt: now,
    });
    const partialId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "awaiting_selection",
      requestedBy: ownerId,
      candidateMode: "compare",
      compareModelIds: ["claude-sonnet-5", "google/gemini-3.1-pro-preview"],
      previousProjectStatus: "review",
      startedAt: now,
    });
    const completedId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "completed",
      requestedBy: ownerId,
      candidateMode: "single",
      singleModelId: "claude-sonnet-5",
      previousProjectStatus: "review",
      startedAt: now,
    });
    const iterativeId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "awaiting_input",
      requestedBy: ownerId,
      candidateMode: "iterative",
      singleModelId: "claude-sonnet-5",
      previousProjectStatus: "review",
      startedAt: now,
    });
    const runningId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "running",
      requestedBy: ownerId,
      candidateMode: "single",
      singleModelId: "claude-sonnet-5",
      previousProjectStatus: "review",
      startedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      generationId: completedId,
      content: REPORT_DOC,
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 0,
    });
    const proposalId = await ctx.db.insert("chatProposals", {
      agentThreadId: "reg-thread",
      projectId,
      reportId,
      kind: "edit",
      targetText: "Original prose.",
      newText: "Changed prose.",
      state: "pending",
      createdAt: now,
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "pd.txt",
      fileType: "txt",
      content: "A written PD.",
      source: "chat_upload",
      uploadedBy: ownerId,
      createdAt: now,
    });
    const pdReviewId = await ctx.db.insert("pdReviews", {
      projectId,
      documentId,
      sourceFileName: "pd.txt",
      status: "failed",
      error: "failed",
      createdBy: ownerId,
      createdAt: now,
    });
    const commentId = await ctx.db.insert("comments", {
      projectId,
      reportId,
      commenterId: "client-1",
      commenterType: "client",
      highlightFrom: 1,
      highlightTo: 5,
      highlightText: "Orig",
      body: "Please check.",
      resolved: false,
      createdAt: now,
    });
    return {
      projectId,
      transcriptId,
      failedId,
      partialId,
      completedId,
      iterativeId,
      runningId,
      reportId,
      proposalId,
      documentId,
      pdReviewId,
      commentId,
    };
  });
  const as = (actor: Actor) => t.withIdentity({ subject: AUTH[actor] });
  return { t, as, ...ids };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
type Call = (f: Fixture, actor: Actor) => Promise<unknown>;

async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) {
      return String((data as { code: unknown }).code);
    }
    return `UNTYPED: ${(error as Error).message}`;
  }
  return "NO_ERROR";
}

async function expectGate(call: Call, allowed: Actor[] = ["owner", "assigned", "manager"]) {
  expect(await errorCode(async () => call(await setup(), "creator"))).toBe("NOT_AUTHORIZED");
  for (const actor of allowed) {
    expect(await errorCode(async () => call(await setup(), actor)), actor).not.toBe("NOT_AUTHORIZED");
  }
}

describe("generation entry points need report.editProse (a2 P1-1, a4 #5)", () => {
  it("requestGeneration", async () => {
    await expectGate((f, a) =>
      f.as(a).mutation(api.generations.requestGeneration, {
        projectId: f.projectId,
        candidateMode: "single",
        singleModelId: "claude-sonnet-5",
        confirmRegeneration: true,
      })
    );
  });

  it("requestGeneration refuses a non-owner before the regeneration check", async () => {
    const f = await setup();
    expect(
      await errorCode(() =>
        f.as("creator").mutation(api.generations.requestGeneration, { projectId: f.projectId })
      )
    ).toBe("NOT_AUTHORIZED");
    const generations = await f.t.run((ctx) =>
      ctx.db
        .query("generations")
        .withIndex("by_projectId", (q) => q.eq("projectId", f.projectId))
        .collect()
    );
    expect(generations).toHaveLength(5);
  });

  it("retryGeneration", async () => {
    await expectGate((f, a) =>
      f.as(a).mutation(api.generations.retryGeneration, { generationId: f.failedId })
    );
  });

  it("retryFailedCandidates", async () => {
    await expectGate((f, a) =>
      f.as(a).mutation(api.generations.retryFailedCandidates, { generationId: f.partialId })
    );
  });

  it("requestReportQa", async () => {
    await expectGate((f, a) =>
      f.as(a).mutation(api.generations.requestReportQa, { generationId: f.completedId })
    );
  });

  it("regenerateSectionDraft", async () => {
    await expectGate((f, a) =>
      f.as(a).mutation(api.generations.regenerateSectionDraft, {
        generationId: f.iterativeId,
        section: "s242",
      })
    );
  });

  it("cancelIterativeGeneration", async () => {
    await expectGate((f, a) =>
      f.as(a).mutation(api.generations.cancelIterativeGeneration, { generationId: f.iterativeId })
    );
  });

  it("stopOrderedGeneration", async () => {
    await expectGate((f, a) =>
      f.as(a).mutation(api.generations.stopOrderedGeneration, { generationId: f.runningId })
    );
  });
});

describe("proposal wording and reject need report.editProse (a2 P2-2)", () => {
  it("updateProposalWording", async () => {
    await expectGate((f, a) =>
      f.as(a).mutation(api.chatV2.updateProposalWording, {
        proposalId: f.proposalId,
        newText: "Injected prose.",
      })
    );
  });

  it("leaves the stored wording alone when a non-owner tries to reword it", async () => {
    const f = await setup();
    await errorCode(() =>
      f.as("creator").mutation(api.chatV2.updateProposalWording, {
        proposalId: f.proposalId,
        newText: "Injected prose.",
      })
    );
    const proposal = await f.t.run((ctx) => ctx.db.get(f.proposalId));
    expect(proposal?.newText).toBe("Changed prose.");
  });

  it("rejectProposal", async () => {
    await expectGate((f, a) =>
      f.as(a).mutation(api.chatV2.rejectProposal, { proposalId: f.proposalId })
    );
  });
});

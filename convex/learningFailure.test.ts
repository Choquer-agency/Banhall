/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import schema from "./schema";

const providerMocks = vi.hoisted(() => ({ createAnthropicClient: vi.fn() }));
vi.mock("./ai/providers", () => ({
  createAnthropicClient: providerMocks.createAnthropicClient,
}));
import {
  generateQaCalibrationDigest,
  generateDraftStyleDigest,
} from "./ai/learning";

const modules = import.meta.glob("./**/*.ts");
type DigestKind = "qa_calibration" | "draft_style";

async function seedSignals(t: ReturnType<typeof convexTest>, kind: DigestKind) {
  return t.run(async (ctx) => {
    const sources = await Promise.all(
      [0, 1].map(async (side) => {
        const userId = await ctx.db.insert("users", {
          authId: `writer-${side}`,
          role: "writer",
        });
        const projectId = await ctx.db.insert("projects", {
          title: "Trial",
          clientName: "Client",
          status: "draft",
          createdBy: userId,
          ownerId: userId,
          shareToken: `project-${side}`,
          createdAt: 1,
          updatedAt: 1,
        });
        const generationId = await ctx.db.insert("generations", {
          projectId,
          status: "completed",
          startedAt: 1,
        });
        const candidateId = await ctx.db.insert("reportCandidates", {
          projectId,
          generationId,
          model: "test",
          label: "test",
          content: "Original prose",
          agentOutputs: "{}",
          createdAt: 1,
        });
        return { userId, projectId, generationId, candidateId };
      }),
    );
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const source = sources[i % 2];
      const timestamp = 100 + i;
      ids.push(
        kind === "qa_calibration"
          ? await ctx.db.insert("qaItemFeedback", {
              projectId: source.projectId,
              userId: source.userId,
              targetKey: `target-${i}`,
              itemKey: `item-${i}`,
              itemKind: "issue",
              section: "242",
              itemText: "Explain the uncertainty",
              vote: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            })
          : await ctx.db.insert("candidateScores", {
              ...source,
              optionPosition: 1,
              model: "test",
              label: "test",
              score: 7,
              comment: "Explain the uncertainty",
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
      );
    }
    await ctx.db.insert("learningDigests", {
      kind,
      content: "Stable guidance",
      sourceCount: 5,
      feedbackCutoff: 1,
      model: "test",
      createdAt: 1,
    });
    return ids;
  });
}

async function publicationState(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => ({
    digests: await ctx.db.query("learningDigests").collect(),
    selections: await ctx.db.query("learningDigestSelections").collect(),
    candidates: await ctx.db.query("reportCandidates").collect(),
  }));
}

afterEach(() => vi.resetAllMocks());

describe.each(["qa_calibration", "draft_style"] satisfies DigestKind[])(
  "%s original generation failure",
  (kind) => {
    test.each([
      ["provider", false],
      ["provider", true],
      ["parse", false],
      ["parse", true],
    ] satisfies ["provider" | "parse", boolean][])(
      "preserves %s error identity when persistence rejects=%s and awaits the write",
      async (failure, persistenceRejects) => {
        const t = convexTest(schema, modules);
        const signalIds = await seedSignals(t, kind);
        const before = await publicationState(t);
        // The real SDK adapter can reject while decoding JSON. Inject at its
        // client boundary to retain a known exception identity without SDK wrapping.
        const original =
          failure === "provider"
            ? new Error("provider unavailable")
            : new SyntaxError("malformed provider JSON");
        const secondary = new Error("attempt persistence unavailable");
        const create = vi.fn().mockRejectedValue(original);
        providerMocks.createAnthropicClient.mockReturnValue({
          messages: { create },
        });
        let releaseWrite = () => {};
        const writeGate = new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
        let enteredWrite = () => {};
        const writeEntered = new Promise<void>((resolve) => {
          enteredWrite = resolve;
        });
        const mutationCalls: { name: string; args: unknown }[] = [];
        let writeFinished = false;
        let actionSettled = false;
        const action = t
          .action(async (ctx) => {
            const runMutation: ActionCtx["runMutation"] = async (
              reference,
              ...args
            ) => {
              const name = getFunctionName(reference);
              mutationCalls.push({ name, args: args[0] });
              if (
                name === getFunctionName(internal.learning.recordDigestAttempt)
              ) {
                enteredWrite();
                await writeGate;
                writeFinished = true;
                if (persistenceRejects) throw secondary;
              }
              return ctx.runMutation(reference, ...args);
            };
            const registered =
              kind === "qa_calibration"
                ? generateQaCalibrationDigest
                : generateDraftStyleDigest;
            // Convex exposes this runtime hook but omits it from RegisteredAction.
            if (
              !("_handler" in registered) ||
              typeof registered._handler !== "function"
            ) {
              throw new Error("Registered action handler is unavailable");
            }
            await registered._handler({ ...ctx, runMutation }, {});
          })
          .catch((error: unknown) => {
            actionSettled = true;
            return error;
          });
        await writeEntered;
        expect(actionSettled).toBe(false);
        expect(writeFinished).toBe(false);
        releaseWrite();
        const escaped = await action;
        expect(writeFinished).toBe(true);
        expect(create).toHaveBeenCalledTimes(1);
        expect(mutationCalls).toHaveLength(1);
        expect(mutationCalls[0]).toEqual({
          name: getFunctionName(internal.learning.recordDigestAttempt),
          args: {
            kind,
            outcome: "failed",
            admission: expect.objectContaining({
              admittedCount: 5,
              excludedCount: 0,
              feedbackCutoff: 104,
              streams: expect.arrayContaining([
                expect.objectContaining({
                  stream:
                    kind === "qa_calibration"
                      ? "qaItemFeedback"
                      : "candidateScores",
                  writerCount: 2,
                  projectCount: 2,
                  signalIds: expect.arrayContaining(signalIds),
                }),
              ]),
            }),
          },
        });
        const attempts = await t.run((ctx) =>
          ctx.db.query("learningDigestAttempts").collect(),
        );
        expect(attempts).toHaveLength(persistenceRejects ? 0 : 1);
        if (!persistenceRejects) {
          const payload = mutationCalls[0].args;
          if (payload === null || typeof payload !== "object")
            throw new Error("Missing attempt payload");
          expect(attempts[0]).toMatchObject(payload);
        }
        expect(await publicationState(t)).toEqual(before);
        expect(escaped).toBe(original);
      },
    );
  },
);

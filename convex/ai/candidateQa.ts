/** Score each completed Compare draft while the writer considers the options. */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { detectFirstPersonPreference } from "../../shared/humanProse";
import { LEGACY_MODEL } from "../../shared/generationModels";
import { normalizeStyleOverrides, type StyleOverrides } from "../../shared/styleOverrides";
import { parseTranscriptAnalysis } from "./analyzerAgent";
import { normalizeChronology, runChronologyAgent } from "./chronologyAgent";
import { qaSourceEvidenceFor, runQAAgent } from "./qaAgent";
import { generationStepClients, registerGenerationModels, startActionDeadline } from "./providers";

type FrozenOutputs = {
  analyzer: unknown;
  section242: string;
  section244: string;
  section246: string;
  styleOverrides?: Partial<StyleOverrides>;
  frozenQaInputs?: {
    qaCalibration: string | null;
    qaCalibrationDigestId: Id<"learningDigests"> | null;
    writerFlavor: string | null;
  };
};

function readFrozenOutputs(json: string): FrozenOutputs {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== "object" ||
    !("analyzer" in value) || !("section242" in value) ||
    !("section244" in value) || !("section246" in value) ||
    typeof value.section242 !== "string" || typeof value.section244 !== "string" ||
    typeof value.section246 !== "string") {
    throw new Error("Candidate QA inputs are missing");
  }
  return value as FrozenOutputs;
}

export const runCandidateQa = internalAction({
  args: { candidateRunId: v.id("generationCandidateRuns") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    startActionDeadline(ctx);
    const input = await ctx.runMutation(internal.generations.claimCandidateQa, args);
    if (!input) return null;
    try {
      const outputs = readFrozenOutputs(input.agentOutputs);
      const analysis = parseTranscriptAnalysis(JSON.stringify(outputs.analyzer));
      const freeze = await registerGenerationModels(ctx, input.generationId).catch(() => null);
      const steps = generationStepClients(ctx, {
        freeze,
        writerModel: input.model,
        meta: (callSite, learningDigestIds) => ({
          callSite,
          projectId: input.projectId,
          ...(input.requestedBy ? { userId: input.requestedBy } : {}),
          attribution: {
            generationId: input.generationId,
            candidateRunId: args.candidateRunId,
            ...(learningDigestIds?.length ? { learningDigestIds } : {}),
          },
        }),
      });
      const frozen = outputs.frozenQaInputs;
      const digestIds = frozen?.qaCalibration?.trim() && frozen.qaCalibrationDigestId
        ? [frozen.qaCalibrationDigestId] : undefined;
      const evidence = await qaSourceEvidenceFor(ctx, input.generationId, [
        outputs.section242, outputs.section244, outputs.section246,
      ]);
      const [qaResult, chronologyResult] = await Promise.allSettled([
        runQAAgent(
          steps.client("generation:qa", digestIds),
          analysis,
          outputs.section242,
          outputs.section244,
          outputs.section246,
          steps.route("generation:qa").model || LEGACY_MODEL,
          frozen?.qaCalibration ?? undefined,
          normalizeStyleOverrides(outputs.styleOverrides),
          detectFirstPersonPreference(frozen?.writerFlavor),
          evidence,
          input.claimantName
        ),
        input.earlyChronology
          ? Promise.resolve(normalizeChronology(input.earlyChronology))
          : runChronologyAgent(
              steps.client("generation:post_chronology"),
              analysis,
              steps.route("generation:post_chronology").model || LEGACY_MODEL
            ),
      ]);
      if (qaResult.status === "rejected") {
        console.error("Compare candidate QA failed", args.candidateRunId, qaResult.reason);
      }
      if (chronologyResult.status === "rejected") {
        console.error("Compare candidate chronology failed", args.candidateRunId, chronologyResult.reason);
      }
      await ctx.runMutation(internal.generations.saveCandidateQa, {
        candidateRunId: args.candidateRunId,
        startedAt: input.startedAt,
        ...(qaResult.status === "fulfilled" ? { qa: JSON.stringify(qaResult.value) } : { failed: true }),
        ...(chronologyResult.status === "fulfilled"
          ? { chronology: JSON.stringify(chronologyResult.value) } : {}),
      });
    } catch (error) {
      console.error("Compare candidate QA could not finish", args.candidateRunId, error);
      await ctx.runMutation(internal.generations.saveCandidateQa, {
        candidateRunId: args.candidateRunId,
        startedAt: input.startedAt,
        failed: true,
      });
    }
    return null;
  },
});

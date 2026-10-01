"use node";

import { requireTextResponse, type GenerationClient } from "./openrouterCore";
import { MODEL } from "./model";
import { sectionAnswerTokenBudget } from "../../shared/generationModels";
import {
  SECTION_DRAFT_SCAFFOLD,
  buildSection242Instructions,
  buildSectionDraftRequest,
} from "./prompts";
import type { StyleOverrides } from "../../shared/styleOverrides";
import type { TranscriptAnalysis } from "./analyzerAgent";

export const SECTION_242_REQUEST = {
  // Shared by all three lines since cost phase 1: the analysis forms a
  // cached prefix; `taskMarker` is how this line's instructions open.
  userPrefix: SECTION_DRAFT_SCAFFOLD.sharedPrefix,
  taskMarker: "Your task is to draft Line 242 ",
  layout: SECTION_DRAFT_SCAFFOLD,
  runtimeSentinels: [
    "{{runtime.transcriptAnalysis}}",
    "{{runtime.brainExemplars}}",
    "{{runtime.lengthBudget}}",
    "{{runtime.styleGuidance}}",
    "{{runtime.contentPlan}}",
  ],
  roleOrder: ["system", "user"],
  systemTemplate: "writing.sectionSharedSystem",
  jsonIndentation: 2,
  modelSelector: "candidate-model-or-default",
  maxTokensSelector: "section-answer-token-budget",
  thinking: { type: "disabled" },
} as const;

export async function runSection242Agent(
  client: GenerationClient,
  analysis: TranscriptAnalysis,
  model: string = MODEL,
  brainExemplars: string = "",
  lengthBudget: string = "",
  styleGuidance: string = "",
  styleOverrides?: StyleOverrides,
  // Story 1 (CAP-1/2/4): the stored Brief, rendered as an AD-11 data block.
  briefBlock: string = "",
  contentPlanBlock: string = ""
): Promise<string> {
  const request = buildSectionDraftRequest({
    instructions: buildSection242Instructions(styleOverrides),
    analysisJson: JSON.stringify(analysis, null, SECTION_242_REQUEST.jsonIndentation),
    ...(styleOverrides ? { styleOverrides } : {}),
    brainExemplars,
    lengthBudget,
    styleGuidance,
    contentPlanBlock,
    briefBlock,
  });
  const response = await client.messages.create({
    model,
    max_tokens: sectionAnswerTokenBudget(model),
    thinking: SECTION_242_REQUEST.thinking,
    system: request.system,
    messages: request.messages,
  });

  return requireTextResponse(response, "Section 242 agent");
}

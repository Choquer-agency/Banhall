"use node";

import { requireTextResponse, type GenerationClient } from "./openrouterCore";
import { MODEL } from "./model";
import { sectionAnswerTokenBudget } from "../../shared/generationModels";
import { buildSection244SystemPrompt } from "./prompts";
import type { StyleOverrides } from "../../shared/styleOverrides";
import type { TranscriptAnalysis } from "./analyzerAgent";

export const SECTION_244_REQUEST = {
  userPrefix:
    "Here is the structured transcript analysis. Use ONLY this information to draft Section 244.\n\n",
  runtimeSentinels: [
    "{{runtime.transcriptAnalysis}}",
    "{{runtime.brainExemplars}}",
    "{{runtime.lengthBudget}}",
    "{{runtime.styleGuidance}}",
  ],
  roleOrder: ["system", "user"],
  jsonIndentation: 2,
  modelSelector: "candidate-model-or-default",
  maxTokensSelector: "section-answer-token-budget",
  thinking: { type: "disabled" },
} as const;

export async function runSection244Agent(
  client: GenerationClient,
  analysis: TranscriptAnalysis,
  model: string = MODEL,
  brainExemplars: string = "",
  lengthBudget: string = "",
  styleGuidance: string = "",
  styleOverrides?: StyleOverrides
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: sectionAnswerTokenBudget(model),
    thinking: SECTION_244_REQUEST.thinking,
    system: buildSection244SystemPrompt(styleOverrides),
    messages: [
      {
        role: "user",
        content: `${SECTION_244_REQUEST.userPrefix}${JSON.stringify(analysis, null, SECTION_244_REQUEST.jsonIndentation)}${brainExemplars}${lengthBudget}${styleGuidance}`,
      },
    ],
  });

  return requireTextResponse(response, "Section 244 agent");
}

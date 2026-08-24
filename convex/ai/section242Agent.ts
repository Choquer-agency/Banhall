"use node";

import { requireTextResponse, type GenerationClient } from "./openrouterCore";
import { MODEL } from "./model";
import { sectionAnswerTokenBudget } from "../../shared/generationModels";
import { buildSection242SystemPrompt } from "./prompts";
import type { StyleOverrides } from "../../shared/styleOverrides";
import type { TranscriptAnalysis } from "./analyzerAgent";

export async function runSection242Agent(
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
    thinking: { type: "disabled" },
    system: buildSection242SystemPrompt(styleOverrides),
    messages: [
      {
        role: "user",
        content: `Here is the structured transcript analysis. Use ONLY this information to draft Section 242.\n\n${JSON.stringify(analysis, null, 2)}${brainExemplars}${lengthBudget}${styleGuidance}`,
      },
    ],
  });

  return requireTextResponse(response, "Section 242 agent");
}

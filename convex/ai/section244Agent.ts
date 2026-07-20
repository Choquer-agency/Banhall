"use node";

import type { GenerationClient } from "./openrouterCore";
import { MODEL } from "./model";
import { SECTION_244_SYSTEM_PROMPT } from "./prompts";
import type { TranscriptAnalysis } from "./analyzerAgent";

export async function runSection244Agent(
  client: GenerationClient,
  analysis: TranscriptAnalysis,
  model: string = MODEL,
  brainExemplars: string = "",
  lengthBudget: string = "",
  styleGuidance: string = ""
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SECTION_244_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Here is the structured transcript analysis. Use ONLY this information to draft Section 244.\n\n${JSON.stringify(analysis, null, 2)}${brainExemplars}${lengthBudget}${styleGuidance}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  if (!text.trim()) {
    throw new Error("Section 244 agent returned empty response");
  }

  return text.trim();
}

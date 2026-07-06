"use node";

import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "./model";
import { SECTION_242_SYSTEM_PROMPT } from "./prompts";
import type { TranscriptAnalysis } from "./analyzerAgent";

export async function runSection242Agent(
  client: Anthropic,
  analysis: TranscriptAnalysis,
  model: string = MODEL,
  brainExemplars: string = "",
  lengthBudget: string = ""
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SECTION_242_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Here is the structured transcript analysis. Use ONLY this information to draft Section 242.\n\n${JSON.stringify(analysis, null, 2)}${brainExemplars}${lengthBudget}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  if (!text.trim()) {
    throw new Error("Section 242 agent returned empty response");
  }

  return text.trim();
}

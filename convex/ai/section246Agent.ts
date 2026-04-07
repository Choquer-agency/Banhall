"use node";

import Anthropic from "@anthropic-ai/sdk";
import { SECTION_246_SYSTEM_PROMPT } from "./prompts";
import { TranscriptAnalysis } from "./analyzerAgent";

export async function runSection246Agent(
  client: Anthropic,
  analysis: TranscriptAnalysis
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SECTION_246_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Here is the structured transcript analysis. Use ONLY this information to draft Section 246.\n\n${JSON.stringify(analysis, null, 2)}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  if (!text.trim()) {
    throw new Error("Section 246 agent returned empty response");
  }

  return text.trim();
}

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructured } from "./structured";
import { MalformedOutputError, type GenerationClient } from "./openrouterCore";

function clientWith(inputs: unknown[]): GenerationClient {
  let index = 0;
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [
          {
            type: "tool_use" as const,
            id: `tool-${index}`,
            name: "submit",
            input: inputs[index++],
          },
        ],
      })),
    },
  };
}

describe("generateStructured", () => {
  it("retries once with validation feedback and accepts the repaired object", async () => {
    const client = clientWith([{ other: "missing" }, { required: "present" }]);
    const result = await generateStructured(client, {
      system: "system",
      user: "user",
      toolName: "submit",
      description: "submit",
      validate: z.object({ required: z.string() }),
    });
    expect(result).toEqual({ required: "present" });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    const second = vi.mocked(client.messages.create).mock.calls[1][0];
    expect(second.messages[0].content).toContain("required: Invalid input");
  });

  it("fails after one bounded repair attempt", async () => {
    const client = clientWith([{ other: "missing" }, { still: "missing" }]);
    await expect(
      generateStructured(client, {
        system: "system",
        user: "user",
        toolName: "submit",
        description: "submit",
        validate: z.object({ required: z.string() }),
      })
    ).rejects.toThrow(/required/);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("spends the repair attempt on a retryable OpenRouter decode failure", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        new MalformedOutputError(
          'OpenRouter tool call "submit" returned malformed JSON arguments'
        )
      )
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use" as const,
            id: "tool-1",
            name: "submit",
            input: { required: "present" },
          },
        ],
      });
    const client: GenerationClient = { messages: { create } };
    const result = await generateStructured(client, {
      system: "system",
      user: "user",
      toolName: "submit",
      description: "submit",
      validate: z.object({ required: z.string() }),
    });
    expect(result).toEqual({ required: "present" });
    expect(create).toHaveBeenCalledTimes(2);
    const second = create.mock.calls[1][0];
    expect(second.messages[0].content).toContain("malformed JSON arguments");
  });

  it("fails fast on provider errors without spending the repair attempt", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Object.assign(
          new Error("OpenRouter request failed with status 401: bad key"),
          { status: 401 }
        )
      );
    const client: GenerationClient = { messages: { create } };
    await expect(
      generateStructured(client, {
        system: "system",
        user: "user",
        toolName: "submit",
        description: "submit",
        validate: z.object({ required: z.string() }),
      })
    ).rejects.toThrow(/status 401/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the decode failure repeats on the retry", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        new MalformedOutputError(
          "OpenRouter response was truncated at the max_tokens limit before completing"
        )
      );
    const client: GenerationClient = { messages: { create } };
    await expect(
      generateStructured(client, {
        system: "system",
        user: "user",
        toolName: "submit",
        description: "submit",
        validate: z.object({ required: z.string() }),
      })
    ).rejects.toThrow(/truncated/);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

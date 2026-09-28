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

  it("preserves legacy encoded-root recovery", async () => {
    const client = clientWith([JSON.stringify({ required: "present" })]);
    await expect(generateStructured(client, {
      system: "system",
      user: "user",
      toolName: "submit",
      description: "submit",
      validate: z.object({ required: z.string() }),
    })).resolves.toEqual({ required: "present" });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("can reject an encoded root without a recovery attempt", async () => {
    const client = clientWith([JSON.stringify({ required: "present" })]);
    await expect(generateStructured(client, {
      system: "system",
      user: "user",
      toolName: "submit",
      description: "submit",
      validate: z.object({ required: z.string() }),
      attempts: 1,
      encodedJsonRecovery: false,
    })).rejects.toThrow("unexpected shape");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
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

  describe("soft repair (2026-09-27, third amendment)", () => {
    const opts = {
      system: "system",
      user: "user",
      toolName: "submit",
      description: "submit",
      validate: z.object({ quote: z.string() }),
      softRepair: {
        ask: (value: { quote: string }, answer: unknown) =>
          value.quote === "weak" ? `\n\nQuote the line that backs it. Earlier: ${JSON.stringify(answer)}` : null,
      },
    };

    it("spends the one repair on a valid answer, with its own text and the earlier answer, and returns the repaired one", async () => {
      const client = clientWith([{ quote: "weak" }, { quote: "strong" }]);
      await expect(generateStructured(client, opts)).resolves.toEqual({ quote: "strong" });
      expect(client.messages.create).toHaveBeenCalledTimes(2);
      const second = vi.mocked(client.messages.create).mock.calls[1][0];
      // Its own text, not the invalid-output scaffold.
      expect(second.messages[0].content).toBe('user\n\nQuote the line that backs it. Earlier: {"quote":"weak"}');
    });

    it("may decide asynchronously", async () => {
      const client = clientWith([{ quote: "weak" }, { quote: "strong" }]);
      const ask = vi.fn(async (value: { quote: string }) => (value.quote === "weak" ? "\n\nAgain." : null));
      await expect(generateStructured(client, { ...opts, softRepair: { ask } })).resolves.toEqual({ quote: "strong" });
      expect(ask).toHaveBeenCalledTimes(1);
      expect(client.messages.create).toHaveBeenCalledTimes(2);
    });

    it("keeps the first answer when the repaired one is not better", async () => {
      const client = clientWith([{ quote: "weak" }, { quote: "worse" }]);
      const keepRepaired = vi.fn(async (_first: { quote: string }, repaired: { quote: string }) => repaired.quote === "strong");
      await expect(generateStructured(client, { ...opts, softRepair: { ...opts.softRepair, keepRepaired } })).resolves.toEqual({
        quote: "weak",
      });
      expect(keepRepaired).toHaveBeenCalledWith({ quote: "weak" }, { quote: "worse" });
      expect(client.messages.create).toHaveBeenCalledTimes(2);
    });

    it("treats an error while asking as no repair", async () => {
      const client = clientWith([{ quote: "weak" }, { quote: "strong" }]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ask = vi.fn(async () => {
        throw new Error("read failed");
      });
      await expect(generateStructured(client, { ...opts, softRepair: { ask } })).resolves.toEqual({ quote: "weak" });
      expect(client.messages.create).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain("read failed");
      warn.mockRestore();
    });

    it("keeps the first answer when judging the repaired one fails", async () => {
      const client = clientWith([{ quote: "weak" }, { quote: "strong" }]);
      const keepRepaired = vi.fn(async () => {
        throw new Error("read failed");
      });
      await expect(generateStructured(client, { ...opts, softRepair: { ...opts.softRepair, keepRepaired } })).resolves.toEqual({
        quote: "weak",
      });
    });

    it("sends a hard repair its own scaffold after a soft repair's answer fails validation", async () => {
      const client = clientWith([{ quote: "weak" }, { other: "missing" }, { quote: "strong" }]);
      await expect(generateStructured(client, { ...opts, attempts: 3 })).resolves.toEqual({ quote: "strong" });
      const third = vi.mocked(client.messages.create).mock.calls[2][0];
      expect(third.messages[0].content).toContain("Your previous tool output was invalid");
      expect(third.messages[0].content).not.toContain("Quote the line that backs it.");
    });

    it("returns the repaired answer as it is, without asking again", async () => {
      const client = clientWith([{ quote: "weak" }, { quote: "weak" }, { quote: "strong" }]);
      await expect(generateStructured(client, { ...opts, attempts: 3 })).resolves.toEqual({ quote: "weak" });
      expect(client.messages.create).toHaveBeenCalledTimes(2);
    });

    it("keeps the first answer when the repair returns an invalid shape", async () => {
      const client = clientWith([{ quote: "weak" }, { other: "missing" }]);
      await expect(generateStructured(client, opts)).resolves.toEqual({ quote: "weak" });
      expect(client.messages.create).toHaveBeenCalledTimes(2);
    });

    it("keeps the first answer when the repair request fails", async () => {
      const create = vi
        .fn()
        .mockResolvedValueOnce({ content: [{ type: "tool_use", id: "tool-0", name: "submit", input: { quote: "weak" } }] })
        .mockRejectedValueOnce(Object.assign(new Error("OpenRouter request failed with status 529: overloaded"), { status: 529 }));
      const client: GenerationClient = { messages: { create } };
      await expect(generateStructured(client, opts)).resolves.toEqual({ quote: "weak" });
      expect(create).toHaveBeenCalledTimes(2);
    });

    it("never asks on the last attempt, so a hard repair is not spent twice", async () => {
      const client = clientWith([{ other: "missing" }, { quote: "weak" }]);
      await expect(generateStructured(client, opts)).resolves.toEqual({ quote: "weak" });
      expect(client.messages.create).toHaveBeenCalledTimes(2);
    });

    it("accepts a good first answer in one request", async () => {
      const client = clientWith([{ quote: "strong" }]);
      await expect(generateStructured(client, opts)).resolves.toEqual({ quote: "strong" });
      expect(client.messages.create).toHaveBeenCalledTimes(1);
    });
  });
});

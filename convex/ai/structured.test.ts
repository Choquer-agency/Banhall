import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { decodeEncodedToolFields, generateStructured } from "./structured";
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

  describe("several tools offered (PR #22 review G13)", () => {
    const toolList = [
      { name: "submit_shared", description: "shared", input_schema: { type: "object" as const } },
      { name: "submit_linked", description: "linked", input_schema: { type: "object" as const } },
    ];
    const opts = {
      system: "system",
      user: "user",
      toolName: "submit_linked",
      description: "linked",
      tools: toolList,
      validate: z.object({ value: z.string() }),
    };
    const call = (name: string, input: unknown, id = name) => ({ type: "tool_use" as const, id, name, input });

    it("never accepts another tool's answer, even a valid one: it spends the repair, which names the right tool", async () => {
      const create = vi
        .fn()
        .mockResolvedValueOnce({ content: [call("submit_shared", { value: "from the wrong tool" })] })
        .mockResolvedValueOnce({ content: [call("submit_linked", { value: "right" })] });
      const onWrongTool = vi.fn();
      const invalidAnswerRepair = vi.fn(() => "\n\nEarlier answer shown.");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        generateStructured({ messages: { create } }, { ...opts, onWrongTool, invalidAnswerRepair })
      ).resolves.toEqual({ value: "right" });
      error.mockRestore();
      expect(onWrongTool).toHaveBeenCalledWith("submit_shared", { value: "from the wrong tool" });
      expect(invalidAnswerRepair).toHaveBeenCalledWith({ value: "from the wrong tool" });
      const second = create.mock.calls[1][0];
      expect(second.messages[0].content).toBe(
        "user\n\nYour previous tool output was invalid: it called submit_shared, but this request must be answered with submit_linked. Return the complete tool object and include every required field.\n\nEarlier answer shown."
      );
      // The same tools and forced choice in the repair.
      expect(second.tools).toEqual(toolList);
      expect(second.tool_choice).toEqual({ type: "tool", name: "submit_linked" });
    });

    it("fails with a validation error when no attempt is left, and never repeats a name no tool has", async () => {
      const create = vi.fn().mockResolvedValue({ content: [call("made_up_tool", { value: "x" })] });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const failure = await generateStructured({ messages: { create } }, opts).catch((caught: unknown) => caught);
      error.mockRestore();
      expect(failure).toMatchObject({
        name: "StructuredValidationError",
        issues: [{ path: "(root)", code: "wrong_tool" }],
      });
      expect(create).toHaveBeenCalledTimes(2);
      const repair = create.mock.calls[1][0].messages[0].content as string;
      expect(repair).toContain("it called a tool this request does not offer, but this request must be answered with submit_linked");
      expect(repair).not.toContain("made_up_tool");
    });

    it("takes the intended tool's call when the answer holds several", async () => {
      const create = vi.fn().mockResolvedValue({
        content: [call("submit_shared", { value: "shared" }), call("submit_linked", { value: "linked" })],
      });
      await expect(generateStructured({ messages: { create } }, opts)).resolves.toEqual({ value: "linked" });
      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});

// 2026-10-04 (first), Round 3 (owner approved 2026-10-05): a field the schema
// wants as an object or array that arrived as JSON text.
describe("decodeEncodedToolFields and encodedFieldRecovery (Round 3)", () => {
  const schema = {
    type: "object" as const,
    properties: {
      categories: {
        type: "object",
        properties: { a: { type: "object", properties: { on: { type: "boolean" } } } },
      },
      items: { type: "array", items: { type: "object" } },
      note: { type: ["string", "null"] },
    },
    required: ["categories", "items"],
  };
  const validate = z.object({
    categories: z.object({ a: z.object({ on: z.boolean() }) }),
    items: z.array(z.object({})),
    note: z.string().nullable().optional(),
  });

  it("reads object and array fields sent as JSON text, nested ones too, and names their paths", () => {
    const sent = {
      categories: JSON.stringify({ a: JSON.stringify({ on: true }) }),
      items: "[{}]",
      note: '{"kept": "as text"}',
    };
    expect(decodeEncodedToolFields(sent, schema)).toEqual({
      value: { categories: { a: { on: true } }, items: [{}], note: '{"kept": "as text"}' },
      paths: ["categories", "categories.a", "items"],
      unread: [],
    });
  });

  it("leaves a string that is not JSON, JSON of another shape and a field whose type allows a string as sent", () => {
    for (const [sent, unread] of [
      [{ categories: "a is on", items: [] }, ["categories"]],
      [{ categories: "[1, 2]", items: '{"not": "an array"}' }, ["categories", "items"]],
      [{ categories: { a: { on: true } }, items: [], note: "[1]" }, []],
    ] as const) {
      const read = decodeEncodedToolFields(sent, schema);
      expect(read).toMatchObject({ value: sent, paths: [] });
      expect(read.unread.map((field) => field.path)).toEqual(unread);
    }
  });

  // 2026-10-04 (first), Round 4: release suite run 3 of 2026-10-05 still
  // failed live with "categories: expected object, received string", and
  // nothing was read, so the text was not plain JSON of the object.
  it.each([
    ["a code fence", '```json\n{"a": {"on": true}}\n```'],
    ["a bare code fence", '```\n{"a": {"on": true}}\n```'],
    ["prose around one object", 'Here is the classification: {"a": {"on": true}} I hope this helps.'],
    ["a JSON string whose content is the JSON", JSON.stringify('{"a": {"on": true}}')],
    ["trailing commas", '{"a": {"on": true,},}'],
    ["a code fence with trailing commas", '```json\n{"a": {"on": true,},}\n```'],
  ])("reads an object field sent in %s (Round 4)", (_label, sent) => {
    expect(decodeEncodedToolFields({ categories: sent, items: [] }, schema)).toEqual({
      value: { categories: { a: { on: true } }, items: [] },
      paths: ["categories"],
      unread: [],
    });
  });

  it("guesses nothing else: single-quoted keys, two objects in prose, a broken object and an array around one object stay unread (Round 4)", () => {
    for (const sent of ["{'a': {'on': true}}", 'First {"a": {"on": true}} then {"b": 1}.', '{"a": {"on": true}', '[{"a": {"on": true}}]']) {
      const read = decodeEncodedToolFields({ categories: sent, items: [] }, schema);
      expect(read).toMatchObject({ value: { categories: sent }, paths: [] });
      expect(read.unread).toHaveLength(1);
    }
  });

  it("describes a field it could not read by its shape and by why each way failed, never by its text (Round 4)", async () => {
    const sent = "{'a': {'on': true}} secret wording";
    const read = decodeEncodedToolFields({ categories: sent, items: [] }, schema);
    expect(read.unread).toEqual([{
      path: "categories",
      description:
        "a string of 34 characters, first non-space a brace, last non-space a letter, no code fence; as JSON: failed at character 1; in a code fence: no code fence; the object within the text: failed at character 1; as the rest of the answer: failed at character 1",
    }]);
    // generateStructured logs it with the opt-in, and the log holds no text of it.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(generateStructured(clientWith([{ categories: sent, items: [] }]), {
      system: "system", user: "user", toolName: "submit", description: "submit",
      schema, validate, attempts: 1, encodedFieldRecovery: true,
    })).rejects.toThrow("unexpected shape: categories: Invalid input: expected object, received string");
    const logged = errors.mock.calls.map((call) => call.map(String).join(" "));
    errors.mockRestore();
    expect(logged).toContain(`submit: could not read categories sent as text: ${read.unread[0]!.description}`);
    expect(logged.join("\n")).not.toContain("secret");
    expect(logged.join("\n")).not.toContain("'a'");
  });

  // Release suite run 4 of 2026-10-05: "a string of 1464 characters, first
  // non-space "{", last non-space "]", ... as JSON: failed at character 386":
  // the model put the rest of its answer inside the field.
  it("reads the rest of the answer sent inside a field, its siblings declared in the schema (run 4)", () => {
    const sent = { categories: '{"a": {"on": true}}, "items": [{}], "note": null' };
    expect(decodeEncodedToolFields(sent, schema)).toEqual({
      value: { categories: { a: { on: true } }, items: [{}], note: null },
      paths: ["categories", "items (inside categories)", "note (inside categories)"],
      unread: [],
    });
    // A sibling the model also sent beside it, with the same value, agrees.
    expect(decodeEncodedToolFields({ ...sent, items: [{}] }, schema).unread).toEqual([]);
  });

  it("keeps the rest of the answer unread when a smuggled key is not in the schema, or disagrees with a value sent beside it (run 4)", () => {
    const unknown = decodeEncodedToolFields({ categories: '{"a": {"on": true}}, "secretKey": [1]' }, schema);
    expect(unknown).toMatchObject({ value: { categories: '{"a": {"on": true}}, "secretKey": [1]' }, paths: [] });
    expect(unknown.unread[0]!.description).toMatch(/; as the rest of the answer: read, but 1 key is not in the tool schema$/);
    expect(unknown.unread[0]!.description).not.toContain("secretKey");
    const conflict = decodeEncodedToolFields({ categories: '{"a": {"on": true}}, "items": [{}]', items: [] }, schema);
    expect(conflict).toMatchObject({ paths: [] });
    expect(conflict.unread[0]!.description).toMatch(/; as the rest of the answer: read, but items disagrees with the value sent beside it$/);
    // Text that is JSON of its own is never read this way.
    const json = decodeEncodedToolFields({ categories: "[1]", items: [] }, schema);
    expect(json.unread[0]!.description).toMatch(/; as the rest of the answer: not tried, the text is JSON of its own$/);
  });

  it("with encodedFieldRecovery, the run 4 shape validates as one answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = clientWith([{ categories: '{"a": {"on": true}}, "items": [{}]' }]);
    await expect(generateStructured(client, {
      system: "system", user: "user", toolName: "submit", description: "submit",
      schema, validate, attempts: 1, encodedFieldRecovery: true,
    })).resolves.toEqual({ categories: { a: { on: true } }, items: [{}] });
    expect(warn).toHaveBeenCalledWith("submit: read categories, items (inside categories) sent as JSON text");
    warn.mockRestore();
  });

  it("is off by default: another caller's answer with a field sent as JSON text still fails as before", async () => {
    const client = clientWith([{ categories: '{"a": {"on": true}}', items: [] }]);
    await expect(generateStructured(client, {
      system: "system", user: "user", toolName: "submit", description: "submit",
      schema, validate, attempts: 1,
    })).rejects.toThrow("unexpected shape: categories");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("with encodedFieldRecovery, reads it in the same attempt and validates it as usual", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = clientWith([{ categories: '{"a": {"on": true}}', items: [] }]);
    await expect(generateStructured(client, {
      system: "system", user: "user", toolName: "submit", description: "submit",
      schema, validate, attempts: 1, encodedFieldRecovery: true,
    })).resolves.toEqual({ categories: { a: { on: true } }, items: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("submit: read categories sent as JSON text");
    warn.mockRestore();
  });

  it("with encodedFieldRecovery, an answer that fails once read reports what fails then, not the encoding (review P3)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = clientWith([{ categories: '{"b": {"on": true}}', items: [] }]);
    const failure = generateStructured(client, {
      system: "system", user: "user", toolName: "submit", description: "submit",
      schema, validate, attempts: 1, encodedFieldRecovery: true,
    });
    await expect(failure).rejects.toThrow("submit: model returned an unexpected shape: categories.a: Invalid input");
    await expect(failure).rejects.not.toThrow("received string");
    const logged = quiet.mock.calls.map((call) => call.join(" "));
    expect(logged.some((line) => line.startsWith("submit: tool output failed validation after reading categories sent as JSON text") && line.includes('"categories","a"'))).toBe(true);
    quiet.mockRestore();
    // With nothing read, the issues are the answer's as sent, as before.
    const plain = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(generateStructured(clientWith([{ categories: "a is on", items: [] }]), {
      system: "system", user: "user", toolName: "submit", description: "submit",
      schema, validate, attempts: 1, encodedFieldRecovery: true,
    })).rejects.toThrow("unexpected shape: categories: Invalid input: expected object, received string");
    expect(plain.mock.calls.map((call) => String(call[0]))).toContain("submit: tool output failed validation");
    plain.mockRestore();
  });

  it("with encodedFieldRecovery, a field that is not JSON or that fails validation once read still fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const input of [
      { categories: "a is on", items: [] },
      { categories: '{"a": {"on": "yes"}}', items: [] },
      { categories: '{"a": {"on": true}}' },
    ]) {
      const client = clientWith([input]);
      await expect(generateStructured(client, {
        system: "system", user: "user", toolName: "submit", description: "submit",
        schema, validate, attempts: 1, encodedFieldRecovery: true,
      })).rejects.toThrow("unexpected shape");
      expect(client.messages.create).toHaveBeenCalledTimes(1);
    }
    quiet.mockRestore();
  });
});

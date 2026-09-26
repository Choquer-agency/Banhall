import { describe, expect, test } from "vitest";
import { jsonSchemaErrors, matchesJsonSchema } from "./jsonSchema";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
      items: { type: "string", enum: ["a", "b"] },
    },
    count: { type: "integer", minimum: 0 },
    note: { type: ["string", "null"] },
  },
};

describe("JSON Schema subset", () => {
  test("accepts a value that satisfies every keyword", () => {
    expect(matchesJsonSchema({ items: ["a"], count: 0, note: null }, schema)).toBe(true);
  });

  test.each([
    ["missing required", { count: 1 }, "$.items: required"],
    ["extra property", { items: ["a"], extra: 1 }, "$.extra: not allowed"],
    ["enum", { items: ["c"] }, "$.items[0]: not one of the allowed values"],
    ["too many", { items: ["a", "b", "a"] }, "$.items: more than 2 items"],
    ["not unique", { items: ["a", "a"] }, "$.items: items are not unique"],
    ["not an integer", { items: ["a"], count: 1.5 }, "$.count: expected integer"],
    ["below minimum", { items: ["a"], count: -1 }, "$.count: below 0"],
    ["wrong union type", { items: ["a"], note: 3 }, "$.note: expected string or null"],
  ])("reports %s", (_label, value, error) => {
    expect(jsonSchemaErrors(value, schema)).toContain(error);
  });
});

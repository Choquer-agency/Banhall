/**
 * Strict tool use for models that refuse a forced tool call (2026-10-26, live
 * check). On the unforced path Sonnet 5.5 sometimes wrote a list as tool
 * markup ("<parameter name=\"items\">[]") or as invalid JSON: the API then
 * sent the field as a string, or, with eager input streaming, the whole input
 * could not be read. With `strict: true` the API constrains sampling to the
 * tool's schema, so every required field arrives with its type. Anthropic's
 * migration notes name this as the replacement for a forced call's
 * guarantee.
 *
 * Strict schemas accept only part of JSON Schema (structured outputs, "JSON
 * Schema limitations", read 2026-10-26): every object needs
 * `additionalProperties: false`; number and length bounds, `maxItems`,
 * `minItems` above 1, `oneOf` and most `format` values are refused; one
 * request may hold at most 20 strict tools, 24 optional parameters and 16
 * parameters with union types across them. `strictToolSchema` drops what
 * strict refuses and names each dropped bound in the field's description,
 * so the model still reads it; the caller's runtime check (`validate` in
 * structured.ts) still enforces every bound.
 */

/** Bounds strict refuses; each is named in the description instead. */
const BOUND_WORDING: Record<string, (value: unknown) => string | null> = {
  minimum: (value) => `at least ${String(value)}`,
  maximum: (value) => `at most ${String(value)}`,
  exclusiveMinimum: (value) => `more than ${String(value)}`,
  exclusiveMaximum: (value) => `less than ${String(value)}`,
  multipleOf: (value) => `a multiple of ${String(value)}`,
  minLength: (value) => `at least ${String(value)} characters`,
  maxLength: (value) => `at most ${String(value)} characters`,
  minItems: (value) => (typeof value === "number" && value > 1 ? `at least ${value} items` : null),
  maxItems: (value) => `at most ${String(value)} ${value === 1 ? "item" : "items"}`,
  uniqueItems: (value) => (value === true ? "no repeated items" : null),
  minProperties: () => null,
  maxProperties: () => null,
};

/** String formats strict accepts; any other is dropped. */
const STRICT_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

/** Keywords strict refuses outright, with nothing to say instead (`oneOf` is handled on its own). */
const DROPPED = new Set(["not", "if", "then", "else", "dependentRequired", "dependentSchemas", "patternProperties", "pattern"]);

/** A description that already gives `value` as a bound ("at most 32 ... bytes"). */
function statesBound(description: string, value: unknown): boolean {
  if (typeof value !== "number") return false;
  return new RegExp(`\\b(at most|at least|up to|no more than|no fewer than|exactly)\\s+${value}\\b`, "i").test(description);
}

/**
 * The field names a `oneOf` of required-field choices (`[{required: ["a"]},
 * {required: ["b"]}]`) offers, or null for any other `oneOf`.
 */
function requiredChoices(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names: string[] = [];
  for (const branch of value) {
    if (!branch || typeof branch !== "object" || Array.isArray(branch)) return null;
    const keys = Object.keys(branch);
    const required = (branch as { required?: unknown }).required;
    if (keys.length !== 1 || keys[0] !== "required" || !Array.isArray(required) || required.length !== 1) return null;
    names.push(String(required[0]));
  }
  return names;
}

/** Keys whose value maps names to schemas, not keywords. */
const NAMED_SCHEMAS = new Set(["properties", "$defs", "definitions"]);

/** Keys whose value is data, never walked. */
const DATA = new Set(["description", "title", "enum", "const", "default", "examples", "required", "type"]);

export const STRICT_LIMITS = { tools: 20, optional: 24, unions: 16 } as const;

export type StrictSchema = {
  schema: Record<string, unknown>;
  /** Properties not in their object's `required`, across the schema. */
  optional: number;
  /** Schemas with `anyOf` or a list of types. */
  unions: number;
};

/**
 * `schema` as strict tool use accepts it, or null when it should not be:
 * an object that allows extra keys or names no properties, a `$ref` outside
 * the schema, a list that must hold two or more items, a `oneOf` that is not
 * a choice of required fields, or more optional or union parameters than one
 * request may hold.
 */
export function strictToolSchema(schema: unknown): StrictSchema | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  let optional = 0;
  let unions = 0;
  let expressible = true;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const bounds: string[] = [];
    const described = typeof source.description === "string" ? source.description : "";
    for (const [key, value] of Object.entries(source)) {
      // A required count of two or more ("one verdict per listed item") is
      // what the answer is checked against; strict would drop it, and a live
      // A/B on the Summary Self-check left more items unchecked and took
      // twice as long. Such a schema is sent as before.
      if (key === "minItems" && typeof value === "number" && value > 1) expressible = false;
      if (key in BOUND_WORDING) {
        const wording = statesBound(described, value) ? null : BOUND_WORDING[key]!(value);
        if (wording) bounds.push(wording);
        if (key === "minItems" && typeof value === "number" && value <= 1) out[key] = value;
        continue;
      }
      // A choice of one required field among several is said in words; the
      // runtime check still holds the answer to it (review round 3).
      if (key === "oneOf") {
        const names = requiredChoices(value);
        if (names) bounds.push(`exactly one of ${names.join(", ")}`);
        else expressible = false;
        continue;
      }
      if (DROPPED.has(key)) continue;
      if (key === "format" && !STRICT_FORMATS.has(String(value))) continue;
      if (key === "$ref" && typeof value === "string" && !value.startsWith("#/")) expressible = false;
      if (NAMED_SCHEMAS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
        out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, walk(child)]));
        continue;
      }
      if (key === "additionalProperties") {
        if (value !== false) expressible = false;
        continue;
      }
      out[key] = DATA.has(key) ? value : walk(value);
    }
    if (Array.isArray(source.anyOf) || Array.isArray(source.type)) unions += 1;
    if (source.type === "object" || (source.properties && typeof source.properties === "object")) {
      // Closed with no properties, the only answer strict would allow is {}.
      if (!source.properties || typeof source.properties !== "object" || Object.keys(source.properties).length === 0) {
        expressible = false;
      }
      out.additionalProperties = false;
      const required = new Set(Array.isArray(source.required) ? source.required : []);
      optional += Object.keys((source.properties as Record<string, unknown> | undefined) ?? {}).filter(
        (name) => !required.has(name)
      ).length;
    }
    if (bounds.length > 0) {
      const said = typeof out.description === "string" && out.description.trim() ? `${out.description.trim()} ` : "";
      out.description = `${said}(${bounds.join(", ")}.)`;
    }
    return out;
  };
  const result = walk(schema) as Record<string, unknown>;
  if (!expressible || optional > STRICT_LIMITS.optional || unions > STRICT_LIMITS.unions) return null;
  return { schema: result, optional, unions };
}

type ToolDefinition = { name?: unknown; input_schema?: unknown; [key: string]: unknown };

/**
 * `tools` for a request that would have forced `forcedName`: every tool
 * with a schema strict, when all fit one request's limits (so a request
 * that sends the same tools whichever it forces, as Seed batches do, keeps
 * one cached tools prefix), else only the forced one, else none. Tools
 * without an `input_schema` (server tools) are never touched.
 */
export function strictTools(tools: readonly unknown[], forcedName: string): unknown[] {
  const custom = tools.map((tool) =>
    tool && typeof tool === "object" && "input_schema" in tool ? (tool as ToolDefinition) : null
  );
  const converted = custom.map((tool) => (tool ? strictToolSchema(tool.input_schema) : null));
  const withStrict = (index: number) => ({ ...custom[index]!, strict: true, input_schema: converted[index]!.schema });
  const indexes = custom.flatMap((tool, index) => (tool ? [index] : []));
  const all = indexes.every((index) => converted[index] !== null);
  const total = (key: "optional" | "unions") => indexes.reduce((sum, index) => sum + (converted[index]?.[key] ?? 0), 0);
  if (all && indexes.length <= STRICT_LIMITS.tools && total("optional") <= STRICT_LIMITS.optional && total("unions") <= STRICT_LIMITS.unions) {
    return tools.map((tool, index) => (custom[index] ? withStrict(index) : tool));
  }
  const forced = custom.findIndex((tool) => tool?.name === forcedName);
  if (forced === -1 || !converted[forced]) return [...tools];
  return tools.map((tool, index) => (index === forced ? withStrict(index) : tool));
}

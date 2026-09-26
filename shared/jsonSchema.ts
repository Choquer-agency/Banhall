/**
 * Validates a value against the JSON Schema subset the app's tool schemas
 * use (type, properties, required, additionalProperties, items, minItems,
 * maxItems, uniqueItems, enum, minimum, maximum, minLength, maxLength).
 * The model catalog uses it to check a provider's ORIGINAL tool output
 * against the exact schema the request declared, before any contract
 * validation repairs, defaults or drops anything. Unknown keywords are
 * ignored, so a schema using more than this subset is checked leniently on
 * those keywords only.
 */

export type JsonSchema = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return true;
  }
}

/** Every violation, as "path: problem". Empty means valid. */
export function jsonSchemaErrors(value: unknown, schema: JsonSchema, path = "$"): string[] {
  const errors: string[] = [];
  const types =
    typeof schema.type === "string"
      ? [schema.type]
      : Array.isArray(schema.type)
        ? schema.type.filter((type): type is string => typeof type === "string")
        : [];
  if (types.length > 0 && !types.some((type) => typeMatches(value, type))) {
    return [`${path}: expected ${types.join(" or ")}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => option === value)) {
    errors.push(`${path}: not one of the allowed values`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path}: below ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path}: above ${schema.maximum}`);
    }
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: shorter than ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path}: longer than ${schema.maxLength}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: fewer than ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path}: more than ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) errors.push(`${path}: items are not unique`);
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) => {
        errors.push(...jsonSchemaErrors(item, schema.items as JsonSchema, `${path}[${index}]`));
      });
    }
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !(key in value)) errors.push(`${path}.${key}: required`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (isRecord(childSchema)) {
        errors.push(...jsonSchemaErrors(child, childSchema, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: not allowed`);
      }
    }
  }
  return errors;
}

export function matchesJsonSchema(value: unknown, schema: JsonSchema): boolean {
  return jsonSchemaErrors(value, schema).length === 0;
}

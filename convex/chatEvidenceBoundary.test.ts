import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Structural fence for CAP-4, complementing the runtime one in
 * `chatTurns.test.ts`. That test drives the real action and asserts on the
 * payload, which is where the boundary actually lives; this file covers only
 * the two things a runtime assertion cannot express: that the system string
 * has exactly one source, and that the evidence builder stays in the default
 * Convex runtime (a `"use node"` directive would break the query import chain
 * at deploy time, not in a test).
 *
 * `node:fs` is fine here because Convex never bundles a file whose basename
 * carries more than one dot, `*.test.ts` included.
 */
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("chat evidence boundary", () => {
  it("builds the system string in one place and concatenates nothing onto it", () => {
    const source = read("./ai/chatAgentV2.ts");
    expect(source).toContain("buildChatTurnRequest({");
    expect(source).toContain("system: turn.system,");
    expect(source).toContain("messages: turn.messages,");
    // A template literal at the `system:` key is the exact shape this story
    // removed: policy with evidence appended to it.
    expect(source).not.toMatch(/system: `/);
    expect(source).not.toContain("buildChatSystemPromptV2(styleOverrides)");
  });

  it("keeps the evidence builder in the default Convex runtime", () => {
    const evidence = read("./ai/chatEvidence.ts");
    expect(evidence).not.toMatch(/^\s*["']use node["']/m);
    expect(evidence).not.toMatch(/from "node:/);
  });
});

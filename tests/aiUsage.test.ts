import { describe, expect, test } from "vitest";
import { estimateCostUsd } from "../convex/aiUsage";
import { voyageTokenCount } from "../convex/ai/providers";
import { MODEL } from "../convex/ai/model";
import { sha256 } from "../convex/lib/contracts";
import {
  PROMPT_PROGRAM_CONTRACT_ID,
  canonicalSerialize,
  currentPromptVersion,
  generationPromptProgram,
  hashPromptProgram,
} from "../convex/ai/promptProgram";

describe("AI usage pricing", () => {
  test("prices Claude base, five-minute cache creation, and cache reads separately", () => {
    expect(
      estimateCostUsd(
        "claude-sonnet-4-6",
        1_000_000,
        1_000_000,
        1_000_000,
        1_000_000
      )
    ).toBeCloseTo(22.05, 10);
  });

  test("prices Voyage corpus/query embeddings and reranking by processed tokens", () => {
    expect(estimateCostUsd("voyage-3-large", 1_000_000, 0)).toBeCloseTo(
      0.18,
      10
    );
    expect(estimateCostUsd("rerank-2.5", 1_000_000, 0)).toBeCloseTo(
      0.05,
      10
    );
  });

  test("reads exact Voyage billed usage and rejects malformed provider bodies", () => {
    expect(voyageTokenCount({ usage: { total_tokens: 12_345 } })).toBe(12_345);
    expect(voyageTokenCount({ usage: { total_tokens: -1 } })).toBeNull();
    expect(voyageTokenCount({ usage: {} })).toBeNull();
    expect(voyageTokenCount(null)).toBeNull();
  });
});

describe("generation prompt program", () => {
  test("analyzer routing discloses fixed compare and selected single, iterative and legacy models", async () => {
    expect(generationPromptProgram.calls.analyzer.model).toEqual({
      kind: "mode-dependent",
      compare: { kind: "fixed", modelId: MODEL },
      single: { kind: "candidate", fallbackModelId: MODEL },
      iterative: { kind: "candidate", fallbackModelId: MODEL },
      legacyCandidate: { kind: "candidate", fallbackModelId: MODEL },
    });
    const previousProgram = {
      ...generationPromptProgram,
      calls: {
        ...generationPromptProgram.calls,
        analyzer: {
          ...generationPromptProgram.calls.analyzer,
          model: { kind: "candidate", fallbackModelId: MODEL },
        },
      },
    };
    expect(await hashPromptProgram(generationPromptProgram)).not.toBe(
      await hashPromptProgram(previousProgram)
    );
  });

  test("canonical serialization ignores nested object insertion order", async () => {
    const left = {
      z: [{ beta: 2, alpha: 1 }],
      a: { falseValue: false, nil: null, empty: "" },
    };
    const right = {
      a: { empty: "", nil: null, falseValue: false },
      z: [{ alpha: 1, beta: 2 }],
    };

    expect(canonicalSerialize(left)).toBe(canonicalSerialize(right));
    expect(await hashPromptProgram(left)).toBe(await hashPromptProgram(right));
  });

  test("canonical serialization preserves semantic array order", async () => {
    const forward = { stages: ["analyzer", "sections", "qa"] };
    const reversed = { stages: ["qa", "sections", "analyzer"] };

    expect(canonicalSerialize(forward)).not.toBe(canonicalSerialize(reversed));
    expect(await hashPromptProgram(forward)).not.toBe(
      await hashPromptProgram(reversed)
    );
  });

  test("canonical serialization rejects undefined and non-JSON values", () => {
    expect(() => canonicalSerialize(undefined)).toThrow(/undefined/);
    expect(() => canonicalSerialize({ value: undefined })).toThrow(/undefined/);
    expect(() => canonicalSerialize([undefined])).toThrow(/undefined/);
    expect(() => canonicalSerialize(Array(1))).toThrow(/undefined/);
    expect(() => canonicalSerialize({ value: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalSerialize(new Date())).toThrow(/non-plain/);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalSerialize(cyclic)).toThrow(/cycle/);
  });

  test("hash uses contract id, newline, canonical JSON, UTF-8, and full lowercase SHA-256", async () => {
    const value = { unicode: "é", count: 0, enabled: false };
    const canonical = canonicalSerialize(value);
    const expected = await sha256(
      `${PROMPT_PROGRAM_CONTRACT_ID}\n${canonical}`
    );
    const actual = await hashPromptProgram(value);

    expect(actual).toBe(`sha256:${expected}`);
    expect(actual).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("prompt bytes are not trimmed or Unicode-normalized", async () => {
    await expect(hashPromptProgram({ text: " prompt " })).resolves.not.toBe(
      await hashPromptProgram({ text: "prompt" })
    );
    await expect(hashPromptProgram({ text: "line\nnext" })).resolves.not.toBe(
      await hashPromptProgram({ text: "line\r\nnext" })
    );
    await expect(hashPromptProgram({ text: "é" })).resolves.not.toBe(
      await hashPromptProgram({ text: "e\u0301" })
    );
  });

  test("runtime project and learning content is excluded", async () => {
    const runtimeOnly = [
      "RUNTIME_PROJECT_9d66c",
      "RUNTIME_TRANSCRIPT_d7301",
      "RUNTIME_REPORT_00e8b",
      "RUNTIME_BRAIN_EXEMPLAR_e3228",
      "RUNTIME_DIGEST_ID_d34f1",
      "RUNTIME_DIGEST_CONTENT_cc82e",
      "RUNTIME_WRITER_INSTRUCTION_94625",
      "RUNTIME_REGENERATION_GUIDANCE_c022d",
    ];
    const serialized = JSON.stringify(generationPromptProgram);
    for (const value of runtimeOnly) expect(serialized).not.toContain(value);

    // Runtime slots are represented by named sentinels, never by content: every
    // declared sentinel is a `{{runtime.*}}` token and no scaffold string
    // interpolates anything else.
    const sentinels: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
      } else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (key === "runtimeSentinels" && Array.isArray(item)) {
            for (const sentinel of item) {
              if (typeof sentinel === "string") sentinels.push(sentinel);
            }
          } else {
            walk(item);
          }
        }
      }
    };
    walk(generationPromptProgram);
    expect(sentinels.length).toBeGreaterThan(0);
    for (const sentinel of sentinels) {
      expect(sentinel).toMatch(/^\{\{runtime\.[A-Za-z0-9_.]+\}\}$/);
    }
    expect(serialized.match(/\$\{/g)).toBeNull();

    // The memoized deployment hash is the same promise for every caller.
    const before = currentPromptVersion();
    const after = currentPromptVersion();
    expect(after).toBe(before);
    await expect(after).resolves.toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("every provider-facing definition category is hash-sensitive", async () => {
    type MutableJson =
      | null
      | boolean
      | number
      | string
      | MutableJson[]
      | { [key: string]: MutableJson };
    const mutateAt = (
      root: MutableJson,
      path: readonly (string | number)[],
      transform: (value: MutableJson) => MutableJson
    ) => {
      let parent = root;
      for (const segment of path.slice(0, -1)) {
        if (!parent || typeof parent !== "object") {
          throw new Error(`Invalid manifest path: ${path.join(".")}`);
        }
        parent = Array.isArray(parent)
          ? parent[Number(segment)]
          : parent[String(segment)];
      }
      const last = path.at(-1);
      if (last === undefined || !parent || typeof parent !== "object") {
        throw new Error(`Invalid manifest path: ${path.join(".")}`);
      }
      if (Array.isArray(parent)) {
        const index = Number(last);
        parent[index] = transform(parent[index]);
      } else {
        const key = String(last);
        parent[key] = transform(parent[key]);
      }
    };
    const changedString = (value: MutableJson) => `${String(value)} changed`;
    const increment = (value: MutableJson) => Number(value) + 1;
    const mutateCases: Array<
      [string, readonly (string | number)[], (value: MutableJson) => MutableJson]
    > = [
      ["system template", ["calls", "analyzer", "systemTemplate"], changedString],
      ["user scaffold", ["calls", "section242", "request", "userPrefix"], changedString],
      ["instruction branch", ["templates", "writing", "sharedRuleAssembly", "wrapper", "prefix"], changedString],
      ["tool schema", ["calls", "qa", "schema", "type"], changedString],
      ["tool choice", ["configuration", "structuredOutput", "request", "toolChoice", "type"], changedString],
      ["token cap", ["calls", "chronology", "request", "maxTokens"], increment],
      ["thinking setting", ["calls", "section244", "request", "thinking", "type"], changedString],
      ["analyzer compare routing", ["calls", "analyzer", "model", "compare", "modelId"], changedString],
      ["analyzer single routing", ["calls", "analyzer", "model", "single", "fallbackModelId"], changedString],
      ["analyzer iterative routing", ["calls", "analyzer", "model", "iterative", "fallbackModelId"], changedString],
      ["analyzer legacy routing", ["calls", "analyzer", "model", "legacyCandidate", "fallbackModelId"], changedString],
      ["model routing", ["configuration", "models", "modeRouting", "single", "fallbackModelId"], changedString],
      ["length setting", ["configuration", "length", "charsPerLine"], increment],
      ["Brain threshold", ["configuration", "brain", "search", "rawSearchFloor"], increment],
      ["compression squeeze", ["calls", "compression", "request", "squeezes", 1], increment],
      ["OpenRouter conversion", ["configuration", "openRouterConversion", "systemPosition"], changedString],
      ["topology edge", ["topology", "candidatePipeline", 0], changedString],
    ];
    const baseline = await hashPromptProgram(generationPromptProgram);

    for (const [label, path, transform] of mutateCases) {
      const changed = JSON.parse(
        JSON.stringify(generationPromptProgram)
      ) as MutableJson;
      mutateAt(changed, path, transform);
      expect(await hashPromptProgram(changed), label).not.toBe(baseline);
    }
  });

  test("manifest is complete, JSON-compatible, and names runtime slots", () => {
    expect(Object.keys(generationPromptProgram.calls).sort()).toEqual([
      "analyzer",
      "chronology",
      "compression",
      // transcripts-7-condense-digests: over-budget transcript sets are
      // condensed by their own structured call before drafting begins.
      "condense",
      "qa",
      "retrievalBrief",
      "section242",
      "section244",
      "section246",
    ]);
    expect(Object.keys(generationPromptProgram.topology.modes).sort()).toEqual([
      "compare",
      "iterative",
      "single",
    ]);
    const serialized = JSON.stringify(generationPromptProgram);
    expect(serialized).toContain("post-terminal-qa-and-chronology");
    expect(serialized).toContain("one-shot-ghost-candidate-pipeline");
    expect(serialized).toContain("redraft-with-writer-guidance");
    expect(serialized).toContain("conditionalCompression");
    expect(serialized).toContain("one-repair-attempt");
    // Canonical serialization rejects undefined anywhere in the manifest.
    expect(() => canonicalSerialize(generationPromptProgram)).not.toThrow();

    const sentinels = serialized.match(/\{\{runtime\.[a-zA-Z]+\}\}/g) ?? [];
    expect(sentinels.length).toBeGreaterThan(0);
    for (const sentinel of sentinels) {
      expect(sentinel).toMatch(/^\{\{runtime\.[a-zA-Z]+\}\}$/);
    }
    expect(() => canonicalSerialize(generationPromptProgram)).not.toThrow();
  });

  test("currentPromptVersion memoizes the in-flight promise", async () => {
    const first = currentPromptVersion();
    const second = currentPromptVersion();
    expect(second).toBe(first);
    await expect(first).resolves.toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

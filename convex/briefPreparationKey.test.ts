/// <reference types="vite/client" />
/**
 * The Brief preparation key (decision 65): the same frozen evidence and
 * policy give the same key, and changing any one dependency gives another.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { briefPreparationKey, type BriefKeyInput, type BriefKeySource } from "./lib/briefPreparationKey";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { GENERATION_STEP_POLICY_VERSION } from "./lib/generationSteps";
import type { ModelFreeze } from "./lib/modelCatalogValidators";

const modules = import.meta.glob("./**/*.ts");

const TRANSCRIPT = "Interviewer: What failed?\n\nPriya: The seal cracked at minus 30 during the cold soak test.";

function freeze(planning = "claude-sonnet-5", version: number | null = GENERATION_STEP_POLICY_VERSION): ModelFreeze {
  return {
    entries: [
      { id: "claude-sonnet-5", label: "Sonnet 5", provider: "anthropic", gateway: "anthropic", reasoning: false },
      { id: "claude-opus-5-5", label: "Opus 5.5", provider: "anthropic", gateway: "anthropic", reasoning: true },
    ],
    roles: {
      writing: "claude-sonnet-5",
      condense: "claude-sonnet-5",
      retrieval_brief: "claude-sonnet-5",
      analysis: "claude-sonnet-5",
      planning,
      checking: "claude-sonnet-5",
    },
    frozenAt: 1,
    ...(version !== null ? { stepPolicyVersion: version } : {}),
  };
}

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "key-user", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Key",
      clientName: "Acme",
      status: "draft",
      createdBy: userId,
      shareToken: "key-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: TRANSCRIPT,
      contentHash: "hash-t",
      label: "Interview",
      parserVersion: TRANSCRIPT_PARSER_VERSION,
      createdAt: now,
    });
    const speakerId = await ctx.db.insert("transcriptSpeakers", {
      transcriptId,
      projectId,
      label: "Priya",
      role: "client",
      roleSource: "heuristic",
      confidence: 0.95,
      turnCount: 1,
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "notes.txt",
      fileType: "txt",
      content: "Cold soak notes.",
      source: "upload",
      uploadedBy: "Writer",
      createdAt: now,
    });
    return { projectId, transcriptId, speakerId, documentId };
  });
  const sources: BriefKeySource[] = [
    {
      kind: "transcript",
      transcriptId: ids.transcriptId,
      label: "Interview",
      content: TRANSCRIPT,
      contentHash: "hash-t",
      truncated: false,
      originalLength: TRANSCRIPT.length,
    },
    {
      kind: "project_document",
      projectDocumentId: ids.documentId,
      label: "other:notes.txt",
      content: "Cold soak notes.",
      contentHash: "hash-d",
      truncated: false,
      originalLength: 16,
      uploaderRole: "writer",
    },
  ];
  const input: BriefKeyInput = {
    projectId: ids.projectId,
    sources,
    placeholders: [{ token: "[PERSON_1]", value: "Priya" }],
    inputMode: "full",
    transcriptFacts: false,
    freeze: freeze(),
    writerModel: "claude-sonnet-5",
  };
  const key = (value: BriefKeyInput) => t.run(async (ctx) => await briefPreparationKey(ctx, value));
  return { t, ids, input, key };
}

describe("briefPreparationKey", () => {
  test("is stable for the same evidence and policy, and versioned", async () => {
    const { input, key } = await fixture();
    const first = await key(input);
    expect(first).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(await key({ ...input, sources: input.sources.map((source) => ({ ...source })) })).toBe(first);
  });

  test("the writer's model is not a Brief dependency", async () => {
    const { input, key } = await fixture();
    expect(await key({ ...input, writerModel: "claude-opus-5-5" })).toBe(await key(input));
  });

  test("changing any one dependency misses", async () => {
    const { t, ids, input, key } = await fixture();
    const base = await key(input);
    const [transcript, document] = input.sources;
    const variants: Array<[string, BriefKeyInput]> = [
      ["source bytes", { ...input, sources: [{ ...transcript, contentHash: "other", content: `${TRANSCRIPT} More.` }, document] }],
      ["label", { ...input, sources: [{ ...transcript, label: "Second interview" }, document] }],
      ["order", { ...input, sources: [document, transcript] }],
      ["truncation", { ...input, sources: [{ ...transcript, truncated: true }, document] }],
      ["original length", { ...input, sources: [{ ...transcript, originalLength: 999 }, document] }],
      ["trust", { ...input, sources: [transcript, { ...document, uploaderRole: "admin" }] }],
      ["left-out document", { ...input, sources: [transcript] }],
      [
        "writer Storyline",
        {
          ...input,
          sources: [
            ...input.sources,
            { kind: "writer_storyline", label: "Writer-supplied Storyline", content: "Mine.", contentHash: "s", truncated: false, originalLength: 5 },
          ],
        },
      ],
      [
        "digest row",
        {
          ...input,
          sources: [
            ...input.sources,
            { kind: "transcript_digest", transcriptId: ids.transcriptId, label: "Interview", content: "Digest.", contentHash: "g", truncated: false, originalLength: 7 },
          ],
        },
      ],
      ["placeholders", { ...input, placeholders: [{ token: "[PERSON_1]", value: "Priya Raman" }] }],
      ["no placeholders", { ...input, placeholders: [] }],
      ["input mode", { ...input, inputMode: "digest" }],
      ["facts", { ...input, transcriptFacts: true }],
      ["planning model", { ...input, freeze: freeze("claude-opus-5-5") }],
      ["step policy", { ...input, freeze: freeze("claude-sonnet-5", null) }],
      ["project scope", { ...input, projectId: "k57bogusproject" as Id<"projects"> }],
    ];
    const keys = new Set<string>([base]);
    for (const [name, variant] of variants) {
      const next = await key(variant);
      expect(next, name).not.toBe(base);
      keys.add(next);
    }
    expect(keys.size).toBe(variants.length + 1);

    // Speaker evidence: a role correction, a guess falling below the
    // threshold and a rebuild in progress all miss.
    await t.run(async (ctx) => ctx.db.patch(ids.speakerId, { role: "interviewer", roleSource: "consultant", confidence: 1 }));
    const corrected = await key(input);
    expect(corrected).not.toBe(base);
    await t.run(async (ctx) => ctx.db.patch(ids.speakerId, { role: "client", roleSource: "heuristic", confidence: 0.2 }));
    const weak = await key(input);
    expect(weak).not.toBe(base);
    expect(weak).not.toBe(corrected);
    await t.run(async (ctx) => ctx.db.patch(ids.speakerId, { role: "client", roleSource: "heuristic", confidence: 0.95 }));
    expect(await key(input)).toBe(base);
    await t.run(async (ctx) => ctx.db.patch(ids.transcriptId, { structureBuildId: "rebuild-1" }));
    expect(await key(input)).not.toBe(base);
    await t.run(async (ctx) => ctx.db.patch(ids.transcriptId, { structureBuildId: undefined, parserVersion: "6" }));
    expect(await key(input)).not.toBe(base);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { retrieveBrainBlocks } from "./brainRetrieval";
import { buildPlaceholderMap } from "../lib/deidentify";

/**
 * Review 2026-09-26: a generation's Brain queries leave for the embedding
 * service, which no placeholder client guards. Every query is masked with
 * the generation's map and its tokens dropped, the fallback query (title
 * and a transcript slice) too. Names are fictional.
 */
describe("generation Brain queries", () => {
  it("starts all section searches together and folds results in section order", async () => {
    const pending = new Map<string, (value: { exemplars: { text: string; entryId: string; score: number; searchScore: number }[]; degraded: boolean }) => void>();
    const logged: string[] = [];
    const calls: string[] = [];
    let provenance: { section?: string; entryId: string }[] = [];
    const ctx = {
      runAction: async (_ref: unknown, args: { usageLabel: string }) => {
        calls.push(args.usageLabel);
        return await new Promise((resolve) => pending.set(args.usageLabel, resolve));
      },
    } as unknown as ActionCtx;
    const failing = { messages: { create: async () => { throw new Error("brief unavailable"); } } };
    const result = retrieveBrainBlocks(ctx, {
      generationId: "g1" as Id<"generations">,
      projectId: "p1" as Id<"projects">,
      title: "Controller",
      transcript: "Control loop",
      retrievalBriefClient: failing as never,
      log: async (line) => { logged.push(line); },
      recordProvenance: async (entries) => { provenance = entries; },
    });
    await vi.waitFor(() => expect([...pending.keys()]).toEqual(["analyzer", "242", "244", "246"]));
    for (const section of ["246", "244", "242", "analyzer"]) {
      pending.get(section)?.({
        exemplars: [{ text: section, entryId: section, score: 1, searchScore: 1 }],
        degraded: section === "244",
      });
    }
    // The degraded search is retried once on its own before its result is used.
    await vi.waitFor(() => expect(calls).toEqual(["analyzer", "242", "244", "246", "244"]));
    pending.get("244")?.({
      exemplars: [{ text: "244", entryId: "244", score: 1, searchScore: 1 }],
      degraded: false,
    });
    const blocks = await result;
    expect(blocks.analyzer).toContain("analyzer");
    expect(blocks.s242).toContain("242");
    expect(blocks.s244).toContain("244");
    expect(blocks.s246).toContain("246");
    expect(provenance.map((entry) => entry.section)).toEqual(["analyzer", "242", "244", "246"]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("Pulled 4 reference pattern(s)");
  });
  it("drop every name from the fallback query when the retrieval brief fails", async () => {
    const queries: string[] = [];
    const ctx = {
      runAction: async (_ref: unknown, args: { query: string }) => {
        queries.push(args.query);
        return { exemplars: [], degraded: false };
      },
      runMutation: async () => null,
    } as unknown as ActionCtx;
    const failing = {
      messages: {
        create: async () => {
          throw new Error("brief model unavailable");
        },
      },
    };
    await retrieveBrainBlocks(ctx, {
      generationId: "g1" as Id<"generations">,
      projectId: "p1" as Id<"projects">,
      title: "Verdant Grid feeder controller",
      transcript: "Dana Whitfield: What did Marcus build for Verdant Grid?\n\nMarcus Lindqvist: A controller.",
      retrievalBriefClient: failing as never,
      placeholders: buildPlaceholderMap({
        clientName: "Verdant Grid",
        people: ["Dana Whitfield", "Marcus Lindqvist"],
      }),
      log: async () => null,
    });
    expect(queries.length).toBeGreaterThanOrEqual(3);
    for (const query of queries) {
      for (const name of ["Verdant", "Dana", "Whitfield", "Marcus", "Lindqvist", "[PERSON", "[CLIENT"]) {
        expect(query, name).not.toContain(name);
      }
      expect(query).toContain("feeder controller");
    }
  });
});

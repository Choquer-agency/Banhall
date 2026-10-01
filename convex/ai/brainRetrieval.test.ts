import { describe, expect, it } from "vitest";
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

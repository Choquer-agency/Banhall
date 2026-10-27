/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";

const modules = import.meta.glob("./**/*.ts");

/**
 * B1, second part (2026-10-27): every switched reader returns the same thing
 * for a draft whose rows refer to their text as for one whose rows hold
 * their own copies. Two projects with the same files: one old-style draft,
 * one new-style draft. Every name and passage here is fictional.
 */

const TRANSCRIPT = "Priya Raman: We tuned the seal at 64 C.\nInterviewer: And then?\nPriya Raman: It held for six hours.";
const NOTES = "# Writer settings\n\nKeep Line 242 under 300 words. Prefer we to the team.";
const REPORT = "Last year the team tested three seal designs.";

async function draft(t: ReturnType<typeof convexTest>, userId: Id<"users">, style: "old" | "new") {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      title: "Seals", clientName: "Quillmere", status: "draft", createdBy: userId, ownerId: userId,
      shareToken: `share-${style}`, createdAt: 1, updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId, content: TRANSCRIPT, contentHash: await sha256(TRANSCRIPT), label: "Interview", createdAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId, status: "running", startedAt: 1, requestedBy: userId, transcriptIds: [transcriptId], transcriptId,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const base = { generationId, projectId, truncated: false, capturedAt: 1 } as const;
    const stored = async (text: string) => {
      const versionId = await ctx.db.insert("sourceTextVersions", {
        projectId, textHash: await sha256(text), textLength: text.length, textBytes: new TextEncoder().encode(text).byteLength, createdAt: 1,
      });
      await ctx.db.insert("sourceTextVersionPieces", { versionId, projectId, start: 0, text });
      return versionId;
    };
    const fileRow = async (label: string, text: string) =>
      await ctx.db.insert("generationSources", {
        ...base, kind: "project_document", label, uploaderRole: "writer", contentHash: await sha256(text), originalLength: text.length,
        ...(style === "old" ? { content: text } : { textVersionId: await stored(text), textLength: text.length }),
      });
    await ctx.db.insert("generationSources", {
      ...base, kind: "transcript", transcriptId, label: "Interview", contentHash: await sha256(TRANSCRIPT), originalLength: TRANSCRIPT.length,
      ...(style === "old" ? { content: TRANSCRIPT } : { textLength: TRANSCRIPT.length }),
    });
    await fileRow("writer_notes:pd-writing-customized-settings.md", NOTES);
    await fileRow("previous_report:last-year.txt", REPORT);
    return { projectId, generationId };
  });
}

/** A reader's result with the ids that differ between the two drafts taken out. */
function comparable(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, field) =>
      ["_id", "_creationTime", "sourceId", "generationId", "projectId", "transcriptId", "transcriptIds", "generationSourceId", "versionId"].includes(key)
        ? undefined
        : field
    )
  );
}

describe("switched readers on old-style and new-style rows (B1, second part)", () => {
  it("return the same drafting input, Brief rows, condensing input and settings document", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { authId: "readers", role: "writer" }));
    const old = await draft(t, userId, "old");
    const next = await draft(t, userId, "new");
    const readers = [
      (generationId: Id<"generations">) => t.query(internal.generations.getGenerationInput, { generationId }),
      (generationId: Id<"generations">) => t.query(internal.generations.getGenerationSourcesForBrief, { generationId }),
      (generationId: Id<"generations">) => t.query(internal.transcriptDigests.getCondenseInputs, { generationId }),
      (generationId: Id<"generations">) =>
        t.query(internal.writerProfiles.getSettingsDocumentCandidate, { generationId, userId, classifierVersion: "v1" }),
    ];
    for (const read of readers) {
      const [fromOld, fromNew] = [await read(old.generationId), await read(next.generationId)];
      expect(fromOld).not.toBeNull();
      expect(comparable(fromNew)).toEqual(comparable(fromOld));
    }
    // The settings document was found in both, from its text.
    const candidate = await t.query(internal.writerProfiles.getSettingsDocumentCandidate, {
      generationId: next.generationId, userId, classifierVersion: "v1",
    });
    expect(candidate.document?.text).toContain("Keep Line 242 under 300 words.");
  });
});

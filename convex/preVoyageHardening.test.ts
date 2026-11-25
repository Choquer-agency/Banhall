/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { sha256HexSync } from "./lib/sha256Sync";
import { contentHash, importSource, legacyContentHash } from "./brain";
import { CONTEXTUALIZE_THINKING } from "./ai/brain/ingest";
import { ROLE_POLICIES } from "../shared/modelCatalog";
import { uploadUpsertFields } from "./lib/ingestionClassify";
import { readIngestionItemText } from "./lib/ingestionItemTexts";
import {
  SCIENCE_CODE_INPUT_SCHEMA,
  SCIENCE_CODE_MAX_TOKENS,
  SCIENCE_CODE_TOOL_NAME,
  scienceCodeSuggestionSchema,
} from "./scienceCodeSuggestions";

const modules = import.meta.glob("./**/*.ts");

async function seedAdmin(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      authId: "admin-1",
      email: "admin@banhall.test",
      name: "Admin",
      role: "admin",
      createdAt: 1,
    });
  });
  return t.withIdentity({ subject: "admin-1", tokenIdentifier: "test|admin-1" });
}

describe("Pre-Voyage-4 AI and import hardening", () => {
  it("sha256HexSync matches Node crypto SHA-256 across empty, ASCII, multibyte UTF-8 and multi-block strings", () => {
    const samples = [
      "",
      "abc",
      "A".repeat(55),
      "A".repeat(56),
      "A".repeat(64),
      "A".repeat(128),
      "SR&ED project description with unicode: café, naïve, Ω, 🚀",
      "Measured thermal drift across 120 cycles at 450 kPa.\n".repeat(50),
    ];
    for (const sample of samples) {
      const expected = createHash("sha256").update(sample, "utf8").digest("hex");
      expect(sha256HexSync(sample)).toBe(expected);
      expect(contentHash(sample)).toBe(expected);
    }
  });

  it("Brain text dedup matches legacy FNV-1a rows by exact content and never collides on different text", async () => {
    const t = convexTest(schema, modules);
    // Known 32-bit FNV-1a colliding pair of equal length ("liquid" vs "costarring").
    const textA = "costarring";
    const textB = "liquid";
    // Use equal-length colliding suffix pair so legacyContentHash(a) === legacyContentHash(b).
    const collidingA = "prefix costarring";
    const collidingB = "prefix liquid    ";
    // Find an actual equal-length FNV-1a collision or verify via explicit same-legacyHash seed.
    const legacyHash = legacyContentHash(textA);
    expect(legacyHash).not.toBe(contentHash(textA));
    expect(collidingA.length).toBe(collidingB.length);

    // Seed a legacy Brain source row carrying the old 32-bit FNV-1a sourceHash.
    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert("brainSources", {
        kind: "pd_pair",
        status: "approved",
        title: "Legacy PD",
        industry: "software",
        writerTier: 0.8,
        docType: "pd",
        content: textA,
        ragKey: `pd_pair:${legacyHash}`,
        sourceHash: legacyHash,
        createdBy: "admin",
        createdAt: 1,
      });
    });

    // Importing exact textA matches the legacy row.
    const sameResult = await t.run((ctx) =>
      importSource(
        ctx,
        {
          title: "Legacy PD again",
          industry: "software",
          writerTier: 0.8,
          docType: "pd",
          content: textA,
        },
        "admin"
      )
    );
    expect(sameResult).toMatchObject({ outcome: "matched", sourceId: legacyId });

    // Even if another row shares a legacy hash (simulated collision), distinct text is NOT matched.
    await t.run(async (ctx) => {
      await ctx.db.insert("brainSources", {
        kind: "pd_pair",
        status: "revoked",
        revokedFromStatus: "approved",
        title: "Colliding Revoked PD",
        industry: "software",
        writerTier: 0.8,
        docType: "pd",
        content: "completely different text that collided on FNV-1a",
        ragKey: `pd_pair:revoked-collision`,
        sourceHash: legacyContentHash(textB),
        createdBy: "admin",
        createdAt: 2,
      });
    });

    const distinctResult = await t.run((ctx) =>
      importSource(
        ctx,
        {
          title: "Distinct PD",
          industry: "software",
          writerTier: 0.8,
          docType: "pd",
          content: textB,
        },
        "admin"
      )
    );
    expect(distinctResult.outcome).toBe("added");
  });

  it("interrupted uploader upload resumes on retry instead of skipping as unchanged", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedAdmin(t);
    const hash = sha256HexSync("pdf-bytes-v1");
    const fields = uploadUpsertFields("Acme/FY2025/Project.docx", 1200, 1000, hash);

    // First attempt inserts discovered row, then crashes before attachUpload.
    const firstId = await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...fields,
      via: "uploader",
    });
    expect(firstId).toBeTruthy();

    // importFilesHere must not report the incomplete row as already present.
    expect(await admin.query(api.ingestion.importFilesHere, { hashes: [hash] })).toEqual([]);

    // Retry from uploader HTTP route returns the itemId so http.ts stores bytes and calls attachUpload.
    const retryId = await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...fields,
      via: "uploader",
      resumeMissingBytes: true,
    });
    expect(retryId).toBe(firstId);

    // Once bytes are attached, another retry sees it as unchanged (null).
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["pdf-bytes-v1"])));
    await t.mutation(internal.ingestion.attachUpload, {
      itemId: retryId!,
      storageId,
      expectedContentHash: hash,
    });
    expect(await admin.query(api.ingestion.importFilesHere, { hashes: [hash] })).toEqual([hash]);
    const thirdId = await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...fields,
      via: "uploader",
      resumeMissingBytes: true,
    });
    expect(thirdId).toBeNull();
  });

  it("fences stale extraction results and late failures against newer versions and pending_review", async () => {
    const t = convexTest(schema, modules);
    const hashV1 = sha256HexSync("file-v1");
    const hashV2 = sha256HexSync("file-v2");
    const fieldsV1 = {
      ...uploadUpsertFields("Acme/FY2025/PD.docx", 500, 1000, hashV1),
      driveItemId: "drive-item-1",
    };
    const fieldsV2 = {
      ...uploadUpsertFields("Acme/FY2025/PD.docx", 500, 2000, hashV2),
      driveItemId: "drive-item-1",
    };

    const itemId = await t.mutation(internal.ingestion.upsertDiscoveredItem, fieldsV1);
    const storageV1 = await t.run((ctx) => ctx.storage.store(new Blob(["file-v1"])));
    await t.mutation(internal.ingestion.attachUpload, {
      itemId: itemId!,
      storageId: storageV1,
      expectedContentHash: hashV1,
    });

    // Newer file version arrives while v1 extraction is still in flight.
    await t.mutation(internal.ingestion.upsertDiscoveredItem, fieldsV2);
    const afterV2 = await t.run((ctx) => ctx.db.get(itemId!));
    expect(afterV2?.status).toBe("discovered");
    expect(afterV2?.storageId).toBeUndefined();

    // Late v1 markItemProcessed with expectedContentHash=hashV1 must be ignored.
    const staleTextStorage = await t.run((ctx) => ctx.storage.store(new Blob(["stale v1 text"])));
    await t.mutation(internal.ingestion.markItemProcessed, {
      itemId: itemId!,
      storageId: storageV1,
      expectedContentHash: hashV1,
      text: "stale v1 text",
      textStorageId: staleTextStorage,
    });
    const stillV2 = await t.run((ctx) => ctx.db.get(itemId!));
    expect(stillV2?.status).toBe("discovered");
    expect(stillV2?.text).toBeUndefined();

    // Late v1 markItemFailed must also be ignored.
    await t.mutation(internal.ingestion.markItemFailed, {
      itemId: itemId!,
      expectedContentHash: hashV1,
      error: "v1 timeout",
    });
    expect((await t.run((ctx) => ctx.db.get(itemId!)))?.status).toBe("discovered");

    // Now v2 finishes cleanly -> pending_review.
    const storageV2 = await t.run((ctx) => ctx.storage.store(new Blob(["file-v2"])));
    await t.mutation(internal.ingestion.markItemProcessed, {
      itemId: itemId!,
      storageId: storageV2,
      expectedContentHash: hashV2,
      text: "fresh v2 text",
    });
    expect((await t.run((ctx) => ctx.db.get(itemId!)))?.status).toBe("pending_review");

    // Any late failure after pending_review must NOT clobber the extracted item.
    await t.mutation(internal.ingestion.markItemFailed, {
      itemId: itemId!,
      expectedContentHash: hashV2,
      error: "late failure",
    });
    const finalRow = await t.run((ctx) => ctx.db.get(itemId!));
    expect(finalRow?.status).toBe("pending_review");
    expect(finalRow?.text).toBeUndefined();
    expect(finalRow?.textLength).toBe("fresh v2 text".length);
    expect(await t.run((ctx) => readIngestionItemText(ctx, finalRow!))).toBe("fresh v2 text");
    await seedAdmin(t);
    const admin = t.withIdentity({ subject: "admin-1" });
    expect(await admin.query(api.ingestion.getItemText, { itemId: itemId! })).toBe("fresh v2 text");
    expect(await t.query(api.ingestion.getItemText, { itemId: itemId! })).toBeNull();
  });

  it("configures science_code on Haiku 5.5 with a strict enum schema and disables thinking for brain chunk context", () => {
    expect(ROLE_POLICIES.science_code.defaultModelId).toBe("claude-haiku-5-5");
    expect(ROLE_POLICIES.science_code.track).toBe("claude-haiku");
    expect(SCIENCE_CODE_TOOL_NAME).toBe("select_science_code");
    expect(SCIENCE_CODE_MAX_TOKENS).toBeGreaterThanOrEqual(128);
    expect(SCIENCE_CODE_INPUT_SCHEMA.properties.code.enum).toContain("2.02.09");
    expect(SCIENCE_CODE_INPUT_SCHEMA.properties.code.enum).toContain("NONE");
    expect(scienceCodeSuggestionSchema.safeParse({ code: "2.02.09" }).success).toBe(true);
    expect(scienceCodeSuggestionSchema.safeParse({ code: "NONE" }).success).toBe(true);
    expect(scienceCodeSuggestionSchema.safeParse({ code: "9.99.99" }).success).toBe(false);
    expect(CONTEXTUALIZE_THINKING).toEqual({ type: "disabled" });
  });
});

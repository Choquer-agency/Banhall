import { expect, test } from "vitest";
import { briefInputsHash } from "./briefInputsHash";
import { sha256 } from "./contracts";

test("briefInputsHash: computes hash over frozen sources, excluding writer_storyline and transcript_digest", async () => {
  const sources = [
    {
      kind: "transcript" as const,
      contentHash: "hash1",
      label: "Transcript 1",
      content: "content1",
      projectId: "proj1" as any,
      generationId: "gen1" as any,
      truncated: false,
      originalLength: 100,
      capturedAt: 123,
    },
    {
      kind: "project_document" as const,
      contentHash: "hash2",
      label: "Document 1",
      content: "content2",
      projectId: "proj1" as any,
      generationId: "gen1" as any,
      truncated: false,
      originalLength: 200,
      capturedAt: 124,
    },
    // These should be excluded from the hash
    {
      kind: "writer_storyline" as const,
      contentHash: "hash3",
      label: "Writer Storyline",
      content: "writer storyline",
      projectId: "proj1" as any,
      generationId: "gen1" as any,
      truncated: false,
      originalLength: 50,
      capturedAt: 125,
    },
    {
      kind: "transcript_digest" as const,
      contentHash: "hash4",
      label: "Digest",
      content: "digest content",
      projectId: "proj1" as any,
      generationId: "gen1" as any,
      truncated: false,
      originalLength: 75,
      capturedAt: 126,
    },
  ];

  const hash = await briefInputsHash(sources);

  // Should be a valid hash string
  expect(hash).toBeDefined();
  expect(typeof hash).toBe("string");
  expect(hash.length).toBeGreaterThan(0);

  // Hashing the same relevant sources should produce the same hash
  const sameRelevantSources = sources.filter(
    (s) => s.kind !== "writer_storyline" && s.kind !== "transcript_digest"
  );
  const sameHash = await briefInputsHash(sameRelevantSources);
  expect(sameHash).toBe(hash);

  // Different relevant sources should produce different hash
  const differentSources = [
    {
      kind: "transcript" as const,
      contentHash: "hash1_different",
      label: "Transcript 1",
      content: "content1",
      projectId: "proj1" as any,
      generationId: "gen1" as any,
      truncated: false,
      originalLength: 100,
      capturedAt: 123,
    },
  ];
  const differentHash = await briefInputsHash(differentSources);
  expect(differentHash).not.toBe(hash);
});

test("briefInputsHash: deterministic ordering", async () => {
  const sources = [
    {
      kind: "transcript" as const,
      contentHash: "hash_a",
      label: "A",
      content: "a",
      projectId: "proj1" as any,
      generationId: "gen1" as any,
      truncated: false,
      originalLength: 10,
      capturedAt: 123,
    },
    {
      kind: "project_document" as const,
      contentHash: "hash_b",
      label: "B",
      content: "b",
      projectId: "proj1" as any,
      generationId: "gen1" as any,
      truncated: false,
      originalLength: 20,
      capturedAt: 124,
    },
  ];

  const hash1 = await briefInputsHash(sources);
  const hash2 = await briefInputsHash([...sources].reverse());

  // Same sources in different order should produce the same hash
  // (because we sort them deterministically)
  expect(hash1).toBe(hash2);
});

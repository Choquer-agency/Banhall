/**
 * Witnesses for per-attempt capture reservation (Verification, R6-13): inside
 * one capture owner, every `path()` call gets its own destination, including
 * repeated labels (test retries) and overlapping calls for the same label, so
 * no capture attempt overwrites an earlier one. The browser command is backed
 * here by the real Node reservation against a temporary root.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveCaptureDirectory } from "./captureReservation";

const reserve = vi.hoisted(() => ({ root: "" }));

vi.mock("vitest/browser", () => ({
  commands: {
    reserveCaptureDirectory: vi.fn(async (label: string) => reserveCaptureDirectory(reserve.root, label)),
  },
}));

const { captureOwner } = await import("./captureOwner");
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

beforeEach(() => {
  reserve.root = mkdtempSync(join(tmpdir(), "seed-capture-owner-"));
});

describe("capture owner per-attempt paths", () => {
  it("keeps the first capture's filename and gives every repeated label a fresh destination", async () => {
    const captures = captureOwner("seed-workspace");
    const first = await captures.path("seed-workspace-desktop-initial");
    expect(first.endsWith("/seed-workspace-desktop-initial.png")).toBe(true);
    writeFileSync(first, "first attempt\n");
    const firstHash = sha256(first);

    // A retried test asks for the same label again.
    const retry = await captures.path("seed-workspace-desktop-initial");
    const third = await captures.path("seed-workspace-desktop-initial");
    expect(new Set([first, retry, third]).size).toBe(3);
    writeFileSync(retry, "retry attempt\n");
    writeFileSync(third, "third attempt\n");
    expect(sha256(first)).toBe(firstHash);
    expect(readFileSync(retry, "utf8")).toBe("retry attempt\n");

    // A different label keeps its own plain name in the same owned directory.
    const other = await captures.path("seed-workspace-narrow-outline");
    expect(other.endsWith("/seed-workspace-narrow-outline.png")).toBe(true);
    expect(new Set([first, retry, third, other]).size).toBe(4);
  });

  it("gives overlapping same-label requests distinct destinations and leaves earlier capture bytes unchanged", async () => {
    const captures = captureOwner("summary-review");
    const paths = await Promise.all([
      captures.path("summary-review-narrow"),
      captures.path("summary-review-narrow"),
      captures.path("summary-review-narrow"),
    ]);
    expect(new Set(paths).size).toBe(3);
    // All attempts land in the one directory this owner reserved.
    const directories = new Set(paths.map((path) => path.slice(0, path.lastIndexOf("/"))));
    expect(directories.size).toBe(1);

    const hashes: string[] = [];
    for (const [index, path] of paths.entries()) {
      writeFileSync(path, `attempt ${index + 1}\n`);
      hashes.push(sha256(path));
      // Every earlier attempt keeps its exact bytes after each later write.
      for (let earlier = 0; earlier < index; earlier += 1) {
        expect(sha256(paths[earlier])).toBe(hashes[earlier]);
      }
    }
    const [directory] = directories;
    expect(readdirSync(directory).sort()).toHaveLength(3);
  });
});

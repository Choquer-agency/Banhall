/**
 * Witnesses for the stories 5–6 capture reservation (Verification, R5-09):
 * every invocation owns a distinct directory, a taken name is never reused,
 * and prior captures keep their bytes. Runs against a temporary root, never
 * the repository's capture folder.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPTURE_ROOT, captureStamp, reserveCaptureDirectory } from "./captureReservation";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const scratch = () => mkdtempSync(join(tmpdir(), "seed-capture-reservation-"));

describe("stories 5–6 capture reservation", () => {
  it("reserves a distinct fresh directory per invocation and leaves prior captures byte-identical", () => {
    const root = scratch();
    const first = reserveCaptureDirectory(root, "seed-workspace");
    expect(first.attempts).toBe(1);
    expect(first.directory).toBe(join(root, CAPTURE_ROOT, first.name));
    expect(first.name.startsWith(`seed-workspace-`)).toBe(true);
    expect(first.name).toContain(`-${process.pid}-`);
    expect(statSync(first.directory).isDirectory()).toBe(true);

    // A capture written by the first invocation.
    const capture = join(first.directory, "seed-workspace-desktop-initial.png");
    writeFileSync(capture, "prior capture bytes\n");
    const captureHash = sha256(capture);

    // Repeated invocations (same label, same process) never land in the same
    // directory, and the prior capture is untouched.
    const second = reserveCaptureDirectory(root, "seed-workspace");
    const third = reserveCaptureDirectory(root, "seed-workspace");
    expect(new Set([first.directory, second.directory, third.directory]).size).toBe(3);
    expect(readdirSync(second.directory)).toEqual([]);
    expect(readdirSync(third.directory)).toEqual([]);
    expect(sha256(capture)).toBe(captureHash);
    expect(readdirSync(first.directory)).toEqual(["seed-workspace-desktop-initial.png"]);
  });

  it("refuses a taken name and retries with a fresh one, so simultaneous starts cannot share a directory", () => {
    const root = scratch();
    // The same timestamp and suffix as a concurrent start would produce: the
    // second reservation finds the name taken (EEXIST) and moves on.
    const suffixes = ["aaaa", "aaaa", "bbbb"];
    const suffix = () => suffixes.shift() ?? "cccc";
    const stamp = () => "20260923T000000000Z";
    const first = reserveCaptureDirectory(root, "summary-review", { suffix, stamp });
    const sentinel = join(first.directory, "summary-review-desktop-initial.png");
    writeFileSync(sentinel, "first owner's capture\n");
    const sentinelHash = sha256(sentinel);

    const second = reserveCaptureDirectory(root, "summary-review", { suffix, stamp });
    expect(first.name).toBe(`summary-review-20260923T000000000Z-${process.pid}-aaaa`);
    expect(second.name).toBe(`summary-review-20260923T000000000Z-${process.pid}-bbbb`);
    expect(second.attempts).toBe(2);
    expect(second.directory).not.toBe(first.directory);
    expect(readdirSync(second.directory)).toEqual([]);
    expect(sha256(sentinel)).toBe(sentinelHash);
  });

  it("stops with an explicit refusal when every tried name is taken, without touching the existing directories", () => {
    const root = scratch();
    const stamp = () => "20260923T000000000Z";
    const first = reserveCaptureDirectory(root, "seed-workspace", { suffix: () => "same", stamp });
    const kept = join(first.directory, "kept.png");
    writeFileSync(kept, "kept\n");
    const keptHash = sha256(kept);
    expect(() => reserveCaptureDirectory(root, "seed-workspace", { suffix: () => "same", stamp, maxAttempts: 3 }))
      .toThrow(/could not reserve a fresh capture directory for seed-workspace after 3 taken names/);
    expect(sha256(kept)).toBe(keptHash);
    expect(readdirSync(join(root, CAPTURE_ROOT))).toEqual([first.name]);
  });

  it("records the reservation's provenance inside the directory it owns and rejects unsafe labels", () => {
    const root = scratch();
    const reserved = reserveCaptureDirectory(root, "seed-workspace", {
      provenance: { testPath: "src/lib/components/seeds/SeedWorkspace.component.test.ts" },
    });
    const provenance = JSON.parse(readFileSync(join(reserved.directory, "reservation.json"), "utf8"));
    expect(provenance).toMatchObject({
      directory: reserved.directory,
      pid: process.pid,
      attempts: 1,
      testPath: "src/lib/components/seeds/SeedWorkspace.component.test.ts",
    });
    for (const label of ["Seed Workspace", "../escape", "", "seed_workspace", "x".repeat(65)]) {
      expect(() => reserveCaptureDirectory(root, label)).toThrow(/capture label must be lowercase letters, digits or dashes/);
    }
    expect(existsSync(join(root, CAPTURE_ROOT, ".."))).toBe(true);
    expect(captureStamp(new Date(Date.UTC(2026, 8, 23, 4, 5, 6, 789)))).toBe("20260923T040506789Z");
  });
});

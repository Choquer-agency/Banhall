/**
 * Exclusive output reservation for the stories 5–6 component captures
 * (Verification, R5-09). Every invocation of a capture-bearing suite reserves
 * its own fresh directory before writing a screenshot, so repeated, colliding
 * or simultaneous runs never overwrite a prior capture: the non-recursive
 * `mkdir` is the lock (it either creates the directory or refuses with
 * `EEXIST`), a taken name is retried with a fresh suffix, and nothing is ever
 * written into a directory this process did not create.
 *
 * Node-only: `vitest.component.config.ts` exposes it to the browser suites as
 * the `reserveCaptureDirectory` browser command; the suites pass the returned
 * absolute directory to `screenshot({ path })`.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Capture root, relative to the repository (ignored by git like every `.vitest-attachments` path). */
export const CAPTURE_ROOT = ".vitest-attachments/stories5-6/captures";

export type CaptureReservation = {
  /** Absolute path of the directory this call created exclusively. */
  directory: string;
  /** The reserved directory's basename: `<label>-<stamp>-<pid>-<suffix>`. */
  name: string;
  /** How many names were tried before one was free (1 = no collision). */
  attempts: number;
};

export type ReserveCaptureOptions = {
  /** Name suffix source; the default is 4 random bytes. Injectable for collision tests. */
  suffix?: () => string;
  /** Timestamp source; the default is the current UTC time. Injectable for collision tests. */
  stamp?: () => string;
  /** Bound on the names tried before refusing (default 16). */
  maxAttempts?: number;
  /** Written into the reserved directory as `reservation.json` when given. */
  provenance?: Record<string, unknown>;
};

const LABEL = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function captureStamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.(\d+)Z$/, "$1Z");
}

export function reserveCaptureDirectory(
  root: string,
  label: string,
  options: ReserveCaptureOptions = {}
): CaptureReservation {
  if (!LABEL.test(label)) {
    throw new Error(`capture label must be lowercase letters, digits or dashes: ${JSON.stringify(label)}`);
  }
  const parent = resolve(root, CAPTURE_ROOT);
  mkdirSync(parent, { recursive: true });
  const suffix = options.suffix ?? (() => randomBytes(4).toString("hex"));
  const stamp = options.stamp ?? (() => captureStamp());
  const maxAttempts = options.maxAttempts ?? 16;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const name = `${label}-${stamp()}-${process.pid}-${suffix()}`;
    const directory = join(parent, name);
    try {
      // Non-recursive on purpose: a name that already exists is refused, never reused.
      mkdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    if (options.provenance) {
      writeFileSync(
        join(directory, "reservation.json"),
        JSON.stringify({ at: new Date().toISOString(), directory, pid: process.pid, attempts: attempt, ...options.provenance }, null, 2) + "\n"
      );
    }
    return { directory, name, attempts: attempt };
  }
  throw new Error(`could not reserve a fresh capture directory for ${label} after ${maxAttempts} taken names`);
}

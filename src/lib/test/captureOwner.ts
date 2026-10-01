/**
 * Browser side of the stories 5–6 capture reservation (Verification, R5-09).
 * A capture-bearing component suite reserves ONE fresh directory per
 * invocation through the `reserveCaptureDirectory` browser command (declared
 * in `vitest.component.config.ts`, implemented by `captureReservation.ts` in
 * Node) and writes every screenshot under it, so repeated or concurrent runs
 * never overwrite a prior capture. The directory is absolute, which vitest's
 * screenshot path resolution passes through unchanged.
 */
import { commands } from "vitest/browser";

export type CaptureReservation = { directory: string; name: string; attempts: number };

declare module "vitest/browser" {
  interface BrowserCommands {
    reserveCaptureDirectory: (label: string) => Promise<CaptureReservation>;
  }
}

export function captureOwner(label: string) {
  let reserved: Promise<CaptureReservation> | null = null;
  const reservation = () => (reserved ??= commands.reserveCaptureDirectory(label));
  // Every capture attempt owns its own file (R6-13): a repeated name (a test
  // retry) or an overlapping call for the same name never reuses a path this
  // owner already handed out. The filename is chosen synchronously, before
  // any await, so concurrent requests cannot pick the same one.
  const handedOut = new Set<string>();
  const attempts = new Map<string, number>();
  const fileFor = (name: string) => {
    let attempt = attempts.get(name) ?? 0;
    let file: string;
    do {
      attempt += 1;
      file = attempt === 1 ? `${name}.png` : `${name}.attempt-${attempt}.png`;
    } while (handedOut.has(file));
    attempts.set(name, attempt);
    handedOut.add(file);
    return file;
  };
  return {
    /** The reservation this invocation owns (made on first use). */
    reservation,
    /** Absolute screenshot path for one capture attempt of `name` inside the
     * owned directory: the first attempt is `name.png`, later ones are
     * `name.attempt-<n>.png`. */
    path: async (name: string) => {
      const file = fileFor(name);
      return `${(await reservation()).directory}/${file}`;
    },
  };
}

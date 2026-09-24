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
  return {
    /** The reservation this invocation owns (made on first use). */
    reservation,
    /** Absolute screenshot path for `name` inside the owned directory. */
    path: async (name: string) => `${(await reservation()).directory}/${name}.png`,
  };
}

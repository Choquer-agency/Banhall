import { getContext, setContext } from "svelte";

/**
 * The desktop rail's collapse and expand control, shared by the workspace
 * shell with whichever top bar the page renders (owner direction 2026-09-28:
 * the control sits at the left edge of the main content's top bar in both
 * states, never in the rail). The shell owns the state, so the top bar gets
 * the tablet overlay and the saved preference without each host wiring it.
 */
export type RailControl = {
  /** The rail currently shows icons only (desktop preference or tablet width). */
  readonly collapsed: boolean;
  toggle: () => void;
};

const RAIL_CONTROL_KEY = Symbol("workspace-rail-control");

export function setRailControl(control: RailControl): void {
  setContext(RAIL_CONTROL_KEY, control);
}

/** The enclosing shell's rail control, or undefined outside a workspace shell. */
export function getRailControl(): RailControl | undefined {
  return getContext<RailControl | undefined>(RAIL_CONTROL_KEY);
}

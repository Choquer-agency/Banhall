import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_CLICK_DELAY_MS, createCardClickGate } from "./cardClick";

// Greptile G5: a body click on a seed card changes the pick only as a
// single click, after the double-click window.
describe("seed card click gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acts on a single click once the double-click window has passed", () => {
    const act = vi.fn();
    const gate = createCardClickGate(act);
    gate.pointerDown(10, 10);
    gate.click(1);
    expect(act).not.toHaveBeenCalled();
    expect(gate.pending).toBe(true);
    vi.advanceTimersByTime(CARD_CLICK_DELAY_MS - 1);
    expect(act).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(act).toHaveBeenCalledTimes(1);
    expect(gate.pending).toBe(false);
  });

  it("never acts on a double or triple click", () => {
    const act = vi.fn();
    const gate = createCardClickGate(act);
    // The browser's order: press, click (1), press, click (2), dblclick.
    gate.pointerDown(10, 10);
    gate.click(1);
    vi.advanceTimersByTime(120);
    gate.pointerDown(10, 10);
    gate.click(2);
    gate.pointerDown(10, 10);
    gate.click(3);
    vi.advanceTimersByTime(CARD_CLICK_DELAY_MS * 4);
    expect(act).not.toHaveBeenCalled();
  });

  it("never acts on a drag that selects text", () => {
    const act = vi.fn();
    let selected = false;
    const gate = createCardClickGate(act, { textSelected: () => selected });
    gate.pointerDown(10, 10);
    gate.pointerMove(12, 10);
    gate.pointerMove(80, 12);
    selected = true;
    gate.click(1);
    vi.advanceTimersByTime(CARD_CLICK_DELAY_MS * 2);
    expect(act).not.toHaveBeenCalled();

    // A drag that selected nothing is still a drag, not a pick.
    selected = false;
    gate.pointerDown(10, 10);
    gate.pointerMove(60, 10);
    gate.click(1);
    vi.advanceTimersByTime(CARD_CLICK_DELAY_MS * 2);
    expect(act).not.toHaveBeenCalled();

    // A small wobble while pressing is still a click.
    gate.pointerDown(10, 10);
    gate.pointerMove(12, 11);
    gate.click(1);
    vi.advanceTimersByTime(CARD_CLICK_DELAY_MS);
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("drops a pending click when text gets selected during the window, or when cancelled", () => {
    const act = vi.fn();
    let selected = false;
    const gate = createCardClickGate(act, { textSelected: () => selected });
    gate.pointerDown(10, 10);
    gate.click(1);
    selected = true;
    vi.advanceTimersByTime(CARD_CLICK_DELAY_MS);
    expect(act).not.toHaveBeenCalled();

    selected = false;
    gate.pointerDown(10, 10);
    gate.click(1);
    gate.cancel();
    vi.advanceTimersByTime(CARD_CLICK_DELAY_MS);
    expect(act).not.toHaveBeenCalled();
    expect(gate.pending).toBe(false);
  });
});

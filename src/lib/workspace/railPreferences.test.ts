import { afterEach, describe, expect, it } from "vitest";
import {
  PREVIOUS_RAIL_PREFERENCES_KEY,
  RAIL_PREFERENCES_KEY,
  defaultRailPreferences,
  loadRailPreferences,
  parseRailPreferences,
  persistRailPreferences,
  serializeRailPreferences,
} from "./railPreferences";

/**
 * The drawer rail keeps one choice, the Admin group; the desktop rail's
 * width and collapse went with the page frame (owner, 2026-10-28).
 */
describe("parseRailPreferences (fail-closed)", () => {
  it("returns the closed default for null, garbage and foreign shapes", () => {
    for (const raw of [null, "", "not json", '"board"', "[1,2]", "{}", '{"adminOpen":"yes"}']) {
      expect(parseRailPreferences(raw)).toEqual(defaultRailPreferences());
    }
    expect(defaultRailPreferences()).toEqual({ adminOpen: false });
  });

  it("reads the Admin group choice and ignores the old width and collapse", () => {
    expect(parseRailPreferences(JSON.stringify({ width: 240, hidden: true, adminOpen: true }))).toEqual({ adminOpen: true });
    expect(serializeRailPreferences({ adminOpen: true })).toBe('{"adminOpen":true}');
  });
});

describe("loadRailPreferences", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  afterEach(() => {
    store.clear();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("falls back to the v2 key's Admin group choice", () => {
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    store.set(PREVIOUS_RAIL_PREFERENCES_KEY, JSON.stringify({ width: 200, hidden: true, adminOpen: true }));
    expect(loadRailPreferences()).toEqual({ adminOpen: true });
    store.set(RAIL_PREFERENCES_KEY, JSON.stringify({ width: 240, hidden: false }));
    expect(loadRailPreferences()).toEqual({ adminOpen: false });
  });

  it("persists the choice and drops the stored width and collapse on write", () => {
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    store.set(RAIL_PREFERENCES_KEY, JSON.stringify({ width: 240, hidden: true }));
    persistRailPreferences({ adminOpen: true });
    expect(store.get(RAIL_PREFERENCES_KEY)).toBe('{"adminOpen":true}');
    expect(loadRailPreferences()).toEqual({ adminOpen: true });
  });

  it("falls closed when storage is blocked", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadRailPreferences()).toEqual({ adminOpen: false });
    expect(() => persistRailPreferences({ adminOpen: true })).not.toThrow();
  });
});

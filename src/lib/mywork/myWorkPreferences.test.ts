import { describe, expect, it } from "vitest";
import {
  DEFAULT_MY_WORK_PREFERENCES,
  parseMyWorkPreferences,
  serializeMyWorkPreferences,
} from "./myWorkPreferences";

describe("my work preferences (queue-first, 2026-08-06 second amendment)", () => {
  it("defaults to the server-order presentation and fails closed", () => {
    expect(DEFAULT_MY_WORK_PREFERENCES.laneSort).toBe("default");
    expect(parseMyWorkPreferences(null)).toEqual(DEFAULT_MY_WORK_PREFERENCES);
    expect(parseMyWorkPreferences("bad-json")).toEqual(DEFAULT_MY_WORK_PREFERENCES);
  });

  it("retires the Board/List layout key fail-safe: stored copies parse and drop it", () => {
    // Old stored preferences carried layout board/list/grid — all parse
    // safely to the single queue presentation.
    for (const layout of ["board", "list", "grid", "unknown"]) {
      expect(parseMyWorkPreferences(JSON.stringify({ layout }))).toEqual(
        DEFAULT_MY_WORK_PREFERENCES
      );
    }
    // Serialization no longer writes a layout key.
    expect(JSON.parse(serializeMyWorkPreferences(DEFAULT_MY_WORK_PREFERENCES)).layout).toBeUndefined();
  });

  it("round trips the loaded-rows sort modes", () => {
    expect(
      parseMyWorkPreferences(serializeMyWorkPreferences({ laneSort: "clientName" }))
    ).toEqual({ laneSort: "clientName" });
    expect(
      parseMyWorkPreferences(serializeMyWorkPreferences({ laneSort: "updated" }))
    ).toEqual({ laneSort: "updated" });
  });

  it("keeps previously stored sorts and fails closed on unknown values", () => {
    // "updated" was the retired default — stored copies keep working.
    expect(parseMyWorkPreferences(JSON.stringify({ layout: "list", laneSort: "updated" }))).toEqual({
      laneSort: "updated",
    });
    expect(parseMyWorkPreferences(JSON.stringify({ laneSort: "company" }))).toEqual(
      DEFAULT_MY_WORK_PREFERENCES
    );
    expect(parseMyWorkPreferences(JSON.stringify({ laneSort: 7 }))).toEqual(
      DEFAULT_MY_WORK_PREFERENCES
    );
  });
});

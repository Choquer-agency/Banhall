import { describe, expect, it } from "vitest";
import { groupHistory, historyGroup, shortTimeAgo } from "./chatHistory";

const now = new Date(2026, 9, 28, 15, 0).getTime();
const hour = 60 * 60 * 1000;

describe("chat history", () => {
  it("groups by Today, This week and Earlier", () => {
    expect(historyGroup(now - 2 * hour, now)).toBe("Today");
    expect(historyGroup(now - 3 * 24 * hour, now)).toBe("This week");
    expect(historyGroup(now - 13 * 24 * hour, now)).toBe("Earlier");
  });

  it("says how long ago in a few characters", () => {
    expect(shortTimeAgo(now - 20_000, now)).toBe("now");
    expect(shortTimeAgo(now - 5 * 60_000, now)).toBe("5m");
    expect(shortTimeAgo(now - 3 * hour, now)).toBe("3h");
    expect(shortTimeAgo(now - 2 * 24 * hour, now)).toBe("2d");
    expect(shortTimeAgo(new Date(2026, 8, 2).getTime(), now)).toBe("Sep 2");
  });

  it("keeps only groups with rows, newest first", () => {
    const rows = [{ at: now - 50 * 24 * hour }, { at: now - hour }, { at: now - 2 * hour }];
    expect(groupHistory(rows, (row) => row.at, now)).toEqual([
      { group: "Today", rows: [{ at: now - hour }, { at: now - 2 * hour }] },
      { group: "Earlier", rows: [{ at: now - 50 * 24 * hour }] },
    ]);
  });
});

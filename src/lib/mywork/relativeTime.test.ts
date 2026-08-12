import { describe, expect, it } from "vitest";
import { formatOpenedRelative, formatUpdatedRelative } from "./relativeTime";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatUpdatedRelative", () => {
  it("collapses fresh and future timestamps to just now", () => {
    expect(formatUpdatedRelative(1_000_000, 1_000_000 + 30_000)).toBe("Updated just now");
    expect(formatUpdatedRelative(2_000_000, 1_000_000)).toBe("Updated just now");
  });

  it("uses singular and plural units at each scale", () => {
    const now = 10 * DAY;
    expect(formatUpdatedRelative(now - MINUTE, now)).toBe("Updated 1 minute ago");
    expect(formatUpdatedRelative(now - 45 * MINUTE, now)).toBe("Updated 45 minutes ago");
    expect(formatUpdatedRelative(now - HOUR, now)).toBe("Updated 1 hour ago");
    expect(formatUpdatedRelative(now - 23 * HOUR, now)).toBe("Updated 23 hours ago");
    expect(formatUpdatedRelative(now - DAY, now)).toBe("Updated 1 day ago");
    expect(formatUpdatedRelative(now - 8 * DAY, now)).toBe("Updated 8 days ago");
  });
});

describe("formatOpenedRelative", () => {
  it("uses the same coarse scale with Opened phrasing", () => {
    const now = 10 * DAY;
    expect(formatOpenedRelative(now - 30_000, now)).toBe("Opened just now");
    expect(formatOpenedRelative(now - 45 * MINUTE, now)).toBe("Opened 45 minutes ago");
    expect(formatOpenedRelative(now - 2 * HOUR, now)).toBe("Opened 2 hours ago");
    expect(formatOpenedRelative(now - DAY, now)).toBe("Opened 1 day ago");
  });
});

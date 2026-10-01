import { describe, expect, it } from "vitest";
import {
  expiredLabel,
  firmShortDate,
  firmWeekdayDate,
  lastActiveLabel,
  sentLabel,
} from "./teamFormat";

const NOW = Date.parse("2026-09-26T19:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("team formatting", () => {
  it("formats Last active from the heartbeat", () => {
    expect(lastActiveLabel(null, true, NOW)).toBe("Now");
    expect(lastActiveLabel(null, false, NOW)).toBe("Not yet");
    expect(lastActiveLabel(NOW - 4 * MIN, false, NOW)).toBe("Now");
    expect(lastActiveLabel(NOW - 12 * MIN, false, NOW)).toBe("12 min ago");
    expect(lastActiveLabel(NOW - HOUR, false, NOW)).toBe("1 hour ago");
    expect(lastActiveLabel(NOW - DAY - HOUR, false, NOW)).toBe("Yesterday");
    expect(lastActiveLabel(NOW - 10 * DAY, false, NOW)).toBe("Sep 16");
  });

  it("formats pending and expired invite status", () => {
    expect(sentLabel(NOW - 20_000, NOW)).toBe("Sent just now");
    expect(sentLabel(NOW - 2 * DAY, NOW)).toBe("Sent 2 days ago");
    expect(sentLabel(NOW - DAY - HOUR, NOW)).toBe("Sent yesterday");
    expect(sentLabel(NOW - 3 * HOUR, NOW)).toBe("Sent 3 hours ago");
    expect(sentLabel(NOW - 12 * DAY, NOW)).toBe("Sent Sep 14");
    expect(expiredLabel(Date.parse("2026-09-10T18:00:00Z"))).toBe("Expired, sent Sep 10");
  });

  it("uses the firm's time zone for dates", () => {
    // 03:00 UTC on Oct 3 is still Oct 2 in Vancouver.
    expect(firmShortDate(Date.parse("2026-10-03T03:00:00Z"))).toBe("Oct 2");
    expect(firmWeekdayDate(Date.parse("2026-10-03T03:00:00Z"))).toBe("Friday, Oct 2");
  });
});

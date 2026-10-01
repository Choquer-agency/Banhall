import { describe, expect, it } from "vitest";
import { deviceLabel, sessionsLine } from "./deviceLabel";

describe("deviceLabel", () => {
  it.each([
    [{ platform: "MacIntel" }, "Mac"],
    [{ platform: "MacIntel", maxTouchPoints: 5 }, "iPad"],
    [{ platform: "iPhone" }, "iPhone"],
    [{ platform: "iPad" }, "iPad"],
    [{ platform: "Win32" }, "Windows PC"],
    [{ platform: "", userAgentData: { platform: "Windows" } }, "Windows PC"],
    [{ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 14)" }, "Android phone"],
    [{ platform: "", userAgentData: { platform: "Android" } }, "Android phone"],
    [{ platform: "Linux x86_64" }, "Linux computer"],
    [{ platform: "" }, "device"],
  ] as const)("%o is %s", (nav, expected) => {
    expect(deviceLabel(nav)).toBe(expected);
  });
});

describe("sessionsLine", () => {
  it("reads one, two and many sessions as on board I1", () => {
    expect(sessionsLine("Mac", 0)).toBe("This Mac only.");
    expect(sessionsLine("Mac", 1)).toBe("This Mac and 1 other device.");
    expect(sessionsLine("Windows PC", 3)).toBe("This Windows PC and 3 other devices.");
  });
});

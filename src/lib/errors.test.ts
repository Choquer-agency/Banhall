import { describe, expect, it } from "vitest";
import { isHandledRefusalLog, userErrorCode } from "./errors";

/** The Convex client's log line for a failed call, as `logForFunction` writes it. */
function convexLog(path: string, data: Record<string, unknown> | null, kind = "M") {
  const body = data
    ? `[Request ID: 7c1e] Server Error\nUncaught ConvexError: ${JSON.stringify(data)}\n    at handler (../convex/generations.ts:12:3)`
    : "[Request ID: 7c1e] Server Error\nUncaught TypeError: Cannot read properties of undefined (reading 'status')";
  return `[CONVEX ${kind}(${path})] ${body}`;
}

describe("isHandledRefusalLog", () => {
  it("recognises the refusals the pages already handle", () => {
    const active = { code: "GENERATION_ACTIVE", message: "A generation is already active for this project", generationId: "g-1" };
    expect(isHandledRefusalLog(convexLog("generations:requestGeneration", active))).toBe(true);
    expect(isHandledRefusalLog(convexLog("generations:redraftMissingSections", active))).toBe(true);
    expect(isHandledRefusalLog(convexLog("seeds:decide", { code: "STALE_REVISION", message: "x" }))).toBe(true);
    expect(isHandledRefusalLog(convexLog("brief:update", { code: "BRIEF_STALE", message: "x" }))).toBe(true);
    expect(isHandledRefusalLog(convexLog("generations:startSomething", { code: "GENERATION_ACTIVE", message: "x" }, "A"))).toBe(true);
    // Decision 65, stage 2: a run or review while the project is still being set up.
    const settingUp = { code: "PROJECT_SETTING_UP", message: "This project is still being set up. Try again in a moment." };
    expect(isHandledRefusalLog(convexLog("generations:requestGeneration", settingUp))).toBe(true);
    expect(isHandledRefusalLog(convexLog("pdReviews:startPdReview", settingUp))).toBe(true);
  });

  it("leaves unexpected failures and other lines to the crash toast", () => {
    // A crash with no domain code.
    expect(isHandledRefusalLog(convexLog("generations:requestGeneration", null))).toBe(false);
    // A refusal with a code no page handles quietly.
    expect(isHandledRefusalLog(convexLog("generations:requestGeneration", { code: "INVALID_STATE", message: "x" }))).toBe(false);
    // The same code outside a Convex client log line.
    expect(isHandledRefusalLog('Uncaught ConvexError: {"code":"GENERATION_ACTIVE","message":"x"}')).toBe(false);
    expect(isHandledRefusalLog("Could not mark notifications seen")).toBe(false);
    expect(isHandledRefusalLog("")).toBe(false);
  });

  it("reads the code the same way callers do", () => {
    const line = convexLog("generations:requestGeneration", { code: "GENERATION_ACTIVE", message: "x" });
    expect(userErrorCode(new Error(line))).toBe("GENERATION_ACTIVE");
  });
});

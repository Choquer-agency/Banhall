import { describe, expect, it } from "vitest";
import { isHandledRefusalLog, userErrorCode, userErrorData } from "./errors";

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
    for (const code of ["INTAKE_DRAFT_GONE", "INTAKE_DRAFT_LIMIT", "INTAKE_TEXT_LIMIT"]) {
      expect(isHandledRefusalLog(convexLog("intakeDrafts:saveIntakeSource", { code, message: "x" }))).toBe(true);
    }
    // Audit wave 2: the limits on paid AI actions, from mutations and actions.
    const limited = {
      code: "RATE_LIMITED",
      message: "You have started a lot of runs in the last hour. Try again in 5 minutes.",
      retryAfter: 300,
    };
    for (const [path, kind] of [
      ["generations:requestGeneration", "M"],
      ["seeds:regenerate", "M"],
      ["scienceCodeSuggestions:suggest", "A"],
      ["ai/styleAnalysis:analyzeMyInstructions", "A"],
    ] as const) {
      expect(isHandledRefusalLog(convexLog(path, limited, kind))).toBe(true);
    }
    // 2026-10-14 saved clients: New client shows the name already in use inline.
    const exists = { code: "CLIENT_EXISTS", message: "Cedarline Systems already exists.", existingName: "Cedarline Systems" };
    expect(isHandledRefusalLog(convexLog("clients:createClient", exists))).toBe(true);
    // Chat parity Phase A: the report chat explains its refusals on the unsent message.
    for (const code of ["CHAT_TURN_ACTIVE", "CHAT_SPEND_BUDGET_EXCEEDED", "CHAT_QUEUE_LIMIT_EXCEEDED", "CHAT_MESSAGE_TOO_LONG"]) {
      expect(isHandledRefusalLog(convexLog("chatV2:sendMessage", { code, message: "x" })), code).toBe(true);
    }
    // Phase A review: every domain refusal of Stop is explained in the chat panel.
    expect(isHandledRefusalLog(convexLog("chatV2:abortStreaming", { code: "NOT_AUTHORIZED", message: "x" }))).toBe(true);
    expect(isHandledRefusalLog(convexLog("chatV2:abortStreaming", null))).toBe(false);
    expect(isHandledRefusalLog(convexLog("chatV2:applyProposal", { code: "NOT_AUTHORIZED", message: "x" }))).toBe(false);
    // Phase B: Undo explains its refusals on the card; the web switch says so in the panel.
    expect(isHandledRefusalLog(convexLog("chatV2:undoProposal", { code: "PROPOSAL_UNDO_CONFLICT", message: "x" }))).toBe(true);
    expect(isHandledRefusalLog(convexLog("chatV2:undoProposal", { code: "NOT_AUTHORIZED", message: "x" }))).toBe(true);
    expect(isHandledRefusalLog(convexLog("chatV2:setThreadWebSearch", { code: "NOT_FOUND", message: "x" }))).toBe(true);
    expect(isHandledRefusalLog(convexLog("chatV2:undoProposal", null))).toBe(false);
    // Phase C: alternatives and conversation actions explain their refusals inline.
    for (const fn of ["sendAlternative", "setActiveAlternative", "renameThread", "archiveThread", "restoreThread", "deleteThread"]) {
      expect(isHandledRefusalLog(convexLog(`chatV2:${fn}`, { code: "NOT_FOUND", message: "x" })), fn).toBe(true);
      expect(isHandledRefusalLog(convexLog(`chatV2:${fn}`, { code: "CHAT_TURN_ACTIVE", message: "x" })), fn).toBe(true);
      expect(isHandledRefusalLog(convexLog(`chatV2:${fn}`, null)), fn).toBe(false);
    }
    // NOT_FOUND itself stays a crash signal.
    expect(isHandledRefusalLog(convexLog("intakeDrafts:saveIntakeSource", { code: "NOT_FOUND", message: "x" }))).toBe(false);
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

  it("returns the refusal's data from the error or from its log text", () => {
    const data = { code: "CHAT_MESSAGE_TOO_LONG", message: "x", maxChars: 20000 };
    expect(userErrorData({ data })).toEqual(data);
    expect(userErrorData(new Error(convexLog("chatV2:sendMessage", data)))).toEqual(data);
    expect(userErrorData(new Error("plain failure"))).toBeNull();
    expect(userErrorData({ data: { message: "no code" } })).toBeNull();
  });
});

/**
 * 2026-10-26 (Phase B2 review): the browser caps an Outlook message like
 * every other file, as the server does.
 */
import { describe, expect, it, vi } from "vitest";
import { parseFileToText } from "./parseDocument";
import { MAX_CONTENT_CHARS } from "../../shared/documentContent";
import { hasTruncationMarker } from "../../shared/documentStatus";

const msg = vi.hoisted(() => ({ body: "" }));
vi.mock("@kenjiuno/msgreader", () => ({
  default: class {
    getFileData() {
      return { subject: "Trial log", senderName: "Dana", senderEmail: "dana@example.com", recipients: [], body: msg.body };
    }
  },
}));

describe("an Outlook message read in the browser", () => {
  it("is capped at the content limit, with the cut marked", async () => {
    msg.body = "Seal held. ".repeat(110_000);
    const parsed = await parseFileToText(new File([new Uint8Array([1, 2, 3])], "log.msg"));
    expect(parsed.fileType).toBe("msg");
    expect(parsed.content.length).toBeLessThan(MAX_CONTENT_CHARS + 200);
    expect(hasTruncationMarker(parsed.content)).toBe(true);
  });
});

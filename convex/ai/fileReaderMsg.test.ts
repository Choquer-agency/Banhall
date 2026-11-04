/**
 * 2026-10-26 (Phase B2 review): an Outlook message is capped like every
 * other file, so a huge one is kept, cut, instead of failing to save.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileOnServer } from "./fileReader";
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

describe("an Outlook message read on the server", () => {
  it("is capped at the browser's limit, with the cut marked", async () => {
    msg.body = "Seal held. ".repeat(110_000);
    const reading = await readFileOnServer(new Uint8Array([1, 2, 3]), "log.msg");
    expect(reading.fileType).toBe("msg");
    expect(reading.text.length).toBeLessThan(MAX_CONTENT_CHARS + 200);
    expect(hasTruncationMarker(reading.text)).toBe(true);
  });
});

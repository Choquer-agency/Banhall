import { spreadsheetText } from "./spreadsheetText";
import type { SpreadsheetResponse } from "./spreadsheetProtocol";

const send = (response: SpreadsheetResponse) => self.postMessage(response);
self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    if (!(event.data instanceof ArrayBuffer)) throw new Error("Invalid spreadsheet request");
    const content = spreadsheetText(event.data, progress => send({ kind: "progress", progress }));
    send({ kind: "complete", content });
  } catch (error) {
    send({ kind: "error", message: error instanceof Error ? error.message : "Spreadsheet extraction failed" });
  }
};

import { afterEach, expect, it, vi } from "vitest";
import { parseFileToText } from "./parseDocument";
import { baselineSpreadsheetText, spreadsheetFixture } from "./test/spreadsheetFixtures";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["xlsx", "xls"] as const)("real worker preserves %s output including cap, formatting and empty sheets", async kind => {
  const terminate = vi.spyOn(Worker.prototype, "terminate");
  for (const large of [false, true]) {
    const file = spreadsheetFixture(kind, large);
    const baseline = baselineSpreadsheetText(await file.arrayBuffer());
    const phases: string[] = [];
    const result = await parseFileToText(file, { onProgress: progress => phases.push(progress.kind) });
    expect(result).toEqual({ fileName: file.name, fileType: "xlsx", content: baseline });
    expect(phases).toContain("reading");
    expect(phases).toContain("converting");
  }
  expect(terminate).toHaveBeenCalledTimes(2);
});

it("aborts before startup and while a real worker is running, then permits the next request", async () => {
  const terminate = vi.spyOn(Worker.prototype, "terminate");
  const controller = new AbortController();
  controller.abort();
  await expect(parseFileToText(spreadsheetFixture("xlsx"), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(terminate).not.toHaveBeenCalled();
  const active = new AbortController();
  await expect(parseFileToText(spreadsheetFixture("xlsx", true), {
    signal: active.signal,
    onProgress: progress => { if (progress.kind === "reading") active.abort(); },
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(terminate).toHaveBeenCalledTimes(1);
  expect((await parseFileToText(spreadsheetFixture("xls"))).content).toContain("## Sheet: First");
  expect(terminate).toHaveBeenCalledTimes(2);
});

it("removes canceled queued work without starting a worker", async () => {
  const terminate = vi.spyOn(Worker.prototype, "terminate");
  const first = parseFileToText(spreadsheetFixture("xlsx", true));
  const controller = new AbortController();
  const queued = parseFileToText(spreadsheetFixture("xlsx"), { signal: controller.signal });
  controller.abort();
  await expect(queued).rejects.toMatchObject({ name: "AbortError" });
  await first;
  expect(terminate).toHaveBeenCalledTimes(1);
});

it("rejects real parser errors and releases the worker", async () => {
  const terminate = vi.spyOn(Worker.prototype, "terminate");
  const brokenZip = new File([new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0])], "broken.xlsx");
  await expect(parseFileToText(brokenZip)).rejects.toBeInstanceOf(Error);
  expect(terminate).toHaveBeenCalledTimes(1);
});

it.each([
  'postMessage({kind:"complete",content:42})',
  'throw new Error("worker startup failed")',
])("releases a real worker after malformed output or runtime failure: %s", async source => {
  const RealWorker = Worker;
  const terminate = vi.spyOn(RealWorker.prototype, "terminate");
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  class FaultWorker extends RealWorker { constructor() { super(url, { type: "module" }); } }
  vi.stubGlobal("Worker", FaultWorker);
  try {
    await expect(parseFileToText(spreadsheetFixture("xlsx"))).rejects.toBeInstanceOf(Error);
    expect(terminate).toHaveBeenCalledTimes(1);
  } finally { URL.revokeObjectURL(url); }
});

it.each(["worker", "file read"])("times out a hanging %s and releases the slot for another workbook", async stage => {
  const RealWorker = Worker;
  const terminate = vi.spyOn(RealWorker.prototype, "terminate");
  const file = spreadsheetFixture("xlsx");
  const next = spreadsheetFixture("xlsx");
  const url = URL.createObjectURL(new Blob(["onmessage = () => {};"], { type: "text/javascript" }));
  let first = true;
  class HangingWorker extends RealWorker {
    constructor(workerUrl: string | URL, options?: WorkerOptions) {
      super(first && stage === "worker" ? url : workerUrl, options);
      first = false;
    }
  }
  vi.stubGlobal("Worker", HangingWorker);
  if (stage === "file read") vi.spyOn(file, "arrayBuffer").mockImplementation(() => new Promise(() => {}));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const timedOut = expect(parseFileToText(file)).rejects.toThrow("timed out");
    const following = parseFileToText(next);
    await vi.advanceTimersByTimeAsync(120_000);
    await timedOut;
    vi.useRealTimers();
    expect((await following).content).toContain("## Sheet: First");
    expect(terminate).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); URL.revokeObjectURL(url); }
});

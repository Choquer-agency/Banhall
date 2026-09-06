import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uploadOriginal } from "./originalUpload";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = new File([new Uint8Array([0, 1, 255])], "original.docx", { type: "application/docx" });
function setup() {
  const generateUploadUrl = vi.fn<() => Promise<string>>()
    .mockResolvedValueOnce("https://upload.test/one")
    .mockResolvedValueOnce("https://upload.test/two");
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ storageId: "stored" }));
  return { file, generateUploadUrl, fetch };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

it("attaches one validated success with the original bytes and MIME", async () => {
  const deps = setup();
  expect(await uploadOriginal(deps)).toBe("stored");
  expect(deps.generateUploadUrl).toHaveBeenCalledTimes(1);
  expect(deps.fetch).toHaveBeenCalledExactlyOnceWith("https://upload.test/one", expect.objectContaining({ method: "POST", body: file, headers: { "Content-Type": file.type } }));
});
it("uses the binary MIME fallback", async () => {
  const deps = setup();
  await uploadOriginal({ ...deps, file: new File(["bytes"], "original") });
  expect(deps.fetch.mock.calls[0]?.[1]?.headers).toEqual({ "Content-Type": "application/octet-stream" });
});
it.each([null, [], "stored", 1, {}, { storageId: null }, { storageId: 123 }, { storageId: "" }, { storageId: "  " }])("rejects invalid JSON shape %j twice", async (body) => {
  const deps = setup(); deps.fetch.mockImplementation(async () => Response.json(body));
  expect(await uploadOriginal(deps)).toBeUndefined();
  expect(deps.generateUploadUrl).toHaveBeenCalledTimes(2);
  expect(deps.fetch.mock.calls.map(call => call[0])).toEqual(["https://upload.test/one", "https://upload.test/two"]);
});
it.each(["http", "json", "post", "body", "url", "sync-url"])("retries %s failure with a fresh URL", async (failure) => {
  const deps = setup();
  if (failure === "url") deps.generateUploadUrl.mockReset().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("https://upload.test/two");
  else if (failure === "sync-url") deps.generateUploadUrl.mockReset().mockImplementationOnce(() => { throw new Error("offline"); }).mockResolvedValueOnce("https://upload.test/two");
  else if (failure === "post") deps.fetch.mockRejectedValueOnce(new Error("offline"));
  else if (failure === "body") deps.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error("body failed")); } })));
  else deps.fetch.mockResolvedValueOnce(failure === "http" ? Response.json({ storageId: "must-not-attach" }, { status: 503 }) : new Response("not JSON"));
  expect(await uploadOriginal(deps)).toBe("stored");
  expect(deps.generateUploadUrl).toHaveBeenCalledTimes(2);
  expect(deps.fetch.mock.lastCall?.[0]).toBe("https://upload.test/two");
  expect(console.error).not.toHaveBeenCalled();
});
it.each(["resolve", "reject"])("ignores a late URL %s after its 30 second deadline", async (settlement) => {
  const deps = setup(); const late = deferred<string>();
  deps.generateUploadUrl.mockReset().mockReturnValueOnce(late.promise).mockResolvedValueOnce("https://upload.test/two");
  const result = uploadOriginal(deps);
  await vi.advanceTimersByTimeAsync(29_999); expect(deps.fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(await result).toBe("stored");
  if (settlement === "resolve") late.resolve("https://upload.test/abandoned"); else late.reject(new Error("late rejection"));
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.fetch).toHaveBeenCalledTimes(1);
  expect(deps.fetch.mock.lastCall?.[0]).toBe("https://upload.test/two");
});
it("bounds two stalled URL acquisitions to 60 seconds with no POST", async () => {
  const deps = setup(); deps.generateUploadUrl.mockReset().mockImplementation(() => new Promise(() => {}));
  const result = uploadOriginal(deps);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await result).toBeUndefined(); expect(deps.fetch).not.toHaveBeenCalled();
  expect(deps.generateUploadUrl).toHaveBeenCalledTimes(2);
});
it.each(["post", "body"])("aborts two stalled %s attempts at 120 seconds each and handles late rejection", async (phase) => {
  const deps = setup(); const late = deferred<Response>(); const body = deferred<unknown>();
  deps.fetch.mockImplementation(async () => {
    if (phase === "post") return late.promise;
    const response = Response.json({ storageId: "late" });
    vi.spyOn(response, "json").mockReturnValue(body.promise);
    return response;
  });
  const result = uploadOriginal(deps);
  await vi.advanceTimersByTimeAsync(119_999);
  expect(deps.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(deps.fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(await result).toBeUndefined();
  expect(deps.fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  if (phase === "post") late.reject(new Error("late")); else body.reject(new Error("late"));
  await vi.advanceTimersByTimeAsync(0);
});
it("shares one deadline across POST and body, then accepts the second attempt", async () => {
  const deps = setup(); const first = deferred<Response>();
  deps.fetch.mockReturnValueOnce(first.promise);
  const result = uploadOriginal(deps);
  await vi.advanceTimersByTimeAsync(90_000);
  const response = Response.json({ storageId: "late" });
  vi.spyOn(response, "json").mockReturnValue(new Promise(() => {})); first.resolve(response);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await result).toBe("stored");
  expect(deps.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

function abortableResponse(signal: AbortSignal, status: number) {
  const state = { aborted: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"storageId":'));
      signal.addEventListener("abort", () => {
        state.aborted = true;
        controller.error(new DOMException("Transfer aborted", "AbortError"));
      }, { once: true });
    },
  });
  return { response: new Response(body, { status }), state };
}

it("stops a streaming HTTP error body before the retry starts", async () => {
  const deps = setup();
  const stoppedAtRetry: boolean[] = [];
  const bodyErrors: string[] = [];
  let cleanup = async () => {};
  deps.fetch.mockImplementationOnce(async (_url, init) => {
    if (!init?.signal) throw new Error("Missing upload abort signal");
    const first = abortableResponse(init.signal, 503);
    const reader = first.response.body?.getReader();
    if (!reader) throw new Error("Missing response body");
    await reader.read(); // Consume its first chunk, leaving a real pending read.
    const pendingRead = reader.read().then(() => "finished", (error: unknown) => {
      const name = error instanceof DOMException ? error.name : "unexpected error";
      bodyErrors.push(name);
      return name;
    });
    cleanup = async () => { await reader.cancel().catch(() => {}); await pendingRead; };
    deps.fetch.mockImplementationOnce(async () => {
      stoppedAtRetry.push(first.state.aborted);
      return Response.json({ storageId: "stored" });
    });
    return first.response;
  });
  try {
    expect(await uploadOriginal(deps)).toBe("stored");
    expect(stoppedAtRetry).toEqual([true]);
    expect(bodyErrors).toEqual(["AbortError"]);
  } finally {
    await cleanup();
  }
});

it("interrupts real body consumption through the fetch abort signal at its deadline", async () => {
  const deps = setup();
  const bodies: Array<{ aborted: boolean }> = [];
  deps.fetch.mockImplementation(async (_url, init) => {
    if (!init?.signal) throw new Error("Missing upload abort signal");
    const transfer = abortableResponse(init.signal, 200);
    bodies.push(transfer.state);
    return transfer.response;
  });
  const result = uploadOriginal(deps);
  await vi.advanceTimersByTimeAsync(119_999);
  expect(bodies).toEqual([{ aborted: false }]);
  await vi.advanceTimersByTimeAsync(1);
  expect(bodies).toEqual([{ aborted: true }, { aborted: false }]);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(await result).toBeUndefined();
  expect(bodies).toEqual([{ aborted: true }, { aborted: true }]);
});

it.each([
  ["post", "second-success"], ["post", "exhausted"],
  ["body", "second-success"], ["body", "exhausted"],
] as const)("ignores late successful %s settlement after %s", async (phase, outcome) => {
  const deps = setup();
  const post = deferred<Response>();
  const body = deferred<unknown>();
  const response = Response.json({ storageId: "abandoned" });
  if (phase === "body") vi.spyOn(response, "json").mockReturnValue(body.promise);
  deps.fetch.mockReset().mockReturnValueOnce(phase === "post" ? post.promise : Promise.resolve(response));
  if (outcome === "second-success") deps.fetch.mockResolvedValueOnce(Response.json({ storageId: "second" }));
  else deps.fetch.mockRejectedValueOnce(new Error("second failed"));
  const observed: Array<string | undefined> = [];
  const result = uploadOriginal(deps).then(value => { observed.push(value); return value; });
  await vi.advanceTimersByTimeAsync(120_000);
  const expected = outcome === "second-success" ? "second" : undefined;
  expect(await result).toBe(expected);
  if (phase === "post") post.resolve(response);
  else body.resolve({ storageId: "abandoned" });
  await vi.advanceTimersByTimeAsync(0);
  expect(observed).toEqual([expected]);
  expect(deps.fetch).toHaveBeenCalledTimes(2);
});

it("bounds two combined URL and POST waits below 300 seconds", async () => {
  const deps = setup();
  let issued = 0;
  deps.generateUploadUrl.mockReset().mockImplementation(() => new Promise(resolve => {
    const url = `https://upload.test/${++issued}`;
    setTimeout(() => resolve(url), 29_999);
  }));
  deps.fetch.mockImplementation(() => new Promise(() => {}));
  let settled = false;
  const result = uploadOriginal(deps).then(value => { settled = true; return value; });
  await vi.advanceTimersByTimeAsync(299_997);
  expect(settled).toBe(false);
  expect(deps.generateUploadUrl).toHaveBeenCalledTimes(2);
  expect(deps.fetch.mock.calls.map(call => call[0])).toEqual(["https://upload.test/1", "https://upload.test/2"]);
  expect(deps.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(deps.fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBeUndefined();
  expect(deps.fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
});

it("reports only the final exhausted failure once", async () => {
  const deps = setup();
  const lastError = new Error("second upload failed");
  deps.fetch.mockRejectedValueOnce(new Error("first upload failed")).mockRejectedValueOnce(lastError);
  expect(await uploadOriginal(deps)).toBeUndefined();
  expect(console.error).toHaveBeenCalledExactlyOnceWith("storage upload failed", lastError);
});

it("does not retry or launch a POST after its owner cancels while obtaining a URL", async () => {
  const deps = setup();
  const url = deferred<string>();
  deps.generateUploadUrl.mockReset().mockReturnValue(url.promise);
  const controller = new AbortController();
  const pending = uploadOriginal({ ...deps, signal: controller.signal });
  controller.abort();
  url.resolve("https://upload.test/late");
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(deps.fetch).not.toHaveBeenCalled();
  expect(deps.generateUploadUrl).toHaveBeenCalledTimes(1);
});

it("aborts an in-flight original POST without retrying when its owner cancels", async () => {
  const deps = setup();
  const controller = new AbortController();
  deps.fetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  const pending = uploadOriginal({ ...deps, signal: controller.signal });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(deps.fetch).toHaveBeenCalledTimes(1);
  expect(deps.generateUploadUrl).toHaveBeenCalledTimes(1);
});
